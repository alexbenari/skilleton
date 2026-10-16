const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  EvaluationEvidenceError,
  describeWorkspace,
  readRunManifest,
} = require("../../electron/evaluation-evidence");
const { EvaluationWorkspace, PreparedRun } = require("../../electron/evaluation-workspace");

// A four-file generative deliverable whose byte sizes the inventory must total.
const PACKAGE_JSON = `{
  "name": "invoice-report",
  "version": "1.0.0",
  "dependencies": { "commander": "^12.0.0" },
  "devDependencies": { "vitest": "^2.0.0" }
}
`;
const CLI_JS = `require("./report-builder").main();\n`;
const REPORT_BUILDER_JS = `exports.main = () => console.log("report");\n`;
const REPORT_BUILDER_TEST_JS = `require("node:test");\n`;
const GENERATED_DELIVERABLE_BYTES = 246;

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-evidence-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

// A PreparedRun the evidence reader can walk, without running an agent first.
function preparedWorkspaceIn(tempRoot, files) {
  const rootPath = path.join(tempRoot, "run-1");
  const workspacePath = path.join(rootPath, "workspace");
  const artifactsPath = path.join(rootPath, "artifacts");
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(artifactsPath, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(path.join(workspacePath, ...relativePath.split("/")), contents);
  }
  return new PreparedRun({
    evaluationId: "invoice-report-guidance",
    role: "candidate",
    runIndex: 1,
    rootPath,
    workspacePath,
    artifactsPath,
  });
}

function generativeTarget(rootPath, contentFiles = {}) {
  const contentPath = path.join(rootPath, "content");
  fs.mkdirSync(contentPath, { recursive: true });
  for (const [relativePath, contents] of Object.entries(contentFiles)) {
    writeFile(path.join(contentPath, ...relativePath.split("/")), contents);
  }
  return { id: "invoice-report", shape: "generative", contentPath };
}

function extensionTarget(rootPath, contentFiles) {
  const contentPath = path.join(rootPath, "content");
  for (const [relativePath, contents] of Object.entries(contentFiles)) {
    writeFile(path.join(contentPath, ...relativePath.split("/")), contents);
  }
  return { id: "invoice-report-extension", shape: "extension", contentPath };
}

function pathsIn(inventory) {
  return inventory.files.map((file) => file.path);
}

