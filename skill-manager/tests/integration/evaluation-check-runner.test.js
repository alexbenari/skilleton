const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { CheckRunner } = require("../../electron/evaluation-check-runner");
const { readRunManifest } = require("../../electron/evaluation-evidence");
const { CheckDefinition } = require("../../electron/evaluation-catalog");

// The checks below shell out for real, so they name the shell this platform has.
const SHELL = process.platform === "win32" ? "cmd" : "sh";
const SCENARIO_PATH = "scenarios/invoice-report/generate-report.md";

const PASSING_CHECK_SCRIPT = `
const result = { status: "pass", summary: "All 12 unit tests passed.", findings: [] };
console.log(JSON.stringify(result));
`;

const FAILING_CHECK_SCRIPT = `
const result = {
  status: "fail",
  summary: "2 of 12 unit tests failed.",
  findings: [{ path: "src/report-builder.js", message: "Column totals are off by one." }],
};
console.log(JSON.stringify(result));
process.exit(1);
`;

const CRASHING_CHECK_SCRIPT = `
console.error("ReferenceError: reportBuilder is not defined");
process.exit(3);
`;

const CHATTY_CHECK_SCRIPT = `
console.log("Collecting test files...");
console.log("Running 12 tests...");
console.log(JSON.stringify({ status: "pass", summary: "All 12 unit tests passed.", findings: [] }));
`;

const MANIFEST_TEST_SCRIPT = `
const fs = require("fs");
fs.writeFileSync("manifest-test-ran.txt", "ran\\n");
console.log(JSON.stringify({ status: "pass", summary: "All 12 unit tests passed.", findings: [] }));
`;

const SLEEPING_CHECK_SCRIPT = `
setTimeout(() => {
  console.log(JSON.stringify({ status: "pass", summary: "Finished late.", findings: [] }));
}, 4000);
`;

const CONTEXT_CHECK_SCRIPT = `
console.log(JSON.stringify({ status: "pass", summary: "Reviewed " + process.argv[2], findings: [] }));
`;

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-check-runner-"));
}

function writeScript(directoryPath, filename, source) {
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, filename), source, "utf8");
}

function checkDefinition({ id, command, kind = "validator", timeoutSeconds = 30, shell = SHELL }) {
  return new CheckDefinition({ id, kind, command, timeoutSeconds, shell }, SCENARIO_PATH);
}

// A workspace the check scripts run inside, plus the checks directory beside it.
function makeContext(tempRoot, { manifest = null } = {}) {
  const workspacePath = path.join(tempRoot, "workspace");
  const checksPath = path.join(tempRoot, "checks");
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(checksPath, { recursive: true });
  return { workspacePath, checksPath, manifest };
}

function writeRunManifest(workspacePath, steps) {
  fs.writeFileSync(
    path.join(workspacePath, "run-manifest.json"),
    `${JSON.stringify({ shell: SHELL, ...steps }, null, 2)}\n`,
    "utf8"
  );
}

