const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  EvaluationWorkspace,
  EvaluationWorkspaceError,
} = require("../../electron/evaluation-workspace");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-workspace-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function makeTarget(rootPath, { initializeGitRepository = false } = {}) {
  const contentPath = path.join(rootPath, "content");
  writeFile(path.join(contentPath, "requirements.md"), "# Requirements\n\nR1. Emit a report.\n");
  writeFile(path.join(contentPath, "reference", "sample.txt"), "sample\n");
  return {
    id: "sample-target",
    shape: "generative",
    contentPath,
    initializeGitRepository,
  };
}

test("prepare copies the target snapshot into an empty run workspace", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = makeTarget(path.join(tempRoot, "fixture"));
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });

    const prepared = workspace.prepare({
      evaluationId: "eval-1",
      role: "reference",
      runIndex: 1,
      target,
    });

    assert.equal(
      fs.readFileSync(path.join(prepared.workspacePath, "requirements.md"), "utf8"),
      "# Requirements\n\nR1. Emit a report.\n"
    );
    assert.equal(
      fs.readFileSync(path.join(prepared.workspacePath, "reference", "sample.txt"), "utf8"),
      "sample\n"
    );
    assert.equal(fs.existsSync(prepared.artifactsPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prepare leaves the fixture untouched when the run workspace is modified", () => {
  const tempRoot = makeTempRoot();
  try {
    const fixturePath = path.join(tempRoot, "fixture");
    const target = makeTarget(fixturePath);
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });
    const prepared = workspace.prepare({
      evaluationId: "eval-1",
      role: "candidate",
      runIndex: 1,
      target,
    });

    fs.writeFileSync(path.join(prepared.workspacePath, "requirements.md"), "clobbered", "utf8");

    assert.equal(
      fs.readFileSync(path.join(target.contentPath, "requirements.md"), "utf8"),
      "# Requirements\n\nR1. Emit a report.\n"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prepare rejects a workspace whose ancestor directory holds an instruction file", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = makeTarget(path.join(tempRoot, "fixture"));
    const runsRoot = path.join(tempRoot, "enclosing", "runs");
    const leakingFile = path.join(tempRoot, "enclosing", "CLAUDE.md");
    writeFile(leakingFile, "# Enclosing project instructions\n");
    const workspace = new EvaluationWorkspace({ tempRootPath: runsRoot });

    assert.throws(
      () =>
        workspace.prepare({
          evaluationId: "eval-1",
          role: "reference",
          runIndex: 1,
          target,
        }),
      (error) =>
        error instanceof EvaluationWorkspaceError && error.message.includes(leakingFile)
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prepare rejects a fixture shipping AGENTS.override.md, which would beat the written AGENTS.md", () => {
  const tempRoot = makeTempRoot();
  try {
    const fixturePath = path.join(tempRoot, "fixture");
    const target = makeTarget(fixturePath);
    writeFile(path.join(target.contentPath, "AGENTS.override.md"), "# Overriding instructions\n");
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });

    assert.throws(
      () =>
        workspace.prepare({
          evaluationId: "eval-1",
          role: "reference",
          runIndex: 1,
          target,
        }),
      (error) =>
        error instanceof EvaluationWorkspaceError &&
        error.message.includes("AGENTS.override.md")
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prepare rejects a fixture shipping a nested CLAUDE.md", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = makeTarget(path.join(tempRoot, "fixture"));
    writeFile(path.join(target.contentPath, "docs", "CLAUDE.md"), "# Nested instructions\n");
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });

    assert.throws(
      () =>
        workspace.prepare({
          evaluationId: "eval-1",
          role: "reference",
          runIndex: 1,
          target,
        }),
      (error) =>
        error instanceof EvaluationWorkspaceError && error.message.includes("docs/CLAUDE.md")
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// The guard is about ancestry. A workspace is not its own ancestor, and the
// instruction file inside it is precisely what activation writes, so checking
// the workspace directory itself would reject every second run.
test("assertNoInstructionAncestry ignores an instruction file in the workspace itself", () => {
  const tempRoot = makeTempRoot();
  try {
    const workspacePath = path.join(tempRoot, "runs", "run-1", "workspace");
    writeFile(path.join(workspacePath, "AGENTS.md"), "# Written by activation\n");
    writeFile(path.join(workspacePath, "CLAUDE.md"), "# Written by activation\n");
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });

    assert.doesNotThrow(() => workspace.assertNoInstructionAncestry(workspacePath));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("assertNoInstructionAncestry rejects an instruction file in the workspace's immediate parent", () => {
  const tempRoot = makeTempRoot();
  try {
    const workspacePath = path.join(tempRoot, "runs", "run-1", "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const leakingFile = path.join(tempRoot, "runs", "run-1", "AGENTS.md");
    writeFile(leakingFile, "# Left in the run root\n");
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });

    assert.throws(
      () => workspace.assertNoInstructionAncestry(workspacePath),
      (error) =>
        error instanceof EvaluationWorkspaceError && error.message.includes(leakingFile)
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// The second real end-to-end run failed here: the candidate arm reused the
// same workspace path, and activation's own AGENTS.md from the previous run
// was still sitting there when the ancestry guard ran.
test("prepare replaces a previous run's activation artifacts instead of refusing the workspace", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = makeTarget(path.join(tempRoot, "fixture"));
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });
    const first = workspace.prepare({
      evaluationId: "eval-1",
      role: "candidate",
      runIndex: 1,
      target,
    });
    writeFile(path.join(first.workspacePath, "AGENTS.md"), "# Written by activation\n");
    writeFile(path.join(first.workspacePath, "CLAUDE.md"), "# Written by activation\n");

    const second = workspace.prepare({
      evaluationId: "eval-1",
      role: "candidate",
      runIndex: 1,
      target,
    });

    assert.equal(second.workspacePath, first.workspacePath);
    assert.equal(fs.existsSync(path.join(second.workspacePath, "AGENTS.md")), false);
    assert.equal(fs.existsSync(path.join(second.workspacePath, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(second.workspacePath, "requirements.md")), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prepare accepts a declared instruction collision", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = makeTarget(path.join(tempRoot, "fixture"));
    writeFile(path.join(target.contentPath, "AGENTS.md"), "# Deliberate collision\n");
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });

    const prepared = workspace.prepare({
      evaluationId: "eval-1",
      role: "reference",
      runIndex: 1,
      target,
      scenario: { pins: { declaresInstructionCollision: true } },
    });

    assert.equal(fs.existsSync(path.join(prepared.workspacePath, "AGENTS.md")), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prepare gives each repetition its own workspace from the same snapshot", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = makeTarget(path.join(tempRoot, "fixture"));
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });

    const first = workspace.prepare({
      evaluationId: "eval-1",
      role: "reference",
      runIndex: 1,
      target,
    });
    fs.writeFileSync(path.join(first.workspacePath, "scratch.txt"), "from run 1", "utf8");
    const second = workspace.prepare({
      evaluationId: "eval-1",
      role: "reference",
      runIndex: 2,
      target,
    });

    assert.notEqual(first.workspacePath, second.workspacePath);
    assert.equal(fs.existsSync(path.join(second.workspacePath, "scratch.txt")), false);
    assert.equal(
      fs.readFileSync(path.join(second.workspacePath, "requirements.md"), "utf8"),
      "# Requirements\n\nR1. Emit a report.\n"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prepare initializes a Git repository only when the target asks for one", () => {
  const tempRoot = makeTempRoot();
  const initCalls = [];
  try {
    const target = makeTarget(path.join(tempRoot, "fixture"), { initializeGitRepository: true });
    const workspace = new EvaluationWorkspace({
      tempRootPath: path.join(tempRoot, "runs"),
      execFile: (command, args, options) => initCalls.push({ command, args, cwd: options.cwd }),
    });

    const prepared = workspace.prepare({
      evaluationId: "eval-1",
      role: "reference",
      runIndex: 1,
      target,
    });

    assert.deepEqual(initCalls, [
      { command: "git", args: ["init", "--quiet"], cwd: prepared.workspacePath },
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("isActivationArtifact covers a written file and everything under an installed skill directory", () => {
  const tempRoot = makeTempRoot();
  try {
    const target = makeTarget(path.join(tempRoot, "fixture"));
    const workspace = new EvaluationWorkspace({ tempRootPath: path.join(tempRoot, "runs") });
    const prepared = workspace
      .prepare({ evaluationId: "eval-1", role: "candidate", runIndex: 1, target })
      .recordActivation(["CLAUDE.md", ".claude/skills/writing-clean-code"]);

    assert.equal(prepared.isActivationArtifact("CLAUDE.md"), true);
    assert.equal(
      prepared.isActivationArtifact(".claude/skills/writing-clean-code/SKILL.md"),
      true
    );
    assert.equal(prepared.isActivationArtifact("src/main.py"), false);
    assert.equal(prepared.isActivationArtifact("CLAUDE.md.backup"), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
