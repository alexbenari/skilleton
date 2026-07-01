const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { SkillLibraryError } = require("./skill-library");

class SkillRepositoryImporterError extends Error {}

function defaultRunGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

class SkillRepositoryImporter {
  constructor({
    db,
    discovery,
    fileSystem = fs,
    runGit = defaultRunGit,
  } = {}) {
    this.db = db;
    this.discovery = discovery;
    this.fileSystem = fileSystem;
    this.runGit = runGit;
  }

  normalizeRepoUrl(repoUrl) {
    const trimmed = String(repoUrl || "").trim();
    if (!trimmed) {
      throw new SkillRepositoryImporterError("Repo URL is required.");
    }
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return trimmed;
    }
    if (parsed.hostname.toLowerCase() !== "github.com") {
      return trimmed;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return trimmed;
    }
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    return `https://github.com/${owner}/${repo}.git`;
  }

  repoNameFromUrl(repoUrl) {
    const trimmed = String(repoUrl || "").trim();
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length) {
        const name = parts[parts.length - 1].replace(/\.git$/i, "");
        if (name) {
          return name;
        }
      }
    }
    if (/^git@/i.test(trimmed)) {
      const sshParts = trimmed.split(":");
      const sshTail = sshParts[sshParts.length - 1].replace(/\\/g, "/");
      const sshName = (sshTail.split("/").pop() || "").replace(/\.git$/i, "");
      if (sshName) {
        return sshName;
      }
    }
    const slashNormalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
    let name = slashNormalized.split("/").pop() || "";
    name = name.replace(/\.git$/i, "");
    if (!name) {
      throw new SkillRepositoryImporterError(
        `Could not derive a folder name from repo URL: ${trimmed}`
      );
    }
    return name;
  }

  cleanupClonedDestination({ libraryRoot, destination }) {
    const resolvedLibraryRoot = path.resolve(libraryRoot);
    const resolvedDestination = path.resolve(destination);
    const relative = path.relative(resolvedLibraryRoot, resolvedDestination);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new SkillRepositoryImporterError(
        `Refusing to delete path outside the selected library root: ${resolvedDestination}`
      );
    }
    if (this.fileSystem.existsSync(resolvedDestination)) {
      this.fileSystem.rmSync(resolvedDestination, { recursive: true, force: true });
    }
    return { destination: resolvedDestination, status: "deleted" };
  }

  addSkillsFromRepository({ libraryId, libraryRoot, repoUrl }) {
    const trimmedUrl = this.normalizeRepoUrl(repoUrl);
    const repoName = this.repoNameFromUrl(trimmedUrl);
    const destination = path.join(libraryRoot, repoName);

    if (this.fileSystem.existsSync(destination)) {
      throw new SkillRepositoryImporterError(
        `Destination already exists in the library root: ${destination}`
      );
    }

    try {
      this.runGit(["clone", trimmedUrl, destination], libraryRoot);
    } catch (error) {
      throw new SkillRepositoryImporterError(`Failed to clone ${trimmedUrl}: ${error.message}`);
    }

    const { found, collisions } = this.discovery.discoverSkillsUnderPath(libraryRoot, destination);
    this.discovery.failOnCollisions(collisions, SkillRepositoryImporterError);

    const discoveredSkills = Array.from(found.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((skill) => ({
        name: skill.name,
        localPath: skill.localPath || skill.path,
        description: skill.description,
        source: skill.source,
        gitSourceUrl: trimmedUrl,
      }));

    if (!discoveredSkills.length) {
      return {
        status: "no-skills-found",
        repoUrl: trimmedUrl,
        destination,
        libraryRoot,
        repoName,
        cleanupOffered: true,
      };
    }

    const existingSkills = this.db.listSkills(libraryId);
    const existingSkillsByName = new Map(existingSkills.map((skill) => [skill.name, skill]));
    for (const skill of discoveredSkills) {
      const existing = existingSkillsByName.get(skill.name);
      if (existing) {
        return {
          status: "duplicate-name",
          repoUrl: trimmedUrl,
          destination,
          libraryRoot,
          repoName,
          duplicateName: skill.name,
          existingSkillId: existing.id,
          existingSkillLocalPath: existing.localPath,
          newSkillLocalPath: skill.localPath,
        };
      }
    }

    this.db.upsertSkills(libraryId, discoveredSkills);
    return {
      status: "cataloged",
      repoUrl: trimmedUrl,
      destination,
      libraryRoot,
      repoName,
      importedSkillNames: discoveredSkills.map((skill) => skill.name),
    };
  }
}

module.exports = {
  SkillRepositoryImporter,
  SkillRepositoryImporterError,
};