test("a check whose script prints a pass object is reported as a passing check", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeScript(context.workspacePath, "unit-tests.js", PASSING_CHECK_SCRIPT);

    const result = await new CheckRunner().runOne(
      checkDefinition({ id: "unit-tests", command: "node unit-tests.js" }),
      context
    );

    assert.equal(result.status, "pass");
    assert.equal(result.passed(), true);
    assert.equal(result.summary, "All 12 unit tests passed.");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.findings, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a check that prints a fail object and exits non-zero is a failing check, not an error", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeScript(context.workspacePath, "unit-tests.js", FAILING_CHECK_SCRIPT);

    const result = await new CheckRunner().runOne(
      checkDefinition({ id: "unit-tests", command: "node unit-tests.js" }),
      context
    );

    assert.equal(result.status, "fail");
    assert.equal(result.summary, "2 of 12 unit tests failed.");
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.findings, [
      { path: "src/report-builder.js", message: "Column totals are off by one." },
    ]);
    assert.equal(result.reason, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a check that crashes without printing a result object is reported as unparseable output", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeScript(context.workspacePath, "unit-tests.js", CRASHING_CHECK_SCRIPT);

    const result = await new CheckRunner().runOne(
      checkDefinition({ id: "unit-tests", command: "node unit-tests.js" }),
      context
    );

    assert.equal(result.status, "error");
    assert.equal(result.reason, "unparseable-output");
    assert.equal(result.exitCode, 3);
    assert.equal(result.output.includes("ReferenceError: reportBuilder is not defined"), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a check that prints progress lines before its result object still parses", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeScript(context.workspacePath, "unit-tests.js", CHATTY_CHECK_SCRIPT);

    const result = await new CheckRunner().runOne(
      checkDefinition({ id: "unit-tests", command: "node unit-tests.js" }),
      context
    );

    assert.equal(result.status, "pass");
    assert.equal(result.summary, "All 12 unit tests passed.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a manifest:test check runs the test command the run manifest declares", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeScript(context.workspacePath, "manifest-test.js", MANIFEST_TEST_SCRIPT);
    writeRunManifest(context.workspacePath, {
      install: "npm install",
      test: "node manifest-test.js",
    });
    context.manifest = readRunManifest(context.workspacePath);

    const result = await new CheckRunner().runOne(
      checkDefinition({ id: "unit-tests", command: "manifest:test", shell: null }),
      context
    );

    assert.equal(result.status, "pass");
    assert.equal(result.command, "node manifest-test.js");
    assert.equal(result.shell, SHELL);
    assert.equal(
      fs.existsSync(path.join(context.workspacePath, "manifest-test-ran.txt")),
      true
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a manifest:test check with no run manifest errors without starting a process", async () => {
  const tempRoot = makeTempRoot();
  const spawnCalls = [];
  try {
    const context = makeContext(tempRoot);
    context.manifest = readRunManifest(context.workspacePath);
    const runner = new CheckRunner({
      spawn: (file, args) => {
        spawnCalls.push({ file, args });
        throw new Error("the check runner should not have started a process");
      },
    });

    const result = await runner.runOne(
      checkDefinition({ id: "unit-tests", command: "manifest:test", shell: null }),
      context
    );

    assert.equal(result.status, "error");
    assert.equal(result.reason, "manifest-missing");
    assert.equal(result.summary, "run-manifest.json was not written by the run.");
    assert.deepEqual(spawnCalls, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a manifest:build check errors when the manifest declares no build step", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeRunManifest(context.workspacePath, { test: "node manifest-test.js" });
    context.manifest = readRunManifest(context.workspacePath);

    const result = await new CheckRunner().runOne(
      checkDefinition({ id: "build", command: "manifest:build", shell: null }),
      context
    );

    assert.equal(result.status, "error");
    assert.equal(result.reason, "manifest-step-missing");
    assert.equal(result.summary, "The run manifest declares no build command.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a check that outlives its timeout is stopped and reported as a timeout", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeScript(context.workspacePath, "slow-suite.js", SLEEPING_CHECK_SCRIPT);

    const result = await new CheckRunner().runOne(
      checkDefinition({ id: "unit-tests", command: "node slow-suite.js", timeoutSeconds: 1 }),
      context
    );

    assert.equal(result.status, "error");
    assert.equal(result.reason, "timeout");
    assert.equal(result.summary, "Check unit-tests exceeded 1s and was stopped.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the checksDir and workspace placeholders are substituted into the command", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeScript(context.checksPath, "structure-check.js", CONTEXT_CHECK_SCRIPT);

    const result = await new CheckRunner().runOne(
      checkDefinition({
        id: "structure",
        kind: "behavioral",
        command: "node {checksDir}/structure-check.js {workspace}",
      }),
      context
    );

    assert.equal(
      result.command,
      `node ${context.checksPath}/structure-check.js ${context.workspacePath}`
    );
    assert.equal(result.status, "pass");
    assert.equal(result.summary, `Reviewed ${context.workspacePath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runAll reports one result per check, in the order the scenario declares them", async () => {
  const tempRoot = makeTempRoot();
  try {
    const context = makeContext(tempRoot);
    writeScript(context.workspacePath, "unit-tests.js", PASSING_CHECK_SCRIPT);
    writeScript(context.workspacePath, "lint.js", FAILING_CHECK_SCRIPT);
    writeScript(context.workspacePath, "structure.js", CHATTY_CHECK_SCRIPT);

    const results = await new CheckRunner().runAll(
      [
        checkDefinition({ id: "unit-tests", command: "node unit-tests.js" }),
        checkDefinition({ id: "lint", command: "node lint.js" }),
        checkDefinition({ id: "structure", kind: "behavioral", command: "node structure.js" }),
      ],
      context
    );

    assert.deepEqual(
      results.map((result) => [result.checkId, result.status]),
      [
        ["unit-tests", "pass"],
        ["lint", "fail"],
        ["structure", "pass"],
      ]
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
