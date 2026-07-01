const fs = require("fs");
const os = require("os");
const path = require("path");

const SKILL_FILENAME = "SKILL.md";

class SkillInstallerError extends Error {}

class SkillInstaller {
  constructor({
    fileSystem = fs,
    codexHomePath = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  } = {}) {
    this.fileSystem = fileSystem;
    this.codexHomePath = codexHomePath;
  }

  globalSkillsRoot() {
    return path.join(this.codexHomePath(), "skills");
  }

  globalSkillPath(skillName) {
    return path.join(this.globalSkillsRoot(), skillName);
  }

  projectSkillPath(projectRoot, skillName) {
    return path.join(projectRoot, ".agents", "skills", skillName);
  }

  resolveProjectRoot(project) {
    let start = project ? path.resolve(project) : process.cwd();
    if (this.fileSystem.existsSync(start) && this.fileSystem.statSync(start).isFile()) {
      start = path.dirname(start);
    }
    let current = start;
    while (true) {
      const gitPath = path.join(current, ".git");
      if (this.fileSystem.existsSync(gitPath)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return start;
      }
      current = parent;
    }
  }

  normalizePath(targetPath) {
    return path.normalize(this.fileSystem.realpathSync.native(targetPath)).toLowerCase();
  }

  ensureParentDir(targetPath) {
    const parent = path.dirname(targetPath);
    if (parent) {
      this.fileSystem.mkdirSync(parent, { recursive: true });
    }
  }

