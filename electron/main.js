const path = require("path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const skillLibrary = require("./skill-library");

let mainWindow = null;

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
  ipcMain.handle("skill-manager:get-bootstrap", async () => ({
    initialProject: getInitialProject(),
  }));
  ipcMain.handle("skill-manager:get-state", async (_, project) =>
    skillLibrary.statusSnapshot(project || null)
  );
  ipcMain.handle("skill-manager:set-root", async (_, rootPath, project) => {
    const result = skillLibrary.setRoot(rootPath);
    return {
      message: `Library root set to ${result.rootPath}`,
      state: skillLibrary.statusSnapshot(project || null),
    };
  });
  ipcMain.handle("skill-manager:enable-skill", async (_, skill, project, force) => {
    const result = skillLibrary.enableSkill(skill, project || null, Boolean(force));
    const message =
      result.status === "already-enabled"
        ? `Skill already enabled: ${result.skill}`
        : `Enabled ${result.skill} in ${result.projectRoot}`;
    return {
      message,
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
    const message =
      result.status === "already-installed"
        ? `Skill already installed globally: ${result.skill}`
        : `Installed ${result.skill} globally in ${result.globalRoot}`;
    return {
      message,
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
