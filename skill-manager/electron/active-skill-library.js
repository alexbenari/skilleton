const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { AppConfigError } = require("./app-config");
const { SkillLibrary, SkillLibraryError, allTagsFromRows } = require("./skill-library");
const { SkillInstallerError } = require("./skill-installer");
const { SkillRepositoryImporterError } = require("./skill-repository-importer");

class ActiveSkillLibraryError extends Error {}

function defaultRunGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

class ActiveSkillLibrary {
  constructor({
    db,
    discovery,
    installer,
    appConfig,
    repositoryImporter,
    fileSystem = fs,
    runGit = defaultRunGit,
    databasePath = null,
    appConfigPath = null,
  } = {}) {
    this.db = db;
    this.discovery = discovery;
    this.installer = installer;
    this.appConfig = appConfig;
    this.repositoryImporter = repositoryImporter;
    this.fileSystem = fileSystem;
    this.runGit = runGit;
    this.databasePath = databasePath;
    this.appConfigPath = appConfigPath;
    this.repoStatusCache = new Map();
  }

  initialize() {
    this.db.initialize();
  }

  toActiveLibraryRecord(library) {
    return new SkillLibrary({
      libraryId: library.id,
      localPath: library.localPath,
      db: this.db,
      discovery: this.discovery,
      installer: this.installer,
      fileSystem: this.fileSystem,
    });
  }

  listLibraries() {
    this.initialize();
    return this.db.listLibraries();
  }

  readAppConfig() {
    try {
      return this.appConfig.read();
    } catch (error) {
      if (error instanceof AppConfigError) {
        throw new ActiveSkillLibraryError(error.message);
      }
      throw error;
    }
  }

  writeLastSelectedLibraryId(libraryId) {
    try {
      this.appConfig.setLastSelectedLibraryId(libraryId);
    } catch (error) {
      if (error instanceof AppConfigError) {
        throw new ActiveSkillLibraryError(error.message);
      }
      throw error;
    }
  }

  clearLastSelectedLibraryId() {
    try {
      this.appConfig.clearLastSelectedLibraryId();
    } catch (error) {
      if (error instanceof AppConfigError) {
        throw new ActiveSkillLibraryError(error.message);
      }
      throw error;
    }
  }

  resolveSelection(explicitLibraryId = null) {
    const libraries = this.db.listLibraries();
    if (!libraries.length) {
      this.clearLastSelectedLibraryId();
      return {
        libraries,
        active: null,
        librarySelectionRequired: false,
      };
    }

    const librariesById = new Map(libraries.map((library) => [library.id, library]));
    if (Number.isInteger(explicitLibraryId)) {
      const selected = librariesById.get(explicitLibraryId);
      if (!selected) {
        throw new ActiveSkillLibraryError(`Skill library ${explicitLibraryId} not found.`);
      }
      this.writeLastSelectedLibraryId(selected.id);
      return {
        libraries,
        active: selected,
        librarySelectionRequired: false,
      };
    }

    if (libraries.length === 1) {
      this.writeLastSelectedLibraryId(libraries[0].id);
      return {
        libraries,
        active: libraries[0],
        librarySelectionRequired: false,
      };
    }

    const config = this.readAppConfig();
    if (Number.isInteger(config.lastSelectedLibraryId)) {
      const selected = librariesById.get(config.lastSelectedLibraryId);
      if (selected) {
        return {
          libraries,
          active: selected,
          librarySelectionRequired: false,
        };
      }
    }

    return {
      libraries,
      active: null,
      librarySelectionRequired: true,
    };
  }

  selectLibrary(libraryId) {
    this.initialize();
    const selection = this.resolveSelection(libraryId);
    return selection.active;
  }

  setRoot(rootPath) {
    this.initialize();
    const normalizedRoot = path.resolve(rootPath);
    if (!path.isAbsolute(normalizedRoot)) {
      throw new ActiveSkillLibraryError("Path must be absolute.");
    }
    if (!this.fileSystem.existsSync(normalizedRoot) || !this.fileSystem.statSync(normalizedRoot).isDirectory()) {
      throw new ActiveSkillLibraryError(
        `Library root does not exist or is not a directory: ${normalizedRoot}`
      );
    }
    const library = this.db.setLibrary(normalizedRoot);
    this.writeLastSelectedLibraryId(library.id);
    return { rootPath: normalizedRoot, library };
  }

