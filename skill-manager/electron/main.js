const path = require("path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");

const { ActiveSkillLibrary } = require("./active-skill-library");
const { AppConfig } = require("./app-config");
const { createDBAdapter } = require("./skill-library-db");
const { SkillDiscovery } = require("./skill-discovery");
const { SkillInstaller } = require("./skill-installer");
const { SkillRepositoryImporter } = require("./skill-repository-importer");

let mainWindow = null;
let skillLibrary = null;
let db = null;

function getInitialProject() {
  const arg = process.argv.find((value) => value.startsWith("--project="));
  if (arg) {
    return arg.slice("--project=".length);
  }
  return process.cwd();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1120,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`--skill-manager-initial-project=${getInitialProject()}`],
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
}

function databasePath() {
  return process.env.SKILL_MANAGER_DB_PATH || path.join(app.getPath("userData"), "skill-manager.sqlite");
}

function appConfigPath() {
  return process.env.SKILL_MANAGER_APP_CONFIG_PATH || path.join(app.getPath("userData"), "skill-manager-config.json");
}

function messageForInstallResult(result, scope) {
  const repoLabel = scope === "repo" ? "this repo" : "global installs";
  switch (result.status) {
    case "enabled":
      return { kind: "info", text: `Copied ${result.skill} into ${repoLabel}` };
    case "installed":
      return { kind: "info", text: `Copied ${result.skill} into ${repoLabel}` };
    case "refreshed":
      return { kind: "info", text: `Refreshed the copied ${scope} install for ${result.skill}` };
    case "migrated-link":
      return { kind: "info", text: `Replaced the legacy ${scope} link for ${result.skill} with a copy` };
    case "replaced":
      return { kind: "info", text: `Replaced the existing ${scope} entry for ${result.skill} with a fresh copy` };
    case "blocked-modified":
      return {
        kind: "warn",
        text: `The existing ${scope} entry for ${result.skill} differs from the library copy.`,
      };
    default:
      return { kind: "info", text: result.skill };
  }
}

function pickFolder(defaultPath) {
  if (!mainWindow) {
    throw new Error("Main window is not available.");
  }
  return dialog
    .showOpenDialog(mainWindow, {
      title: "Select Folder",
      defaultPath: defaultPath || undefined,
      properties: ["openDirectory"],
    })
    .then((result) => ({
      cancelled: result.canceled,
      selectedPath: result.canceled ? null : result.filePaths[0] || null,
    }));
}