test("a generative target yields an inventory of the files the run produced", () => {
  const tempRoot = makeTempRoot();
  try {
    const prepared = preparedWorkspaceIn(tempRoot, {
      "package.json": PACKAGE_JSON,
      "src/cli.js": CLI_JS,
      "src/report-builder.js": REPORT_BUILDER_JS,
      "tests/report-builder.test.js": REPORT_BUILDER_TEST_JS,
    });
    const target = generativeTarget(path.join(tempRoot, "fixture"));

    const inventory = describeWorkspace(prepared, target);

    assert.equal(inventory.kind(), "artifact-inventory");
    assert.equal(inventory.files.length, 4);
    assert.equal(inventory.totalBytes, GENERATED_DELIVERABLE_BYTES);
    assert.deepEqual(inventory.toJSON().entryPoints, ["src/cli.js"]);
    assert.equal(inventory.toJSON().testFileCount, 1);
    assert.deepEqual(inventory.dependencies, [
      { path: "package.json", declared: ["commander", "vitest"] },
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a requirements.txt inventory skips comment and blank lines", () => {
  const tempRoot = makeTempRoot();
  try {
    const prepared = preparedWorkspaceIn(tempRoot, {
      "requirements.txt": "# Runtime dependencies\nclick==8.1.7\n\njinja2==3.1.4\n",
      "src/cli.py": "def main():\n    print('report')\n",
    });
    const target = generativeTarget(path.join(tempRoot, "fixture"));

    const inventory = describeWorkspace(prepared, target);

    assert.deepEqual(inventory.dependencies, [
      { path: "requirements.txt", declared: ["click==8.1.7", "jinja2==3.1.4"] },
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the files activation wrote are left out of the inventory", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = generativeTarget(path.join(tempRoot, "fixture"), {
      "requirements.md": "# Requirements\n\nR1. Emit an invoice report.\n",
    });
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });
    const prepared = workspace
      .prepare({ evaluationId: "invoice-report-guidance", role: "candidate", runIndex: 1, target })
      .recordActivation(["CLAUDE.md", ".claude/skills/writing-clean-code"]);
    writeFile(path.join(prepared.workspacePath, "CLAUDE.md"), "# Repository Instructions\n");
    writeFile(
      path.join(prepared.workspacePath, ".claude", "skills", "writing-clean-code", "SKILL.md"),
      "---\nname: writing-clean-code\n---\n"
    );
    writeFile(path.join(prepared.workspacePath, "src", "main.py"), "print('report')\n");
    writeFile(path.join(prepared.workspacePath, "README.md"), "# Invoice Report\n");

    const inventory = describeWorkspace(prepared, target);

    assert.deepEqual(pathsIn(inventory), ["README.md", "requirements.md", "src/main.py"]);
    assert.equal(
      fs.existsSync(
        path.join(prepared.workspacePath, ".claude", "skills", "writing-clean-code", "SKILL.md")
      ),
      true
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("each inventory file carries the role its path and name imply", () => {
  const tempRoot = makeTempRoot();
  try {
    const prepared = preparedWorkspaceIn(tempRoot, {
      "README.md": "# Invoice Report\n",
      "pyproject.toml": "[project]\nname = \"invoice-report\"\n",
      "src/cli.py": "def main():\n    print('report')\n",
      "src/report_builder.py": "def build():\n    return []\n",
      "tests/test_report_builder.py": "def test_build():\n    assert True\n",
    });
    const target = generativeTarget(path.join(tempRoot, "fixture"));

    const inventory = describeWorkspace(prepared, target);

    assert.deepEqual(
      Object.fromEntries(inventory.files.map((file) => [file.path, file.role])),
      {
        "README.md": "document",
        "pyproject.toml": "dependency-manifest",
        "src/cli.py": "entry-point",
        "src/report_builder.py": "source",
        "tests/test_report_builder.py": "test",
      }
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an extension target yields the added, modified and deleted files against its snapshot", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = extensionTarget(path.join(tempRoot, "fixture"), {
      "docs/legacy.md": "# Legacy notes\n",
      "src/formatter.py": "def format_row(row):\n    return str(row)\n",
      "src/parser.py": "def parse(line):\n    return line.split(',')\n",
    });
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });
    const prepared = workspace.prepare({
      evaluationId: "invoice-report-guidance",
      role: "candidate",
      runIndex: 1,
      target,
    });
    fs.writeFileSync(
      path.join(prepared.workspacePath, "src", "formatter.py"),
      "def format_row(row):\n    return ' | '.join(row)\n",
      "utf8"
    );
    fs.rmSync(path.join(prepared.workspacePath, "docs", "legacy.md"));
    writeFile(
      path.join(prepared.workspacePath, "tests", "test_parser.py"),
      "def test_parse():\n    assert True\n"
    );

    const change = describeWorkspace(prepared, target);

    assert.equal(change.kind(), "change-description");
    assert.deepEqual(change.added, ["tests/test_parser.py"]);
    assert.deepEqual(change.modified, ["src/formatter.py"]);
    assert.deepEqual(change.deleted, ["docs/legacy.md"]);
    assert.equal(change.unchangedCount, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("describeWorkspace refuses to describe a workspace that is no longer on disk", () => {
  const tempRoot = makeTempRoot();
  try {
    const prepared = preparedWorkspaceIn(tempRoot, { "README.md": "# Invoice Report\n" });
    const target = generativeTarget(path.join(tempRoot, "fixture"));
    fs.rmSync(prepared.workspacePath, { recursive: true, force: true });

    assert.throws(
      () => describeWorkspace(prepared, target),
      (error) =>
        error instanceof EvaluationEvidenceError &&
        error.message.includes(prepared.workspacePath)
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("readRunManifest reports missing when the run wrote no manifest", () => {
  const tempRoot = makeTempRoot();
  try {
    const manifest = readRunManifest(tempRoot);

    assert.equal(manifest.status, "missing");
    assert.equal(manifest.isPresent(), false);
    assert.equal(manifest.reason, "run-manifest.json was not written by the run.");
    assert.equal(manifest.commandFor("test"), null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("readRunManifest reports invalid when the manifest is not JSON", () => {
  const tempRoot = makeTempRoot();
  try {
    writeFile(path.join(tempRoot, "run-manifest.json"), "shell: cmd\ntest: npm test\n");

    const manifest = readRunManifest(tempRoot);

    assert.equal(manifest.status, "invalid");
    assert.equal(manifest.isPresent(), false);
    assert.equal(manifest.reason.includes("not valid JSON"), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("readRunManifest reports invalid when the manifest declares no shell", () => {
  const tempRoot = makeTempRoot();
  try {
    writeFile(
      path.join(tempRoot, "run-manifest.json"),
      `${JSON.stringify({ install: "npm install", test: "npm test" }, null, 2)}\n`
    );

    const manifest = readRunManifest(tempRoot);

    assert.equal(manifest.status, "invalid");
    assert.equal(manifest.reason, "run-manifest.json does not declare a shell.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("readRunManifest reports invalid when the manifest declares no runnable step", () => {
  const tempRoot = makeTempRoot();
  try {
    writeFile(
      path.join(tempRoot, "run-manifest.json"),
      `${JSON.stringify({ shell: "cmd", notes: "Nothing to run yet." }, null, 2)}\n`
    );

    const manifest = readRunManifest(tempRoot);

    assert.equal(manifest.status, "invalid");
    assert.equal(manifest.reason, "run-manifest.json declares none of install, build, test, run.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("readRunManifest reports a well-formed manifest with the command for each declared step", () => {
  const tempRoot = makeTempRoot();
  try {
    writeFile(
      path.join(tempRoot, "run-manifest.json"),
      `${JSON.stringify({ shell: "cmd", install: "npm install", test: "npm test" }, null, 2)}\n`
    );

    const manifest = readRunManifest(tempRoot);

    assert.equal(manifest.status, "present");
    assert.equal(manifest.isPresent(), true);
    assert.equal(manifest.shell, "cmd");
    assert.equal(manifest.commandFor("test"), "npm test");
    assert.equal(manifest.commandFor("install"), "npm install");
    assert.equal(manifest.commandFor("build"), null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