  deleteLibrary(libraryId) {
    this.initialize();
    const libraries = this.db.listLibraries();
    if (!libraries.some((library) => library.id === libraryId)) {
      throw new ActiveSkillLibraryError(`Skill library ${libraryId} not found.`);
    }
    this.db.deleteLibrary(libraryId);
    const remainingLibraries = this.db.listLibraries();
    const config = this.readAppConfig();
    if (config.lastSelectedLibraryId === libraryId) {
      if (remainingLibraries.length === 1) {
        this.writeLastSelectedLibraryId(remainingLibraries[0].id);
      } else {
        this.clearLastSelectedLibraryId();
      }
    }
    return { libraries: remainingLibraries };
  }

  getActiveLibrary(explicitLibraryId = null) {
    this.initialize();
    const selection = this.resolveSelection(explicitLibraryId);
    if (!selection.active) {
      return {
        libraries: selection.libraries,
        activeLibrary: null,
        librarySelectionRequired: selection.librarySelectionRequired,
      };
    }
    return {
      libraries: selection.libraries,
      activeLibrary: this.toActiveLibraryRecord(selection.active),
      librarySelectionRequired: false,
    };
  }

  normalizeLibrarySkill(skill) {
    return {
      ...skill,
      path: skill.path || skill.localPath,
    };
  }

  findGitRoot(startPath) {
    let current =
      this.fileSystem.existsSync(startPath) && this.fileSystem.statSync(startPath).isFile()
        ? path.dirname(startPath)
        : startPath;
    while (current && path.dirname(current) !== current) {
      const gitPath = path.join(current, ".git");
      if (this.fileSystem.existsSync(gitPath)) {
        return path.resolve(current);
      }
      current = path.dirname(current);
    }
    return null;
  }

  remoteToWebUrl(remoteUrl) {
    if (!remoteUrl) {
      return null;
    }
    const trimmed = remoteUrl.trim();
    let match = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (match) {
      return `https://github.com/${match[1]}/${match[2]}`;
    }
    match = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
    if (match) {
      return `https://github.com/${match[1]}/${match[2]}`;
    }
    return null;
  }

