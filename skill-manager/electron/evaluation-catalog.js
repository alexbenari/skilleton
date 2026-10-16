const fs = require("fs");
const path = require("path");

const {
  fingerprintDirectory,
  fingerprintText,
  fingerprintValues,
} = require("./evaluation-fingerprint");
const { listDirectoryNames, listFileNames } = require("./evaluation-fs");

class EvaluationCatalogError extends Error {}

const TARGET_SHAPES = ["extension", "generative"];
const CHECK_KINDS = ["validator", "behavioral"];
const MANIFEST_STEPS = ["install", "build", "test", "run"];
const MANIFEST_COMMAND_PREFIX = "manifest:";
const FRONT_MATTER_FENCE = "---";

function requireText(value, label, filePath) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EvaluationCatalogError(`${label} is required in ${filePath}.`);
  }
  return value;
}

function requireOneOf(value, allowed, label, filePath) {
  if (!allowed.includes(value)) {
    throw new EvaluationCatalogError(
      `${label} in ${filePath} must be one of ${allowed.join(", ")}, received ${JSON.stringify(value)}.`
    );
  }
  return value;
}

class CheckDefinition {
  constructor({ id, kind, command, timeoutSeconds = 600, shell = null }, filePath) {
    this.id = requireText(id, "Check id", filePath);
    this.kind = requireOneOf(kind, CHECK_KINDS, `Check ${id} kind`, filePath);
    this.command = requireText(command, `Check ${id} command`, filePath);
    this.shell = shell;
    if (this.isManifestCommand()) {
      const step = this.manifestStep();
      if (!MANIFEST_STEPS.includes(step)) {
        throw new EvaluationCatalogError(
          `Check ${id} in ${filePath} references manifest step ${JSON.stringify(step)}; ` +
            `known steps are ${MANIFEST_STEPS.join(", ")}.`
        );
      }
    }
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new EvaluationCatalogError(
        `Check ${id} in ${filePath} needs a positive timeoutSeconds.`
      );
    }
    this.timeoutSeconds = timeoutSeconds;
    Object.freeze(this);
  }

  isManifestCommand() {
    return this.command.startsWith(MANIFEST_COMMAND_PREFIX);
  }

  manifestStep() {
    return this.isManifestCommand()
      ? this.command.slice(MANIFEST_COMMAND_PREFIX.length).trim()
      : null;
  }

  toJSON() {
    return {
      id: this.id,
      kind: this.kind,
      command: this.command,
      timeoutSeconds: this.timeoutSeconds,
      shell: this.shell,
    };
  }
}

class EvaluationTarget {
  constructor({
    id,
    shape,
    description = "",
    rootPath,
    fingerprint,
    initializeGitRepository = false,
  }) {
    this.id = id;
    this.shape = shape;
    this.description = description;
    this.rootPath = rootPath;
    this.contentPath = path.join(rootPath, "content");
    this.checksPath = path.join(rootPath, "checks");
    this.fingerprint = fingerprint;
    this.initializeGitRepository = initializeGitRepository;
    Object.freeze(this);
  }

  isGenerative() {
    return this.shape === "generative";
  }

  toJSON() {
    return {
      id: this.id,
      shape: this.shape,
      description: this.description,
      rootPath: this.rootPath,
      fingerprint: this.fingerprint,
      initializeGitRepository: this.initializeGitRepository,
    };
  }
}

class Scenario {
  constructor({
    id,
    targetId,
    filePath,
    pins = {},
    requiresRunManifest = false,
    checks = [],
    reviewDimensions = [],
    reviewGuidance = "",
    prompt,
    fingerprint,
  }) {
    this.id = id;
    this.targetId = targetId;
    this.filePath = filePath;
    this.pins = Object.freeze({ ...pins });
    this.requiresRunManifest = requiresRunManifest;
    this.checks = Object.freeze([...checks]);
    this.reviewDimensions = Object.freeze([...reviewDimensions]);
    this.reviewGuidance = reviewGuidance;
    this.prompt = prompt;
    this.fingerprint = fingerprint;
    this.checksFingerprint = fingerprintValues(
      this.checks.map((check) => JSON.stringify(check.toJSON()))
    );
    Object.freeze(this);
  }

