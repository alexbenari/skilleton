const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { CheckRunner } = require("../../electron/evaluation-check-runner");
const { CheckDefinition } = require("../../electron/evaluation-catalog");
const { describeWorkspace } = require("../../electron/evaluation-evidence");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-quoting-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function preparedFor(workspacePath) {
  return { workspacePath, isActivationArtifact: () => false };
}

// The first real end-to-end run failed here: node received the surrounding
// quotes as part of the module path, because Node escapes an embedded quote as
// \" when building a Windows command line and cmd.exe does not read that back.
test("a check command whose path is quoted runs, rather than passing the quotes through to the program", async () => {
  const tempRoot = makeTempRoot();
  try {
    const checksPath = path.join(tempRoot, "checks dir");
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    writeFile(
      path.join(checksPath, "structure.js"),
      'process.stdout.write(JSON.stringify({ status: "pass", summary: "ran", findings: [] }) + "\\n");\n'
    );
    const check = new CheckDefinition(
      {
        id: "structure",
        kind: "validator",
        command: 'node "{checksDir}/structure.js"',
        shell: "cmd",
        timeoutSeconds: 60,
      },
      "scenario.md"
    );

    const [result] = await new CheckRunner().runAll([check], {
      workspacePath,
      checksPath,
      manifest: null,
    });

    assert.equal(result.status, "pass");
    assert.equal(result.summary, "ran");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a specification document is inventoried as a document, not as a test", () => {
  const tempRoot = makeTempRoot();
  try {
    const workspacePath = path.join(tempRoot, "workspace");
    writeFile(path.join(workspacePath, "docs", "specs", "report-builder-spec.md"), "# Spec\n");
    writeFile(path.join(workspacePath, "docs", "plans", "report-builder-exec-plan.md"), "# Plan\n");
    writeFile(path.join(workspacePath, "src", "report_builder.py"), "print('hi')\n");
    writeFile(path.join(workspacePath, "tests", "test_report_builder.py"), "def test_x(): pass\n");
    writeFile(path.join(workspacePath, "src", "builder.spec.ts"), "describe('x', () => {});\n");

    const inventory = describeWorkspace(preparedFor(workspacePath), { shape: "generative" });
    const roleOf = (relativePath) =>
      inventory.files.find((file) => file.path === relativePath).role;

    assert.equal(roleOf("docs/specs/report-builder-spec.md"), "document");
    assert.equal(roleOf("docs/plans/report-builder-exec-plan.md"), "document");
    assert.equal(roleOf("src/report_builder.py"), "source");
    assert.equal(roleOf("tests/test_report_builder.py"), "test");
    assert.equal(roleOf("src/builder.spec.ts"), "test");
    assert.equal(inventory.ofRole("test").length, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
