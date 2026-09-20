const fs = require("fs");
const path = require("path");

const { fingerprintFile, listFilesRecursively } = require("./evaluation-fingerprint");
const { RUN_MANIFEST_FILENAME } = require("./evaluation-workspace");

class EvaluationEvidenceError extends Error {}

const MANIFEST_STEP_NAMES = ["install", "build", "test", "run"];
const DEPENDENCY_MANIFESTS = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "pom.xml",
  "build.gradle",
];
const ENTRY_POINT_BASENAMES = [
  "main.py",
  "__main__.py",
  "main.js",
  "index.js",
  "main.ts",
  "index.ts",
  "main.go",
  "Program.cs",
  "main.rs",
  "cli.py",
  "cli.js",
  "cli.ts",
];
const DOCUMENT_EXTENSIONS = [".md", ".rst", ".txt", ".adoc"];
const CONFIG_EXTENSIONS = [".json", ".toml", ".yaml", ".yml", ".ini", ".cfg"];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function looksLikeTest(relativePath) {
  const posix = relativePath.toLowerCase();
  const segments = posix.split("/");
  if (segments.some((segment) => segment === "test" || segment === "tests" || segment === "spec")) {
    return true;
  }
  const base = segments[segments.length - 1];
  return /(^|[._-])(test|spec)([._-]|$)/.test(base);
}

function classify(relativePath) {
  const base = path.posix.basename(relativePath);
  const extension = path.posix.extname(base).toLowerCase();
  if (DEPENDENCY_MANIFESTS.includes(base)) {
    return "dependency-manifest";
  }
  if (base === RUN_MANIFEST_FILENAME) {
    return "run-manifest";
  }
  if (looksLikeTest(relativePath)) {
    return "test";
  }
  if (ENTRY_POINT_BASENAMES.includes(base)) {
    return "entry-point";
  }
  if (DOCUMENT_EXTENSIONS.includes(extension)) {
    return "document";
  }
  if (CONFIG_EXTENSIONS.includes(extension)) {
    return "config";
  }
  return "source";
}

class RunManifest {
  constructor({ shell, steps, status = "present", reason = null }) {
    this.shell = shell;
    this.steps = Object.freeze({ ...steps });
    this.status = status;
    this.reason = reason;
    Object.freeze(this);
  }

  isPresent() {
    return this.status === "present";
  }

  commandFor(step) {
    return this.steps[step] || null;
  }

  toJSON() {
    return {
      shell: this.shell,
      steps: { ...this.steps },
      status: this.status,
      reason: this.reason,
    };
  }

  static absent(reason) {
    return new RunManifest({ shell: null, steps: {}, status: "missing", reason });
  }

  static invalid(reason) {
    return new RunManifest({ shell: null, steps: {}, status: "invalid", reason });
  }
}