  behavioralChecks() {
    return this.checks.filter((check) => check.kind === "behavioral");
  }

  toJSON() {
    return {
      id: this.id,
      targetId: this.targetId,
      filePath: this.filePath,
      pins: { ...this.pins },
      requiresRunManifest: this.requiresRunManifest,
      checks: this.checks.map((check) => check.toJSON()),
      reviewDimensions: [...this.reviewDimensions],
      reviewGuidance: this.reviewGuidance,
      fingerprint: this.fingerprint,
      checksFingerprint: this.checksFingerprint,
    };
  }
}

// Front matter is JSON rather than YAML: the scenario shape has nested lists of
// objects, and a hand-rolled YAML subset would be a parser with its own bugs.
function splitFrontMatter(raw, filePath) {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FRONT_MATTER_FENCE}\n`)) {
    throw new EvaluationCatalogError(
      `${filePath} must open with a ${FRONT_MATTER_FENCE} fence followed by a JSON object.`
    );
  }
  const closingIndex = normalized.indexOf(`\n${FRONT_MATTER_FENCE}`, FRONT_MATTER_FENCE.length);
  if (closingIndex === -1) {
    throw new EvaluationCatalogError(`${filePath} has no closing ${FRONT_MATTER_FENCE} fence.`);
  }
  const frontMatter = normalized.slice(FRONT_MATTER_FENCE.length + 1, closingIndex);
  const body = normalized.slice(closingIndex + FRONT_MATTER_FENCE.length + 1).replace(/^\n/, "");
  return { frontMatter, body };
}

function parseFrontMatter(raw, filePath) {
  const { frontMatter, body } = splitFrontMatter(raw, filePath);
  let parsed;
  try {
    parsed = JSON.parse(frontMatter);
  } catch (error) {
    throw new EvaluationCatalogError(
      `${filePath} front matter is not valid JSON: ${error.message}`
    );
  }
  return { metadata: parsed, body };
}

class EvaluationCatalog {
  constructor({ rootPath, fileSystem = fs } = {}) {
    if (!rootPath) {
      throw new EvaluationCatalogError("rootPath is required.");
    }
    // Absolute, because a check command runs with the arm's workspace as its
    // working directory: a relative checks path would resolve inside the
    // workspace and the check would not be found.
    this.rootPath = path.resolve(rootPath);
    this.fileSystem = fileSystem;
  }

  fixturesPath() {
    return path.join(this.rootPath, "fixtures");
  }

  scenariosPath() {
    return path.join(this.rootPath, "scenarios");
  }

  subjectsPath() {
    return path.join(this.rootPath, "subjects");
  }

  directoryNames(parentPath) {
    return listDirectoryNames(parentPath, this.fileSystem);
  }

  listTargets() {
    return this.directoryNames(this.fixturesPath()).map((name) => this.readTarget(name));
  }

  getTarget(id) {
    const found = this.listTargets().find((target) => target.id === id);
    if (!found) {
      throw new EvaluationCatalogError(
        `Evaluation target ${id} does not exist under ${this.fixturesPath()}.`
      );
    }
    return found;
  }

  readTarget(directoryName) {
    const rootPath = path.join(this.fixturesPath(), directoryName);
    const descriptorPath = path.join(rootPath, "target.json");
    if (!this.fileSystem.existsSync(descriptorPath)) {
      throw new EvaluationCatalogError(`Evaluation target ${directoryName} has no target.json.`);
    }
    let descriptor;
    try {
      descriptor = JSON.parse(this.fileSystem.readFileSync(descriptorPath, "utf8"));
    } catch (error) {
      throw new EvaluationCatalogError(
        `${descriptorPath} is not valid JSON: ${error.message}`
      );
    }
    const id = requireText(descriptor.id, "Target id", descriptorPath);
    if (id !== directoryName) {
      throw new EvaluationCatalogError(
        `Target id ${id} does not match its directory name ${directoryName} in ${descriptorPath}.`
      );
    }
    requireOneOf(descriptor.shape, TARGET_SHAPES, "Target shape", descriptorPath);
    const contentPath = path.join(rootPath, "content");
    if (!this.fileSystem.existsSync(contentPath)) {
      throw new EvaluationCatalogError(
        `Evaluation target ${id} has no content directory at ${contentPath}.`
      );
    }
    return new EvaluationTarget({
      id,
      shape: descriptor.shape,
      description: descriptor.description || "",
      rootPath,
      fingerprint: fingerprintDirectory(rootPath, this.fileSystem),
      initializeGitRepository: Boolean(descriptor.initializeGitRepository),
    });
  }

  scenarioFilePaths() {
    const scenariosRoot = this.scenariosPath();
    return this.directoryNames(scenariosRoot).flatMap((targetDirectory) => {
      const targetPath = path.join(scenariosRoot, targetDirectory);
      return listFileNames(targetPath, this.fileSystem)
        .filter((name) => name.endsWith(".md"))
        .map((name) => path.join(targetPath, name));
    });
  }

  listScenarios() {
    const scenarios = this.scenarioFilePaths().map((filePath) => this.readScenario(filePath));
    const seen = new Map();
    for (const scenario of scenarios) {
      const previous = seen.get(scenario.id);
      if (previous) {
        throw new EvaluationCatalogError(
          `Scenario id ${scenario.id} is declared twice: ${previous} and ${scenario.filePath}.`
        );
      }
      seen.set(scenario.id, scenario.filePath);
    }
    return scenarios;
  }

  getScenario(id) {
    const found = this.listScenarios().find((scenario) => scenario.id === id);
    if (!found) {
      throw new EvaluationCatalogError(
        `Scenario ${id} does not exist under ${this.scenariosPath()}.`
      );
    }
    return found;
  }

  readScenario(filePath) {
    const raw = this.fileSystem.readFileSync(filePath, "utf8");
    const { metadata, body } = parseFrontMatter(raw, filePath);
    const id = requireText(metadata.id, "Scenario id", filePath);
    const targetId = requireText(metadata.targetId, "Scenario targetId", filePath);
    const enclosingDirectory = path.basename(path.dirname(filePath));
    if (targetId !== enclosingDirectory) {
      throw new EvaluationCatalogError(
        `Scenario ${id} declares targetId ${targetId} but lives under ${enclosingDirectory}.`
      );
    }
    if (body.trim() === "") {
      throw new EvaluationCatalogError(`Scenario ${id} in ${filePath} has an empty prompt body.`);
    }
    const checks = (metadata.checks || []).map((check) => new CheckDefinition(check, filePath));
    const reviewDimensions = metadata.review?.dimensions || [];
    if (reviewDimensions.length === 0) {
      throw new EvaluationCatalogError(
        `Scenario ${id} in ${filePath} must name at least one review dimension.`
      );
    }
    return new Scenario({
      id,
      targetId,
      filePath,
      pins: metadata.pins || {},
      requiresRunManifest: Boolean(metadata.requiresRunManifest),
      checks,
      reviewDimensions,
      reviewGuidance: metadata.review?.guidance || "",
      prompt: body.trim(),
      fingerprint: fingerprintText(raw),
    });
  }

  listSubjectFiles() {
    const subjectsRoot = this.subjectsPath();
    if (!this.fileSystem.existsSync(subjectsRoot)) {
      return [];
    }
    return listFileNames(subjectsRoot, this.fileSystem).map((name) =>
      path.join(subjectsRoot, name)
    );
  }
}

module.exports = {
  EvaluationCatalogError,
  EvaluationCatalog,
  EvaluationTarget,
  Scenario,
  CheckDefinition,
  TARGET_SHAPES,
  CHECK_KINDS,
  MANIFEST_STEPS,
  MANIFEST_COMMAND_PREFIX,
};