  gitRepoStatusForPath(skillPath, cache) {
    try {
      const repoRoot = this.findGitRoot(skillPath);
      if (!repoRoot) {
        throw new Error("not in repo");
      }
      if (cache.has(repoRoot)) {
        return cache.get(repoRoot);
      }
      let originUrl = null;
      let repoWebUrl = null;
      try {
        originUrl = this.runGit(["-C", repoRoot, "remote", "get-url", "origin"], repoRoot);
        repoWebUrl = this.remoteToWebUrl(originUrl);
      } catch {
        originUrl = null;
        repoWebUrl = null;
      }
      let status = {
        repoStatus: "up_to_date",
        repoStatusReason: "Git repo is up to date with its configured upstream.",
        repoRoot,
        repoOriginUrl: originUrl,
        repoWebUrl,
        repoAheadCount: 0,
        repoBehindCount: 0,
      };
      try {
        this.runGit(
          ["-C", repoRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
          repoRoot
        );
        const counts = this.runGit(
          ["-C", repoRoot, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
          repoRoot
        )
          .split(/\s+/)
          .map((value) => Number.parseInt(value, 10) || 0);
        const ahead = counts.length > 0 ? counts[0] : 0;
        const behind = counts.length > 1 ? counts[1] : 0;
        if (behind > 0) {
          status = {
            repoStatus: "needs_update",
            repoStatusReason:
              ahead > 0
                ? `Git repo has diverged: ${ahead} local commit${ahead === 1 ? "" : "s"} and ${behind} upstream commit${behind === 1 ? "" : "s"} to integrate.`
                : `Git repo is behind its upstream by ${behind} commit${behind === 1 ? "" : "s"}.`,
            repoRoot,
            repoOriginUrl: originUrl,
            repoWebUrl,
            repoAheadCount: ahead,
            repoBehindCount: behind,
          };
        } else {
          status = {
            repoStatus: "up_to_date",
            repoStatusReason:
              ahead > 0
                ? `Git repo is ahead of its upstream by ${ahead} commit${ahead === 1 ? "" : "s"}.`
                : "Git repo is up to date with its configured upstream.",
            repoRoot,
            repoOriginUrl: originUrl,
            repoWebUrl,
            repoAheadCount: ahead,
            repoBehindCount: behind,
          };
        }
      } catch {
        status = {
          repoStatus: "up_to_date",
          repoStatusReason:
            "Git repo has no upstream configured, so no update check was needed.",
          repoRoot,
          repoOriginUrl: originUrl,
          repoWebUrl,
          repoAheadCount: 0,
          repoBehindCount: 0,
        };
      }
      cache.set(repoRoot, status);
      return status;
    } catch {
      return {
        repoStatus: "not_repo",
        repoStatusReason: "Skill folder is not inside a Git repository.",
        repoRoot: null,
        repoOriginUrl: null,
        repoWebUrl: null,
        repoAheadCount: 0,
        repoBehindCount: 0,
      };
    }
  }

  pendingRepoStatus(skillPath) {
    const repoRoot = this.findGitRoot(skillPath);
    const cached = repoRoot ? this.repoStatusCache.get(repoRoot) : null;
    if (cached) {
      return cached;
    }
    return {
      repoStatus: "pending",
      repoStatusReason: repoRoot
        ? "Git status check is pending."
        : "Skill folder is not inside a Git repository.",
      repoRoot,
      repoOriginUrl: null,
      repoWebUrl: null,
      repoAheadCount: 0,
      repoBehindCount: 0,
    };
  }

  repoStatusesForSkills(skills) {
    const localCache = new Map(this.repoStatusCache);
    const patches = [];
    for (const skill of skills.slice().sort((left, right) => left.name.localeCompare(right.name))) {
      const status = this.gitRepoStatusForPath(skill.path || skill.localPath, localCache);
      if (status.repoRoot) {
        this.repoStatusCache.set(status.repoRoot, status);
      }
      patches.push({
        name: skill.name,
        path: skill.path || skill.localPath,
        ...status,
      });
    }
    return patches;
  }

  applyScopeState(row, scopeState, installedKey, conflictKey, entryKey, targetKey, stateKey) {
    row[stateKey] = scopeState.state;
    row[installedKey] = scopeState.installed;
    row[conflictKey] = scopeState.conflict;
    if (scopeState.conflict) {
      row[entryKey] = scopeState.entryPath;
      try {
        row[targetKey] = this.fileSystem.realpathSync.native(scopeState.entryPath);
      } catch {
        row[targetKey] = scopeState.entryPath;
      }
    }
  }

  buildRows(projectRoot, skills, options = {}) {
    const localRepoStatusCache = new Map(this.repoStatusCache);
    const rows = skills.map((skill) => {
      const row = {
        ...this.normalizeLibrarySkill(skill),
      };
      Object.assign(
        row,
        options.includeGit
          ? this.gitRepoStatusForPath(row.path, localRepoStatusCache)
          : this.pendingRepoStatus(row.path)
      );
      if (row.repoRoot && row.repoStatus !== "pending") {
        this.repoStatusCache.set(row.repoRoot, {
          repoStatus: row.repoStatus,
          repoStatusReason: row.repoStatusReason,
          repoRoot: row.repoRoot,
          repoOriginUrl: row.repoOriginUrl,
          repoWebUrl: row.repoWebUrl,
          repoAheadCount: row.repoAheadCount,
          repoBehindCount: row.repoBehindCount,
        });
      }
      this.applyScopeState(
        row,
        this.installer.repoInstallState(row, projectRoot),
        "installed",
        "conflict",
        "project_entry",
        "project_entry_target",
        "project_install_state"
      );
      this.applyScopeState(
        row,
        this.installer.globalInstallState(row),
        "global_installed",
        "global_conflict",
        "global_entry",
        "global_entry_target",
        "global_install_state"
      );
      return row;
    });

    rows.sort((left, right) => {
      const leftScore = (left.installed ? 4 : 0) + (left.global_installed ? 2 : 0);
      const rightScore = (right.installed ? 4 : 0) + (right.global_installed ? 2 : 0);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return left.name.localeCompare(right.name);
    });

    return rows;
  }

  statusSnapshot(project = null, options = {}) {
    const projectRoot = this.installer.resolveProjectRoot(project);
    const snapshot = {
      configured: false,
      librarySelectionRequired: false,
      libraries: [],
      selectedLibraryId: null,
      appConfigPath: this.appConfigPath,
      databasePath: this.databasePath,
      globalRoot: this.installer.globalSkillsRoot(),
      projectRoot,
      skills: [],
      enabled: [],
      conflicts: [],
      globalEnabled: [],
      globalConflicts: [],
      allTags: [],
      skillCount: 0,
      enabledCount: 0,
      conflictCount: 0,
      globalEnabledCount: 0,
      globalConflictCount: 0,
    };

    try {
      const selection = this.getActiveLibrary(options.selectedLibraryId || null);
      snapshot.libraries = selection.libraries;

      if (!selection.libraries.length) {
        return snapshot;
      }

      if (!selection.activeLibrary) {
        return {
          ...snapshot,
          configured: true,
          librarySelectionRequired: true,
        };
      }

      const skills = selection.activeLibrary.listSkills();
      const rows = this.buildRows(projectRoot, skills, {
        includeGit: Boolean(options.includeGit),
      });
      const enabled = rows.filter((row) => row.installed);
      const conflicts = rows.filter((row) => row.conflict);
      const globalEnabled = rows.filter((row) => row.global_installed);
      const globalConflicts = rows.filter((row) => row.global_conflict);

      return {
        ...snapshot,
        configured: true,
        selectedLibraryId: selection.activeLibrary.libraryId,
        libraryRoot: selection.activeLibrary.localPath,
        skills: rows,
        enabled,
        conflicts,
        globalEnabled,
        globalConflicts,
        allTags: allTagsFromRows(rows),
        skillCount: rows.length,
        enabledCount: enabled.length,
        conflictCount: conflicts.length,
        globalEnabledCount: globalEnabled.length,
        globalConflictCount: globalConflicts.length,
      };
    } catch (error) {
      if (
        error instanceof ActiveSkillLibraryError ||
        error instanceof SkillLibraryError ||
        error instanceof SkillInstallerError ||
        error instanceof AppConfigError
      ) {
        return {
          ...snapshot,
          error: error.message,
        };
      }
      throw error;
    }
  }

  refreshRepoStatuses(project = null, options = {}) {
    if (options.force) {
      this.repoStatusCache.clear();
    }
    const selection = this.getActiveLibrary(options.selectedLibraryId || null);
    return {
      projectRoot: this.installer.resolveProjectRoot(project),
      repoStatuses: selection.activeLibrary
        ? this.repoStatusesForSkills(selection.activeLibrary.listSkills())
        : [],
    };
  }

  refreshLibrary(libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    const skills = selection.activeLibrary.refreshLibrary();
    return {
      libraryId: selection.activeLibrary.libraryId,
      libraryRoot: selection.activeLibrary.localPath,
      skillCount: skills.length,
      status: "refreshed",
    };
  }

  enableSkill(skillName, project = null, force = false, libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    const skill = selection.activeLibrary.getSkillOrThrow(skillName);
    return this.installer.enableSkill(skill, project, force);
  }

  disableSkill(skillName, project = null) {
    return this.installer.disableSkill(skillName, project);
  }

  installGlobalSkill(skillName, force = false, libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    const skill = selection.activeLibrary.getSkillOrThrow(skillName);
    return this.installer.installGlobalSkill(skill, force);
  }

  uninstallGlobalSkill(skillName) {
    return this.installer.uninstallGlobalSkill(skillName);
  }

  updateSkillRepo(skillName, project = null, libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    const skill = selection.activeLibrary.getSkillOrThrow(skillName);
    const repoInfo = this.gitRepoStatusForPath(skill.localPath, new Map());
    if (!repoInfo.repoRoot) {
      throw new ActiveSkillLibraryError(`Skill ${skill.name} is not inside a Git repository.`);
    }
    if (repoInfo.repoStatus !== "needs_update") {
      return {
        skill: skill.name,
        repoRoot: repoInfo.repoRoot,
        status: "already-up-to-date",
      };
    }
    const dirty = this.runGit(["-C", repoInfo.repoRoot, "status", "--porcelain"], repoInfo.repoRoot);
    if (dirty) {
      throw new ActiveSkillLibraryError(
        `Repo ${repoInfo.repoRoot} has local changes. Commit or stash them before updating.`
      );
    }
    try {
      if ((repoInfo.repoAheadCount || 0) > 0) {
        this.runGit(["-C", repoInfo.repoRoot, "pull", "--rebase"], repoInfo.repoRoot);
      } else {
        this.runGit(["-C", repoInfo.repoRoot, "pull", "--ff-only"], repoInfo.repoRoot);
      }
    } catch (error) {
      throw new ActiveSkillLibraryError(
        `Failed to update repo ${repoInfo.repoRoot}: ${error.message}`
      );
    }
    this.repoStatusCache.delete(repoInfo.repoRoot);
    return {
      skill: skill.name,
      repoRoot: repoInfo.repoRoot,
      projectRoot: this.installer.resolveProjectRoot(project),
      status: "updated",
    };
  }

  setSkillTags(skillName, tags, libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    return selection.activeLibrary.setSkillTags(skillName, tags);
  }

  deleteLibrarySkill(skillName, project = null, libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    return selection.activeLibrary.deleteLibrarySkill(skillName, project);
  }

  readSkillMarkdown(skillName, libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    return selection.activeLibrary.readSkillMarkdown(skillName);
  }

  addSkillsFromRepository(repoUrl, libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    return this.repositoryImporter.addSkillsFromRepository({
      libraryId: selection.activeLibrary.libraryId,
      libraryRoot: selection.activeLibrary.localPath,
      repoUrl,
    });
  }

  cleanupImportedRepository(destination, libraryId = null) {
    const selection = this.getActiveLibrary(libraryId);
    if (!selection.activeLibrary) {
      throw new ActiveSkillLibraryError("No skill library is selected.");
    }
    return this.repositoryImporter.cleanupClonedDestination({
      libraryRoot: selection.activeLibrary.localPath,
      destination,
    });
  }

  listDirectories(targetPath = null) {
    if (process.platform === "win32" && !targetPath) {
      const entries = [];
      for (let index = 0; index < 26; index += 1) {
        const letter = String.fromCharCode("A".charCodeAt(0) + index);
        const drivePath = `${letter}:\\`;
        if (this.fileSystem.existsSync(drivePath)) {
          entries.push({ name: drivePath, path: drivePath });
        }
      }
      return { currentPath: "", parentPath: null, entries };
    }
    const currentPath = path.resolve(targetPath || process.cwd());
    if (!this.fileSystem.existsSync(currentPath) || !this.fileSystem.statSync(currentPath).isDirectory()) {
      throw new ActiveSkillLibraryError(`Folder does not exist: ${currentPath}`);
    }
    const entries = this.fileSystem
      .readdirSync(currentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(currentPath, entry.name),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    let parentPath = path.dirname(currentPath.replace(/[\\\/]+$/, ""));
    if (!parentPath || parentPath === currentPath) {
      parentPath = process.platform === "win32" ? "" : null;
    }
    return {
      currentPath,
      parentPath,
      entries,
    };
  }
}

module.exports = {
  ActiveSkillLibrary,
  ActiveSkillLibraryError,
};
