const fs = require("fs");
const path = require("path");

class EvaluationWorkspaceError extends Error {}

const WORKSPACE_ROOT_NAME = "skill-manager-evaluation";
const RUN_MANIFEST_FILENAME = "run-manifest.json";

const INSTRUCTION_FILENAMES = [
  "CLAUDE.md",
  "CLAUDE.local.md",
  "AGENTS.md",
  "AGENTS.override.md",
];
const INSTRUCTION_RELATIVE_PATHS = [
  path.join(".claude", "CLAUDE.md"),
  path.join(".claude", "rules"),
];

class PreparedRun {
  constructor({ evaluationId, role, runIndex, rootPath, workspacePath, artifactsPath }) {
    this.evaluationId = evaluationId;
    this.role = role;
    this.runIndex = runIndex;
    this.rootPath = rootPath;
    this.workspacePath = workspacePath;
    this.artifactsPath = artifactsPath;
    this.activationArtifacts = [];
    this.transcriptPath = path.join(artifactsPath, "transcript.jsonl");
    this.lastMessagePath = path.join(artifactsPath, "last-message.txt");
  }

  runManifestPath() {
    return path.join(this.workspacePath, RUN_MANIFEST_FILENAME);
  }

  recordActivation(artifacts) {
    this.activationArtifacts = [...artifacts];
    return this;
  }

  isActivationArtifact(relativePath) {
    const normalized = relativePath.split(path.sep).join("/");
    return this.activationArtifacts.some((artifact) => {
      const artifactPath = artifact.split(path.sep).join("/");
      return normalized === artifactPath || normalized.startsWith(`${artifactPath}/`);
    });
  }

  toJSON() {
    return {
      evaluationId: this.evaluationId,
      role: this.role,
      runIndex: this.runIndex,
      workspacePath: this.workspacePath,
      artifactsPath: this.artifactsPath,
      activationArtifacts: [...this.activationArtifacts],
    };
  }
}

class EvaluationWorkspace {
  constructor({ tempRootPath, fileSystem = fs, execFile = null } = {}) {
    if (!tempRootPath) {
      throw new EvaluationWorkspaceError("tempRootPath is required.");
    }
    this.tempRootPath = tempRootPath;
    this.fileSystem = fileSystem;
    this.execFile = execFile;
  }

  baseFor(evaluationId) {
    return path.join(this.tempRootPath, WORKSPACE_ROOT_NAME, evaluationId);
  }

  // Both agents walk upward for instruction files, so a workspace placed under
  // any directory carrying one would feed that guidance into both arms and the
  // comparison would measure nothing.
  //
  // The walk starts at the workspace's parent. The workspace's own instruction
  // file is what activation writes, and a leftover one from a previous run at
  // the same path is removed by prepare before the agent starts. A fixture that
  // ships one is caught by assertNoFixtureCollision instead.
  assertNoInstructionAncestry(targetPath) {
    let current = path.dirname(path.resolve(targetPath));
    while (true) {
      for (const filename of INSTRUCTION_FILENAMES) {
        const candidate = path.join(current, filename);
        if (this.fileSystem.existsSync(candidate)) {
          throw new EvaluationWorkspaceError(
            `Run workspace ${targetPath} would inherit ${candidate}; ` +
              "prepare workspaces outside any directory holding instruction files."
          );
        }
      }
      for (const relativePath of INSTRUCTION_RELATIVE_PATHS) {
        const candidate = path.join(current, relativePath);
        if (this.fileSystem.existsSync(candidate)) {
          throw new EvaluationWorkspaceError(
            `Run workspace ${targetPath} would inherit ${candidate}; ` +
              "prepare workspaces outside any directory holding instruction files."
          );
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return;
      }
      current = parent;
    }
  }

  assertNoFixtureCollision(target, scenario = null) {
    if (scenario && scenario.pins && scenario.pins.declaresInstructionCollision) {
      return;
    }
    const contentPath = target.contentPath;
    if (!this.fileSystem.existsSync(contentPath)) {
      throw new EvaluationWorkspaceError(
        `Evaluation target ${target.id} has no content directory at ${contentPath}.`
      );
    }
    const offenders = [];
    const walk = (currentPath, relativePrefix) => {
      for (const entry of this.fileSystem.readdirSync(currentPath, { withFileTypes: true })) {
        const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (relativePath.endsWith(".claude/rules")) {
            offenders.push(relativePath);
          }
          walk(path.join(currentPath, entry.name), relativePath);
        } else if (INSTRUCTION_FILENAMES.includes(entry.name)) {
          offenders.push(relativePath);
        }
      }
    };
    walk(contentPath, "");
    if (offenders.length > 0) {
      throw new EvaluationWorkspaceError(
        `Evaluation target ${target.id} ships instruction files (${offenders.join(", ")}) ` +
          "that would collide with an instruction-file subject; remove them or declare the " +
          "collision in the scenario."
      );
    }
  }

  initializeGitRepository(workspacePath) {
    if (!this.execFile) {
      throw new EvaluationWorkspaceError(
        "This target asks for a Git repository in the workspace, but no execFile was provided."
      );
    }
    this.execFile("git", ["init", "--quiet"], { cwd: workspacePath });
  }

  prepare({ evaluationId, role, runIndex, target, scenario = null }) {
    this.assertNoFixtureCollision(target, scenario);
    const rootPath = path.join(this.baseFor(evaluationId), role, `run-${runIndex}`);
    const workspacePath = path.join(rootPath, "workspace");
    const artifactsPath = path.join(rootPath, "artifacts");
    this.fileSystem.rmSync(rootPath, { recursive: true, force: true });
    this.assertNoInstructionAncestry(workspacePath);
    this.fileSystem.mkdirSync(workspacePath, { recursive: true });
    this.fileSystem.mkdirSync(artifactsPath, { recursive: true });
    this.fileSystem.cpSync(target.contentPath, workspacePath, { recursive: true });
    if (target.initializeGitRepository) {
      this.initializeGitRepository(workspacePath);
    }
    return new PreparedRun({
      evaluationId,
      role,
      runIndex,
      rootPath,
      workspacePath,
      artifactsPath,
    });
  }

  discard(evaluationId) {
    this.fileSystem.rmSync(this.baseFor(evaluationId), { recursive: true, force: true });
  }
}

module.exports = {
  EvaluationWorkspaceError,
  EvaluationWorkspace,
  PreparedRun,
  INSTRUCTION_FILENAMES,
  INSTRUCTION_RELATIVE_PATHS,
  RUN_MANIFEST_FILENAME,
  WORKSPACE_ROOT_NAME,
};