// A deliverable nobody can run is a quality result, so a missing or malformed
// manifest comes back as run evidence rather than an exception.
function readRunManifest(workspacePath, fileSystem = fs) {
  const manifestPath = path.join(workspacePath, RUN_MANIFEST_FILENAME);
  if (!fileSystem.existsSync(manifestPath)) {
    return RunManifest.absent(`${RUN_MANIFEST_FILENAME} was not written by the run.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fileSystem.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return RunManifest.invalid(`${RUN_MANIFEST_FILENAME} is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    return RunManifest.invalid(`${RUN_MANIFEST_FILENAME} is not a JSON object.`);
  }
  const steps = {};
  for (const step of MANIFEST_STEP_NAMES) {
    const value = parsed[step];
    if (typeof value === "string" && value.trim() !== "") {
      steps[step] = value;
    }
  }
  if (Object.keys(steps).length === 0) {
    return RunManifest.invalid(
      `${RUN_MANIFEST_FILENAME} declares none of ${MANIFEST_STEP_NAMES.join(", ")}.`
    );
  }
  const shell = typeof parsed.shell === "string" && parsed.shell.trim() !== "" ? parsed.shell : null;
  if (!shell) {
    return RunManifest.invalid(`${RUN_MANIFEST_FILENAME} does not declare a shell.`);
  }
  return new RunManifest({ shell, steps });
}

function parseDeclaredDependencies(basename, contents) {
  if (basename === "package.json") {
    try {
      const parsed = JSON.parse(contents);
      return Object.keys({ ...parsed.dependencies, ...parsed.devDependencies }).sort();
    } catch {
      return [];
    }
  }
  if (basename === "requirements.txt") {
    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .sort();
  }
  return [];
}

class ArtifactInventory {
  constructor({ files, dependencies }) {
    this.files = Object.freeze(files.map((file) => Object.freeze({ ...file })));
    this.dependencies = Object.freeze(dependencies.map((entry) => Object.freeze({ ...entry })));
    this.totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    Object.freeze(this);
  }

  kind() {
    return "artifact-inventory";
  }

  ofRole(role) {
    return this.files.filter((file) => file.role === role);
  }

  toJSON() {
    return {
      kind: this.kind(),
      fileCount: this.files.length,
      totalBytes: this.totalBytes,
      testFileCount: this.ofRole("test").length,
      entryPoints: this.ofRole("entry-point").map((file) => file.path),
      files: this.files.map((file) => ({ ...file })),
      dependencies: this.dependencies.map((entry) => ({ ...entry })),
    };
  }
}

class ChangeDescription {
  constructor({ added, modified, deleted, unchangedCount }) {
    this.added = Object.freeze([...added]);
    this.modified = Object.freeze([...modified]);
    this.deleted = Object.freeze([...deleted]);
    this.unchangedCount = unchangedCount;
    Object.freeze(this);
  }

  kind() {
    return "change-description";
  }

  isEmpty() {
    return this.added.length === 0 && this.modified.length === 0 && this.deleted.length === 0;
  }

  toJSON() {
    return {
      kind: this.kind(),
      added: [...this.added],
      modified: [...this.modified],
      deleted: [...this.deleted],
      unchangedCount: this.unchangedCount,
      changedCount: this.added.length + this.modified.length + this.deleted.length,
    };
  }
}

function workspaceFiles(prepared, fileSystem) {
  return listFilesRecursively(prepared.workspacePath, fileSystem)
    .map((file) => ({ ...file, relativePath: toPosix(file.relativePath) }))
    .filter((file) => !prepared.isActivationArtifact(file.relativePath));
}

function buildInventory(prepared, fileSystem) {
  const files = [];
  const dependencies = [];
  for (const file of workspaceFiles(prepared, fileSystem)) {
    const stats = fileSystem.statSync(file.absolutePath);
    const role = classify(file.relativePath);
    files.push({ path: file.relativePath, bytes: stats.size, role });
    if (role === "dependency-manifest") {
      const contents = fileSystem.readFileSync(file.absolutePath, "utf8");
      dependencies.push({
        path: file.relativePath,
        declared: parseDeclaredDependencies(path.posix.basename(file.relativePath), contents),
      });
    }
  }
  return new ArtifactInventory({ files, dependencies });
}

function buildChangeDescription(prepared, target, fileSystem) {
  const snapshot = new Map(
    listFilesRecursively(target.contentPath, fileSystem).map((file) => [
      toPosix(file.relativePath),
      fingerprintFile(file.absolutePath, fileSystem),
    ])
  );
  const added = [];
  const modified = [];
  const seen = new Set();
  let unchangedCount = 0;
  for (const file of workspaceFiles(prepared, fileSystem)) {
    seen.add(file.relativePath);
    const before = snapshot.get(file.relativePath);
    const after = fingerprintFile(file.absolutePath, fileSystem);
    if (before === undefined) {
      added.push(file.relativePath);
    } else if (before !== after) {
      modified.push(file.relativePath);
    } else {
      unchangedCount += 1;
    }
  }
  const deleted = [...snapshot.keys()].filter((relativePath) => !seen.has(relativePath));
  added.sort();
  modified.sort();
  deleted.sort();
  return new ChangeDescription({ added, modified, deleted, unchangedCount });
}

function describeWorkspace(prepared, target, fileSystem = fs) {
  if (!fileSystem.existsSync(prepared.workspacePath)) {
    throw new EvaluationEvidenceError(
      `Run workspace ${prepared.workspacePath} is missing; nothing to describe.`
    );
  }
  return target.shape === "generative"
    ? buildInventory(prepared, fileSystem)
    : buildChangeDescription(prepared, target, fileSystem);
}

module.exports = {
  EvaluationEvidenceError,
  describeWorkspace,
  readRunManifest,
  ArtifactInventory,
  ChangeDescription,
  RunManifest,
  MANIFEST_STEP_NAMES,
};