  listRelativeEntries(rootPath) {
    const entries = [];
    const stack = [""];
    while (stack.length) {
      const relativePath = stack.pop();
      const absolutePath = relativePath ? path.join(rootPath, relativePath) : rootPath;
      const dirEntries = this.fileSystem
        .readdirSync(absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (let index = dirEntries.length - 1; index >= 0; index -= 1) {
        const entry = dirEntries[index];
        const entryRelativePath = relativePath
          ? path.join(relativePath, entry.name)
          : entry.name;
        if (entry.isDirectory()) {
          entries.push({ relativePath: entryRelativePath, kind: "directory" });
          stack.push(entryRelativePath);
          continue;
        }
        if (entry.isSymbolicLink()) {
          entries.push({
            relativePath: entryRelativePath,
            kind: "symlink",
            target: this.fileSystem.readlinkSync(path.join(rootPath, entryRelativePath)),
          });
          continue;
        }
        entries.push({ relativePath: entryRelativePath, kind: "file" });
      }
    }
    return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  compareDirectoryTrees(sourcePath, targetPath) {
    const sourceEntries = this.listRelativeEntries(sourcePath);
    const targetEntries = this.listRelativeEntries(targetPath);
    if (sourceEntries.length !== targetEntries.length) {
      return false;
    }
    for (let index = 0; index < sourceEntries.length; index += 1) {
      const sourceEntry = sourceEntries[index];
      const targetEntry = targetEntries[index];
      if (sourceEntry.relativePath !== targetEntry.relativePath) {
        return false;
      }
      if (sourceEntry.kind !== targetEntry.kind) {
        return false;
      }
      if (sourceEntry.kind === "file") {
        const sourceBuffer = this.fileSystem.readFileSync(
          path.join(sourcePath, sourceEntry.relativePath)
        );
        const targetBuffer = this.fileSystem.readFileSync(
          path.join(targetPath, targetEntry.relativePath)
        );
        if (!sourceBuffer.equals(targetBuffer)) {
          return false;
        }
      }
      if (sourceEntry.kind === "symlink" && sourceEntry.target !== targetEntry.target) {
        return false;
      }
    }
    return true;
  }

  copyDirectory(sourcePath, targetPath) {
    if (this.fileSystem.existsSync(targetPath)) {
      this.removePath(targetPath);
    }
    this.ensureParentDir(targetPath);
    try {
      this.fileSystem.cpSync(sourcePath, targetPath, {
        recursive: true,
        errorOnExist: false,
        force: true,
        preserveTimestamps: false,
      });
    } catch (error) {
      throw new SkillInstallerError(
        `Failed to copy ${sourcePath} to ${targetPath}: ${error.message}`
      );
    }
  }

  removePath(targetPath) {
    if (!this.fileSystem.existsSync(targetPath)) {
      return;
    }
    let stats;
    try {
      stats = this.fileSystem.lstatSync(targetPath);
    } catch (error) {
      throw new SkillInstallerError(`Failed to inspect ${targetPath}: ${error.message}`);
    }
    try {
      if (stats.isSymbolicLink()) {
        this.fileSystem.unlinkSync(targetPath);
        return;
      }
      if (stats.isDirectory()) {
        this.fileSystem.rmSync(targetPath, { recursive: true, force: true });
        return;
      }
      this.fileSystem.rmSync(targetPath, { force: true });
    } catch (error) {
      throw new SkillInstallerError(`Failed to remove ${targetPath}: ${error.message}`);
    }
  }

  installState(entryPath, skillPath) {
    if (!this.fileSystem.existsSync(entryPath)) {
      return { state: "missing" };
    }
    try {
      const stats = this.fileSystem.lstatSync(entryPath);
      if (stats.isSymbolicLink()) {
        let equivalent = false;
        try {
          equivalent = this.normalizePath(entryPath) === this.normalizePath(skillPath);
        } catch {
          equivalent = false;
        }
        return equivalent ? { state: "linked-match" } : { state: "foreign-conflict" };
      }
      if (!stats.isDirectory()) {
        return { state: "foreign-conflict" };
      }
      if (!this.fileSystem.existsSync(path.join(entryPath, SKILL_FILENAME))) {
        return { state: "foreign-conflict" };
      }
      return this.compareDirectoryTrees(skillPath, entryPath)
        ? { state: "copied-match" }
        : { state: "copied-modified" };
    } catch (error) {
      throw new SkillInstallerError(`Failed to inspect ${entryPath}: ${error.message}`);
    }
  }

  isInstalledState(state) {
    return state === "copied-match" || state === "copied-modified" || state === "linked-match";
  }

  isConflictState(state) {
    return state === "foreign-conflict";
  }

  repoInstallState(skill, project) {
    const projectRoot = this.resolveProjectRoot(project);
    const entryPath = this.projectSkillPath(projectRoot, skill.name);
    const current = this.installState(entryPath, skill.path || skill.localPath);
    return {
      ...current,
      projectRoot,
      entryPath,
      installed: this.isInstalledState(current.state),
      conflict: this.isConflictState(current.state),
    };
  }

  globalInstallState(skill) {
    const entryPath = this.globalSkillPath(skill.name);
    const current = this.installState(entryPath, skill.path || skill.localPath);
    return {
      ...current,
      entryPath,
      installed: this.isInstalledState(current.state),
      conflict: this.isConflictState(current.state),
    };
  }

  enableSkill(skill, project = null, force = false) {
    const repoState = this.repoInstallState(skill, project);
    if (repoState.state === "missing") {
      this.copyDirectory(skill.path || skill.localPath, repoState.entryPath);
      return {
        skill: skill.name,
        projectRoot: repoState.projectRoot,
        entry: repoState.entryPath,
        path: skill.path || skill.localPath,
        status: "enabled",
      };
    }
    if (repoState.state === "linked-match") {
      this.copyDirectory(skill.path || skill.localPath, repoState.entryPath);
      return {
        skill: skill.name,
        projectRoot: repoState.projectRoot,
        entry: repoState.entryPath,
        path: skill.path || skill.localPath,
        status: "migrated-link",
      };
    }
    if (repoState.state === "copied-match") {
      this.copyDirectory(skill.path || skill.localPath, repoState.entryPath);
      return {
        skill: skill.name,
        projectRoot: repoState.projectRoot,
        entry: repoState.entryPath,
        path: skill.path || skill.localPath,
        status: "refreshed",
      };
    }
    if ((repoState.state === "copied-modified" || repoState.state === "foreign-conflict") && !force) {
      return {
        skill: skill.name,
        projectRoot: repoState.projectRoot,
        entry: repoState.entryPath,
        path: skill.path || skill.localPath,
        status: "blocked-modified",
      };
    }
    this.copyDirectory(skill.path || skill.localPath, repoState.entryPath);
    return {
      skill: skill.name,
      projectRoot: repoState.projectRoot,
      entry: repoState.entryPath,
      path: skill.path || skill.localPath,
      status: "replaced",
    };
  }

  disableSkill(skillName, project = null) {
    const projectRoot = this.resolveProjectRoot(project);
    const entry = this.projectSkillPath(projectRoot, skillName);
    if (!this.fileSystem.existsSync(entry)) {
      return { skill: skillName, projectRoot, entry, status: "not-enabled" };
    }
    this.removePath(entry);
    return { skill: skillName, projectRoot, entry, status: "disabled" };
  }

  installGlobalSkill(skill, force = false) {
    const globalState = this.globalInstallState(skill);
    if (globalState.state === "missing") {
      this.copyDirectory(skill.path || skill.localPath, globalState.entryPath);
      return {
        skill: skill.name,
        entry: globalState.entryPath,
        path: skill.path || skill.localPath,
        globalRoot: this.globalSkillsRoot(),
        status: "installed",
      };
    }
    if (globalState.state === "linked-match") {
      this.copyDirectory(skill.path || skill.localPath, globalState.entryPath);
      return {
        skill: skill.name,
        entry: globalState.entryPath,
        path: skill.path || skill.localPath,
        globalRoot: this.globalSkillsRoot(),
        status: "migrated-link",
      };
    }
    if (globalState.state === "copied-match") {
      this.copyDirectory(skill.path || skill.localPath, globalState.entryPath);
      return {
        skill: skill.name,
        entry: globalState.entryPath,
        path: skill.path || skill.localPath,
        globalRoot: this.globalSkillsRoot(),
        status: "refreshed",
      };
    }
    if ((globalState.state === "copied-modified" || globalState.state === "foreign-conflict") && !force) {
      return {
        skill: skill.name,
        entry: globalState.entryPath,
        path: skill.path || skill.localPath,
        globalRoot: this.globalSkillsRoot(),
        status: "blocked-modified",
      };
    }
    this.copyDirectory(skill.path || skill.localPath, globalState.entryPath);
    return {
      skill: skill.name,
      entry: globalState.entryPath,
      path: skill.path || skill.localPath,
      globalRoot: this.globalSkillsRoot(),
      status: "replaced",
    };
  }

  uninstallGlobalSkill(skillName) {
    const entry = this.globalSkillPath(skillName);
    if (!this.fileSystem.existsSync(entry)) {
      return {
        skill: skillName,
        entry,
        globalRoot: this.globalSkillsRoot(),
        status: "not-installed",
      };
    }
    this.removePath(entry);
    return {
      skill: skillName,
      entry,
      globalRoot: this.globalSkillsRoot(),
      status: "uninstalled",
    };
  }
}

module.exports = {
  SkillInstaller,
  SkillInstallerError,
};
