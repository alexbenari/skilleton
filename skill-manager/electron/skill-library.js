const fs = require("fs");
const path = require("path");

const { SkillInstallerError } = require("./skill-installer");

class SkillLibraryError extends Error {}

function normalizeTags(tags) {
  const source = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return Array.from(
    new Set(
      source
        .map((tag) => String(tag).trim().toLowerCase())
        .filter((tag) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag))
    )
  ).sort((left, right) => left.localeCompare(right));
}

function allTagsFromRows(rows) {
  const tags = new Set();
  for (const row of rows) {
    for (const tag of row.tags || []) {
      tags.add(tag);
    }
  }
  return Array.from(tags).sort((left, right) => left.localeCompare(right));
}

class SkillLibrary {
  constructor({
    libraryId,
    localPath,
    db,
    discovery,
    installer,
    fileSystem = fs,
  } = {}) {
    if (!Number.isInteger(libraryId)) {
      throw new SkillLibraryError("libraryId is required.");
    }
    if (!localPath) {
      throw new SkillLibraryError("localPath is required.");
    }
    if (!db) {
      throw new SkillLibraryError("db is required.");
    }
    if (!discovery) {
      throw new SkillLibraryError("discovery is required.");
    }
    if (!installer) {
      throw new SkillLibraryError("installer is required.");
    }

    this.libraryId = libraryId;
    this.localPath = localPath;
    this.db = db;
    this.discovery = discovery;
    this.installer = installer;
    this.fileSystem = fileSystem;
  }

  getSkillOrThrow(skillName) {
    const skill = this.listSkills().find((row) => row.name === skillName);
    if (!skill) {
      throw new SkillLibraryError(`Skill ${skillName} not found.`);
    }
    return skill;
  }

  listSkills() {
    return this.db.listSkills(this.libraryId).map((skill) => ({
      ...skill,
      path: skill.localPath,
    }));
  }

  refreshLibrary() {
    if (!this.fileSystem.existsSync(this.localPath) || !this.fileSystem.statSync(this.localPath).isDirectory()) {
      throw new SkillLibraryError(`Library root does not exist or is not a directory: ${this.localPath}`);
    }

    const { found, collisions } = this.discovery.discoverLibrarySkills(this.localPath);
    this.discovery.failOnCollisions(collisions, SkillLibraryError);

    const discoveredSkills = Array.from(found.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((skill) => ({
        name: skill.name,
        localPath: skill.localPath || skill.path,
        description: skill.description,
        source: skill.source || this.discovery.skillSourceFromPath(this.localPath, skill.path, skill.name),
        gitSourceUrl: skill.gitSourceUrl || null,
      }));

    return this.db.replaceLibrarySkills(this.libraryId, discoveredSkills).map((skill) => ({
      ...skill,
      path: skill.localPath,
    }));
  }

  setSkillTags(skillName, tags) {
    const skill = this.getSkillOrThrow(skillName);
    const nextTags = normalizeTags(tags);
    this.db.setSkillTags(this.libraryId, skill.name, nextTags);
    const rows = this.listSkills();
    return {
      skill: skill.name,
      tags: nextTags,
      allTags: allTagsFromRows(rows),
      status: "updated",
    };
  }

  readSkillMarkdown(skillName) {
    const skill = this.getSkillOrThrow(skillName);
    try {
      const markdown = this.discovery.readSkillMarkdown(skill.localPath);
      return {
        skill: skill.name,
        path: markdown.path,
        content: markdown.content,
      };
    } catch (error) {
      throw new SkillLibraryError(error.message);
    }
  }

  deleteLibrarySkill(skillName, project = null) {
    const skill = this.getSkillOrThrow(skillName);
    const repoState = this.installer.repoInstallState(skill, project);
    if (repoState.installed) {
      throw new SkillLibraryError(
        `Skill ${skill.name} is enabled in the current project. Disable it before deleting it from the library.`
      );
    }

    const globalState = this.installer.globalInstallState(skill);
    if (globalState.installed) {
      throw new SkillLibraryError(
        `Skill ${skill.name} is installed globally. Uninstall it before deleting it from the library.`
      );
    }

    let insideLibrary = false;
    try {
      insideLibrary =
        path
          .relative(this.installer.normalizePath(this.localPath), this.installer.normalizePath(skill.localPath))
          .startsWith("..") === false;
    } catch {
      insideLibrary = false;
    }
    if (!insideLibrary) {
      throw new SkillLibraryError(
        `Refusing to delete skill outside the configured library root: ${skill.localPath}`
      );
    }

    try {
      this.installer.removePath(skill.localPath);
    } catch (error) {
      if (error instanceof SkillInstallerError) {
        throw new SkillLibraryError(error.message);
      }
      throw error;
    }

    this.db.deleteSkill(skill.id);
    return {
      skill: skill.name,
      path: skill.localPath,
      projectRoot: repoState.projectRoot,
      libraryRoot: this.localPath,
      status: "deleted",
    };
  }
}

module.exports = {
  SkillLibrary,
  SkillLibraryError,
  allTagsFromRows,
  normalizeTags,
};
