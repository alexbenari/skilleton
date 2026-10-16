const fs = require("fs");
const path = require("path");

const { EvaluationDefinition } = require("./evaluation-definition");
const { listDirectoryNames } = require("./evaluation-fs");

class EvaluationStoreError extends Error {}

const DEFINITIONS_DIRECTORY = "definitions";
const ARM_RESULTS_DIRECTORY = "arm-results";
const COMPARISONS_DIRECTORY = "comparisons";
const VERSION_FILE_PATTERN = /^v(\d+)\.json$/;

class EvaluationStore {
  constructor({ rootPath, fileSystem = fs } = {}) {
    if (!rootPath) {
      throw new EvaluationStoreError("rootPath is required.");
    }
    this.rootPath = rootPath;
    this.fileSystem = fileSystem;
  }

  definitionsPath() {
    return path.join(this.rootPath, DEFINITIONS_DIRECTORY);
  }

  armResultsPath() {
    return path.join(this.rootPath, ARM_RESULTS_DIRECTORY);
  }

  comparisonsPath() {
    return path.join(this.rootPath, COMPARISONS_DIRECTORY);
  }

  definitionDirectory(id) {
    return path.join(this.definitionsPath(), id);
  }

  writeJsonAtomically(filePath, payload) {
    this.fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    try {
      this.fileSystem.writeFileSync(
        temporaryPath,
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8"
      );
      this.fileSystem.renameSync(temporaryPath, filePath);
    } catch (error) {
      throw new EvaluationStoreError(`Failed to write ${filePath}: ${error.message}`);
    } finally {
      if (this.fileSystem.existsSync(temporaryPath)) {
        this.fileSystem.rmSync(temporaryPath, { force: true });
      }
    }
    return filePath;
  }