app.whenReady().then(() => {
  db = createDBAdapter({ databasePath: databasePath() });
  const discovery = new SkillDiscovery({ fileSystem: require("fs") });
  const installer = new SkillInstaller();
  const appConfig = new AppConfig({ configPath: appConfigPath() });
  const repositoryImporter = new SkillRepositoryImporter({ db, discovery });
  skillLibrary = new ActiveSkillLibrary({
    db,
    discovery,
    installer,
    appConfig,
    repositoryImporter,
    databasePath: databasePath(),
    appConfigPath: appConfigPath(),
  });
  db.initialize();
  appConfig.read();

  ipcMain.handle("skill-manager:get-bootstrap", async () => ({
    initialProject: getInitialProject(),
  }));
  ipcMain.handle("skill-manager:get-state", async (_, project, options = {}) =>
    skillLibrary.statusSnapshot(project || null, options || {})
  );
  ipcMain.handle("skill-manager:refresh-repo-statuses", async (_, project, options = {}) =>
    skillLibrary.refreshRepoStatuses(project || null, options || {})
  );
  ipcMain.handle("skill-manager:set-root", async (_, rootPath, project) => {
    const result = skillLibrary.setRoot(rootPath);
    return {
      message: `Library root set to ${result.rootPath}`,
      state: skillLibrary.statusSnapshot(project || null, {
        selectedLibraryId: result.library.id,
      }),
    };
  });
  ipcMain.handle("skill-manager:list-libraries", async () => skillLibrary.listLibraries());
  ipcMain.handle("skill-manager:select-library", async (_, libraryId, project) => {
    const library = skillLibrary.selectLibrary(libraryId);
    return {
      message: `Loaded library ${library.localPath}`,
      state: skillLibrary.statusSnapshot(project || null, {
        selectedLibraryId: library.id,
      }),
    };
  });
  ipcMain.handle("skill-manager:refresh-library", async (_, libraryId, project) => {
    const result = skillLibrary.refreshLibrary(libraryId || null);
    return {
      message: `Library refreshed: ${result.libraryRoot}`,
      state: skillLibrary.statusSnapshot(project || null, {
        selectedLibraryId: result.libraryId,
      }),
    };
  });
  ipcMain.handle("skill-manager:delete-library", async (_, libraryId, project) => {
    skillLibrary.deleteLibrary(libraryId);
    return {
      message: "Library removed from the catalog.",
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:clone-skills-repo", async (_, repoUrl, project) => {
    const result = skillLibrary.addSkillsFromRepository(repoUrl);
    const nextState = skillLibrary.statusSnapshot(project || null);
    if (result.status === "no-skills-found") {
      return {
        result,
        cleanupOffered: true,
        message: `Cloned ${result.repoUrl}, but no SKILL.md entries were found.`,
        messageKind: "warn",
        state: nextState,
      };
    }
    if (result.status === "duplicate-name") {
      return {
        result,
        message: `Could not add ${result.repoUrl}: skill "${result.duplicateName}" already exists in the catalog.`,
        messageKind: "error",
        state: nextState,
      };
    }
    return {
      result,
      message: `Cloned ${result.repoUrl} into ${result.destination}`,
      messageKind: "info",
      state: nextState,
    };
  });
  ipcMain.handle("skill-manager:cleanup-imported-repository", async (_, destination, project) => {
    const result = skillLibrary.cleanupImportedRepository(destination);
    return {
      result,
      message: `Deleted cloned folder ${result.destination}`,
      messageKind: "info",
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:enable-skill", async (_, skill, project, force) => {
    const result = skillLibrary.enableSkill(skill, project || null, Boolean(force));
    const message = messageForInstallResult(result, "repo");
    return {
      result,
      message: message.text,
      messageKind: message.kind,
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:disable-skill", async (_, skill, project) => {
    const result = skillLibrary.disableSkill(skill, project || null);
    const message =
      result.status === "not-enabled"
        ? `Skill not enabled: ${result.skill}`
        : `Disabled ${result.skill} in ${result.projectRoot}`;
    return {
      message,
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:install-global", async (_, skill, project, force) => {
    const result = skillLibrary.installGlobalSkill(skill, Boolean(force));
    const message = messageForInstallResult(result, "global");
    return {
      result,
      message: message.text,
      messageKind: message.kind,
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:uninstall-global", async (_, skill, project) => {
    const result = skillLibrary.uninstallGlobalSkill(skill);
    const message =
      result.status === "not-installed"
        ? `Skill not installed globally: ${result.skill}`
        : `Uninstalled ${result.skill} from ${result.globalRoot}`;
    return {
      message,
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:update-skill-repo", async (_, skill, project) => {
    const result = skillLibrary.updateSkillRepo(skill, project || null);
    const message =
      result.status === "already-up-to-date"
        ? `Repo already up to date for ${result.skill}`
        : `Updated repo for ${result.skill}`;
    return {
      message,
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:set-skill-tags", async (_, skill, tags, project) => {
    const result = skillLibrary.setSkillTags(skill, tags);
    return {
      message: result.tags.length
        ? `Updated tags for ${result.skill}: ${result.tags.join(", ")}`
        : `Cleared tags for ${result.skill}`,
      skill: result.skill,
      tags: result.tags,
      allTags: result.allTags,
      projectRoot: skillLibrary.installer.resolveProjectRoot(project || null),
    };
  });
  ipcMain.handle("skill-manager:delete-library-skill", async (_, skill, project) => {
    const result = skillLibrary.deleteLibrarySkill(skill, project || null);
    return {
      message: `Deleted ${result.skill} from ${result.libraryRoot}`,
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:read-skill-markdown", async (_, skill) =>
    skillLibrary.readSkillMarkdown(skill)
  );
  ipcMain.handle("skill-manager:list-directories", async (_, targetPath) =>
    skillLibrary.listDirectories(targetPath || null)
  );
  ipcMain.handle("skill-manager:pick-folder", async (_, defaultPath) =>
    pickFolder(defaultPath || null)
  );
  ipcMain.handle("skill-manager:open-external", async (_, targetUrl) => {
    await shell.openExternal(targetUrl);
    return { ok: true };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (!db) {
    return;
  }
  try {
    db.close();
  } catch {
    // Ignore close errors during shutdown.
  }
  db = null;
});
