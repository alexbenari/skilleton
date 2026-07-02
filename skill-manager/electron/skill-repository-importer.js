const fs = require("fs");
const os = require("os");
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
    tempRootPath = os.tmpdir(),
  } = {}) {
    this.db = db;
    this.discovery = discovery;
    this.fileSystem = fileSystem;
    this.runGit = runGit;
    this.tempRootPath = tempRootPath;
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
    return this.cleanupPathWithinRoot({ rootPath: libraryRoot, targetPath: destination });
  }

  cleanupPathWithinRoot({ rootPath, targetPath }) {
    const resolvedRootPath = path.resolve(rootPath);
    const resolvedTargetPath = path.resolve(targetPath);
    const relative = path.relative(resolvedRootPath, resolvedTargetPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new SkillRepositoryImporterError(
        `Refusing to delete path outside the selected library root: ${resolvedTargetPath}`
      );
    }
    if (this.fileSystem.existsSync(resolvedTargetPath)) {
      this.fileSystem.rmSync(resolvedTargetPath, { recursive: true, force: true });
    }
    return { destination: resolvedTargetPath, status: "deleted" };
  }

  createTempImportParent() {
    const tempBasePath = path.join(this.tempRootPath, "skill-manager");
    this.fileSystem.mkdirSync(tempBasePath, { recursive: true });
    return this.fileSystem.mkdtempSync(path.join(tempBasePath, "repo-import-"));
  }

  cleanupTempImportParent(tempImportParent) {
    if (!tempImportParent || !this.fileSystem.existsSync(tempImportParent)) {
      return;
    }
    this.fileSystem.rmSync(tempImportParent, { recursive: true, force: true });
  }

  readGitProvenance(repoPath) {
    let gitImportedRevision;
    try {
      gitImportedRevision = this.runGit(["rev-parse", "HEAD"], repoPath);
    } catch (error) {
      throw new SkillRepositoryImporterError(
        `Failed to read imported revision from ${repoPath}: ${error.message}`
      );
    }

    let gitTrackedRef = null;
    try {
      const headRef = this.runGit(["symbolic-ref", "--short", "HEAD"], repoPath);
      if (headRef && headRef !== "HEAD") {
        gitTrackedRef = headRef;
      }
    } catch {
      gitTrackedRef = null;
    }

    return {
      gitTrackedRef,
      gitImportedRevision,
    };
  }

  translateSkillPathToLibrary(skillPath, tempImportParent, libraryRoot) {
    const relativeSkillPath = path.relative(path.resolve(tempImportParent), path.resolve(skillPath));
    if (!relativeSkillPath || relativeSkillPath.startsWith("..") || path.isAbsolute(relativeSkillPath)) {
      throw new SkillRepositoryImporterError(
        `Discovered skill path was outside the temp import parent: ${skillPath}`
      );
    }
    return path.join(libraryRoot, relativeSkillPath);
  }

  discoveredSkillsForImport({
    tempImportParent,
    tempClonePath,
    libraryRoot,
    repoUrl,
    gitTrackedRef,
    gitImportedRevision,
  }) {
    const { found, collisions } = this.discovery.discoverSkillsUnderPath(tempImportParent, tempClonePath);
    this.discovery.failOnCollisions(collisions, SkillRepositoryImporterError);

    return Array.from(found.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((skill) => ({
        name: skill.name,
        localPath: this.translateSkillPathToLibrary(
          skill.localPath || skill.path,
          tempImportParent,
          libraryRoot
        ),
        description: skill.description,
        source: skill.source,
        gitSourceUrl: repoUrl,
        gitTrackedRef,
        gitImportedRevision,
      }));
  }

  copyRepoTreeExcludingGit(sourcePath, destinationPath) {
    this.fileSystem.mkdirSync(destinationPath, { recursive: true });
    const entries = this.fileSystem.readdirSync(sourcePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }

      const sourceEntryPath = path.join(sourcePath, entry.name);
      const destinationEntryPath = path.join(destinationPath, entry.name);

      if (entry.isDirectory()) {
        this.copyRepoTreeExcludingGit(sourceEntryPath, destinationEntryPath);
        continue;
      }

      if (entry.isFile()) {
        this.fileSystem.copyFileSync(sourceEntryPath, destinationEntryPath);
        continue;
      }

      throw new SkillRepositoryImporterError(
        `Unsupported filesystem entry during import: ${sourceEntryPath}`
      );
    }
  }

  duplicateNameResult({ discoveredSkills, existingSkillsByName, repoUrl, destination, libraryRoot, repoName }) {
    for (const skill of discoveredSkills) {
      const existing = existingSkillsByName.get(skill.name);
      if (!existing) {
        continue;
      }

      return {
        status: "duplicate-name",
        repoUrl,
        destination,
        libraryRoot,
        repoName,
        duplicateName: skill.name,
        existingSkillId: existing.id,
        existingSkillLocalPath: existing.localPath,
        newSkillLocalPath: skill.localPath,
        newSkillRelativePath: path.relative(destination, skill.localPath),
      };
    }

    return null;
  }

  addSkillsFromRepository({ libraryId, libraryRoot, repoUrl }) {
    const trimmedUrl = this.normalizeRepoUrl(repoUrl);
    const repoName = this.repoNameFromUrl(trimmedUrl);
    const destination = path.join(libraryRoot, repoName);
    let tempImportParent = null;
    let tempClonePath = null;
    let destinationWritten = false;
    let result = null;
    let failure = null;

    try {
      if (this.fileSystem.existsSync(destination)) {
        throw new SkillRepositoryImporterError(
          `Destination already exists in the library root: ${destination}`
        );
      }

      tempImportParent = this.createTempImportParent();
      tempClonePath = path.join(tempImportParent, repoName);

      try {
        this.runGit(["clone", trimmedUrl, tempClonePath], tempImportParent);
      } catch (error) {
        throw new SkillRepositoryImporterError(`Failed to clone ${trimmedUrl}: ${error.message}`);
      }

      const { gitTrackedRef, gitImportedRevision } = this.readGitProvenance(tempClonePath);
      const discoveredSkills = this.discoveredSkillsForImport({
        tempImportParent,
        tempClonePath,
        libraryRoot,
        repoUrl: trimmedUrl,
        gitTrackedRef,
        gitImportedRevision,
      });

      if (!discoveredSkills.length) {
        result = {
          status: "no-skills-found",
          repoUrl: trimmedUrl,
          destination,
          libraryRoot,
          repoName,
        };
      }

      if (!result) {
        const existingSkills = this.db.listSkills(libraryId);
        const existingSkillsByName = new Map(existingSkills.map((skill) => [skill.name, skill]));
        const duplicateResult = this.duplicateNameResult({
          discoveredSkills,
          existingSkillsByName,
          repoUrl: trimmedUrl,
          destination,
          libraryRoot,
          repoName,
        });
        if (duplicateResult) {
          result = duplicateResult;
        }
      }

      if (!result) {
        this.copyRepoTreeExcludingGit(tempClonePath, destination);
        destinationWritten = true;
        this.db.upsertSkills(libraryId, discoveredSkills);
        result = {
          status: "cataloged",
          repoUrl: trimmedUrl,
          destination,
          libraryRoot,
          repoName,
          importedSkillNames: discoveredSkills.map((skill) => skill.name),
        };
      }
    } catch (error) {
      failure = error;
    }

    if (failure && destinationWritten) {
      try {
        this.cleanupClonedDestination({ libraryRoot, destination });
      } catch (cleanupError) {
        if (failure) {
          failure = new SkillRepositoryImporterError(
            `${failure.message} Cleanup also failed for ${destination}: ${cleanupError.message}`
          );
        } else {
          failure = cleanupError;
        }
      }
    }

    try {
      this.cleanupTempImportParent(tempImportParent);
    } catch (cleanupError) {
      if (failure) {
        throw new SkillRepositoryImporterError(
          `${failure.message} Temp cleanup also failed for ${tempImportParent}: ${cleanupError.message}`
        );
      }
      throw new SkillRepositoryImporterError(
        `Temp cleanup failed for ${tempImportParent}: ${cleanupError.message}`
      );
    }

    if (failure) {
      throw failure;
    }
    return result;
  }
}

module.exports = {
  SkillRepositoryImporter,
  SkillRepositoryImporterError,
};