  readJson(filePath, label) {
    if (!this.fileSystem.existsSync(filePath)) {
      throw new EvaluationStoreError(`${label} is missing at ${filePath}.`);
    }
    try {
      return JSON.parse(this.fileSystem.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new EvaluationStoreError(`${label} at ${filePath} is not valid JSON: ${error.message}`);
    }
  }

  savedVersions(id) {
    const directory = this.definitionDirectory(id);
    if (!this.fileSystem.existsSync(directory)) {
      return [];
    }
    return this.fileSystem
      .readdirSync(directory)
      .map((name) => VERSION_FILE_PATTERN.exec(name))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .sort((left, right) => left - right);
  }

  latestVersion(id) {
    const versions = this.savedVersions(id);
    return versions.length === 0 ? null : versions[versions.length - 1];
  }

  saveDefinition(definition) {
    const existing = this.savedVersions(definition.id);
    if (existing.includes(definition.version)) {
      throw new EvaluationStoreError(
        `Definition ${definition.id} already has version ${definition.version}; ` +
          "create a new version rather than overwriting a historical one."
      );
    }
    const filePath = path.join(
      this.definitionDirectory(definition.id),
      `v${definition.version}.json`
    );
    return this.writeJsonAtomically(filePath, definition.toJSON());
  }

  loadDefinition(id, version = null) {
    const resolvedVersion = version === null ? this.latestVersion(id) : version;
    if (resolvedVersion === null) {
      throw new EvaluationStoreError(`Evaluation definition ${id} has no saved versions.`);
    }
    const filePath = path.join(this.definitionDirectory(id), `v${resolvedVersion}.json`);
    return EvaluationDefinition.fromJSON(
      this.readJson(filePath, `Evaluation definition ${id} v${resolvedVersion}`)
    );
  }

  listDefinitions() {
    const root = this.definitionsPath();
    if (!this.fileSystem.existsSync(root)) {
      return [];
    }
    return listDirectoryNames(root, this.fileSystem)
      .map((id) => ({ id, versions: this.savedVersions(id) }))
      .filter((entry) => entry.versions.length > 0);
  }

  armResultDirectory(id) {
    return path.join(this.armResultsPath(), id);
  }

  // Retained run outputs are copied out of the temp workspace, never executed
  // from here, so the store can live wherever the user wants it.
  retainWorkspace(armResult, run) {
    if (!run.workspacePath || !this.fileSystem.existsSync(run.workspacePath)) {
      return null;
    }
    const destination = path.join(
      this.armResultDirectory(armResult.id),
      `run-${run.runIndex}`,
      "workspace"
    );
    this.fileSystem.mkdirSync(path.dirname(destination), { recursive: true });
    this.fileSystem.rmSync(destination, { recursive: true, force: true });
    this.fileSystem.cpSync(run.workspacePath, destination, { recursive: true });
    return destination;
  }

  retainTranscript(armResult, run) {
    const transcriptPath = run.runRecord.transcriptPath;
    if (!transcriptPath || !this.fileSystem.existsSync(transcriptPath)) {
      return null;
    }
    const destination = path.join(
      this.armResultDirectory(armResult.id),
      `run-${run.runIndex}`,
      "transcript.jsonl"
    );
    this.fileSystem.mkdirSync(path.dirname(destination), { recursive: true });
    this.fileSystem.copyFileSync(transcriptPath, destination);
    return destination;
  }

  saveArmResult(armResult, { retainWorkspaces = true } = {}) {
    const directory = this.armResultDirectory(armResult.id);
    if (this.fileSystem.existsSync(path.join(directory, "arm.json"))) {
      throw new EvaluationStoreError(
        `Arm result ${armResult.id} already exists; create a new arm result rather than ` +
          "overwriting a historical one."
      );
    }
    const payload = armResult.toJSON();
    for (const [index, run] of armResult.runs.entries()) {
      const retained = {
        workspacePath: retainWorkspaces ? this.retainWorkspace(armResult, run) : null,
        transcriptPath: this.retainTranscript(armResult, run),
      };
      payload.runs[index].retained = retained;
    }
    return this.writeJsonAtomically(path.join(directory, "arm.json"), payload);
  }

  loadArmResult(id) {
    return this.readJson(
      path.join(this.armResultDirectory(id), "arm.json"),
      `Arm result ${id}`
    );
  }

  comparisonDirectory(id) {
    return path.join(this.comparisonsPath(), id);
  }

  saveComparison(comparison) {
    const directory = this.comparisonDirectory(comparison.id);
    if (this.fileSystem.existsSync(path.join(directory, "comparison.json"))) {
      throw new EvaluationStoreError(
        `Comparison ${comparison.id} already exists; create a new comparison rather than ` +
          "overwriting a historical one."
      );
    }
    return this.writeJsonAtomically(path.join(directory, "comparison.json"), comparison);
  }

  loadComparison(id) {
    return this.readJson(
      path.join(this.comparisonDirectory(id), "comparison.json"),
      `Comparison ${id}`
    );
  }

  reportPath(id) {
    return path.join(this.comparisonDirectory(id), "report.md");
  }

  listComparisons() {
    const root = this.comparisonsPath();
    if (!this.fileSystem.existsSync(root)) {
      return [];
    }
    return listDirectoryNames(root, this.fileSystem)
      .filter((id) =>
        this.fileSystem.existsSync(path.join(this.comparisonDirectory(id), "comparison.json"))
      )
      .map((id) => this.loadComparison(id));
  }

  listArmResults(filter = {}) {
    const root = this.armResultsPath();
    if (!this.fileSystem.existsSync(root)) {
      return [];
    }
    return listDirectoryNames(root, this.fileSystem)
      .filter((id) => this.fileSystem.existsSync(path.join(this.armResultDirectory(id), "arm.json")))
      .map((id) => this.loadArmResult(id))
      .filter((stored) =>
        Object.entries(filter).every(([key, value]) => value === undefined || stored[key] === value)
      );
  }
}

module.exports = {
  EvaluationStoreError,
  EvaluationStore,
  DEFINITIONS_DIRECTORY,
  ARM_RESULTS_DIRECTORY,
  COMPARISONS_DIRECTORY,
};
