const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ArmResult, ArmResultError, ArmRun } = require("../../electron/evaluation-arm-result");
const { EvaluationStore, EvaluationStoreError } = require("../../electron/evaluation-store");
const { ArmConfiguration, GuidanceSet, Subject } = require("../../electron/evaluation-definition");
const { ActivationSignal, RunRecord } = require("../../electron/evaluation-agent-runner");
const { ArtifactInventory } = require("../../electron/evaluation-evidence");
const { CheckResult } = require("../../electron/evaluation-check-runner");
const { AgentHome } = require("../../electron/evaluation-home");

const COMPARABILITY_KEY = "sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const ISOLATED_HOME_PATH = "D:\\runs\\codex-home";
const REPORT_BUILDER_SOURCE = "def build(rows):\n    return sorted(rows)\n";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-arm-result-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function skillSubject(name = "writing-clean-code") {
  return new Subject({
    kind: "skill",
    name,
    sourcePath: `D:\\library\\${name}`,
    fingerprint: "sha256:skill",
  });
}

function instructionSubject() {
  return new Subject({
    kind: "instruction-file",
    name: "repository-instructions",
    sourcePath: "D:\\library\\instructions.md",
    fingerprint: "sha256:instructions",
  });
}

function armConfigurationWith(subjects) {
  return new ArmConfiguration({
    agent: "codex",
    model: "luna",
    effort: "high",
    guidanceSet: new GuidanceSet(subjects),
  });
}

function armRun({ runIndex, status = "completed", signals = [], workspacePath = null }) {
  return new ArmRun({
    runIndex,
    runRecord: new RunRecord({
      agent: "codex",
      role: "task",
      status,
      exitCode: status === "completed" ? 0 : 1,
      startedAt: "2026-09-20T10:00:00.000Z",
      endedAt: "2026-09-20T10:04:00.000Z",
      durationMs: 240000,
      modelRequested: "luna",
      effortRequested: "high",
      effortReported: "high",
      activationSignals: signals,
      failureReason: status === "completed" ? null : "the CLI exited before finishing",
    }),
    evidence: new ArtifactInventory({
      files: [{ path: "src/report_builder.py", bytes: 1240, role: "source" }],
      dependencies: [],
    }),
    checkResults: [
      new CheckResult({
        checkId: "unit-tests",
        kind: "validator",
        status: "pass",
        summary: "All 12 unit tests passed.",
      }),
    ],
    workspacePath,
  });
}

function skillSignal(state, subjectName = "writing-clean-code") {
  return new ActivationSignal({
    subjectName,
    kind: "skill",
    state,
    evidence: "codex transcript",
  });
}

function armResultWith({
  id = "invoice-report-guidance-candidate",
  definitionId = "invoice-report-guidance",
  runs,
  armConfiguration = armConfigurationWith([skillSubject()]),
  homeRecord = null,
}) {
  return new ArmResult({
    id,
    definitionId,
    definitionVersion: 1,
    role: "candidate",
    armConfiguration,
    targetId: "invoice-report",
    targetFingerprint: "sha256:target",
    scenarioId: "generate-report",
    scenarioFingerprint: "sha256:scenario",
    rubricFingerprint: "sha256:rubric",
    checksFingerprint: "sha256:checks",
    comparabilityKey: COMPARABILITY_KEY,
    agentVersion: "codex 1.2.3",
    modelIdentifier: "luna-2026-06",
    homeRecord,
    runs,
    createdAt: "2026-09-20T10:05:00.000Z",
  });
}

function isolatedHome(homePath) {
  return new AgentHome({
    agent: "codex",
    homePath,
    envVarName: "CODEX_HOME",
    isolation: "isolated",
    copiedFilenames: ["auth.json"],
  });
}

function inheritedHome(inheritedFrom) {
  return new AgentHome({
    agent: "codex",
    homePath: inheritedFrom,
    envVarName: "CODEX_HOME",
    isolation: "inherited",
    copiedFilenames: [],
    inheritedFrom,
  });
}

test("an arm result reports its sample size and stays incomplete while one run failed", () => {
  const result = armResultWith({
    runs: [armRun({ runIndex: 1 }), armRun({ runIndex: 2, status: "failed" })],
  });

  assert.equal(result.sampleSize(), 2);
  assert.equal(result.isComplete(), false);
  assert.equal(result.completedRuns().length, 1);
});

test("the activation summary counts each skill state per run and marks the instruction file always in context", () => {
  const result = armResultWith({
    armConfiguration: armConfigurationWith([skillSubject(), instructionSubject()]),
    runs: [
      armRun({ runIndex: 1, signals: [skillSignal("activated")] }),
      armRun({ runIndex: 2, signals: [skillSignal("not-activated")] }),
      armRun({ runIndex: 3, signals: [skillSignal("undetermined")] }),
    ],
  });

  assert.deepEqual(result.activationSummary(), {
    "writing-clean-code": {
      kind: "skill",
      activated: 1,
      notActivated: 1,
      undetermined: 1,
      totalRuns: 3,
    },
    "repository-instructions": { kind: "instruction-file", state: "always-in-context" },
  });
});

test("the isolation summary reports an isolated agent home", () => {
  const result = armResultWith({
    runs: [armRun({ runIndex: 1 })],
    homeRecord: isolatedHome(ISOLATED_HOME_PATH),
  });

  assert.deepEqual(result.isolationSummary(), {
    isolated: true,
    detail: `Isolated codex home at ${ISOLATED_HOME_PATH}.`,
  });
});

test("the isolation summary names the user's home when the run inherited it", () => {
  const usersHome = "C:\\Users\\analyst\\.codex";
  const result = armResultWith({
    runs: [armRun({ runIndex: 1 })],
    homeRecord: inheritedHome(usersHome),
  });

  assert.deepEqual(result.isolationSummary(), {
    isolated: false,
    detail: `Inherited the user's codex home at ${usersHome}.`,
  });
});

test("an arm result with no runs is refused", () => {
  assert.throws(
    () => armResultWith({ runs: [] }),
    (error) =>
      error instanceof ArmResultError &&
      error.message.includes("invoice-report-guidance-candidate")
  );
});

test("saveArmResult writes arm.json and loadArmResult returns the stored arm", () => {
  const tempRoot = makeTempRoot();
  try {
    const store = new EvaluationStore({ rootPath: path.join(tempRoot, "store") });
    const armConfiguration = armConfigurationWith([skillSubject()]);
    const result = armResultWith({
      armConfiguration,
      runs: [armRun({ runIndex: 1 }), armRun({ runIndex: 2 })],
    });

    const writtenPath = store.saveArmResult(result, { retainWorkspaces: false });

    assert.equal(
      writtenPath,
      path.join(
        tempRoot,
        "store",
        "arm-results",
        "invoice-report-guidance-candidate",
        "arm.json"
      )
    );
    const stored = store.loadArmResult("invoice-report-guidance-candidate");
    assert.equal(stored.sampleSize, 2);
    assert.equal(stored.comparabilityKey, COMPARABILITY_KEY);
    assert.deepEqual(stored.armConfiguration, armConfiguration.toJSON());
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("saveArmResult copies each run's workspace so a later change to the temp copy cannot reach it", () => {
  const tempRoot = makeTempRoot();
  try {
    const store = new EvaluationStore({ rootPath: path.join(tempRoot, "store") });
    const runWorkspacePath = path.join(tempRoot, "runs", "run-1", "workspace");
    writeFile(path.join(runWorkspacePath, "src", "report_builder.py"), REPORT_BUILDER_SOURCE);
    const result = armResultWith({
      runs: [armRun({ runIndex: 1, workspacePath: runWorkspacePath })],
    });

    store.saveArmResult(result);

    const retainedPath = path.join(
      tempRoot,
      "store",
      "arm-results",
      "invoice-report-guidance-candidate",
      "run-1",
      "workspace"
    );
    assert.equal(
      store.loadArmResult("invoice-report-guidance-candidate").runs[0].retained.workspacePath,
      retainedPath
    );
    fs.writeFileSync(
      path.join(runWorkspacePath, "src", "report_builder.py"),
      "def build(rows):\n    return rows\n",
      "utf8"
    );
    assert.equal(
      fs.readFileSync(path.join(retainedPath, "src", "report_builder.py"), "utf8"),
      REPORT_BUILDER_SOURCE
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("saveArmResult with retainWorkspaces false records no retained workspace", () => {
  const tempRoot = makeTempRoot();
  try {
    const store = new EvaluationStore({ rootPath: path.join(tempRoot, "store") });
    const runWorkspacePath = path.join(tempRoot, "runs", "run-1", "workspace");
    writeFile(path.join(runWorkspacePath, "src", "report_builder.py"), REPORT_BUILDER_SOURCE);
    const result = armResultWith({
      runs: [armRun({ runIndex: 1, workspacePath: runWorkspacePath })],
    });

    store.saveArmResult(result, { retainWorkspaces: false });

    const stored = store.loadArmResult("invoice-report-guidance-candidate");
    assert.equal(stored.runs[0].retained.workspacePath, null);
    assert.equal(
      fs.existsSync(
        path.join(
          tempRoot,
          "store",
          "arm-results",
          "invoice-report-guidance-candidate",
          "run-1",
          "workspace"
        )
      ),
      false
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("saveArmResult refuses an id that was already saved", () => {
  const tempRoot = makeTempRoot();
  try {
    const store = new EvaluationStore({ rootPath: path.join(tempRoot, "store") });
    store.saveArmResult(armResultWith({ runs: [armRun({ runIndex: 1 })] }), {
      retainWorkspaces: false,
    });

    assert.throws(
      () =>
        store.saveArmResult(
          armResultWith({ runs: [armRun({ runIndex: 1 }), armRun({ runIndex: 2 })] }),
          { retainWorkspaces: false }
        ),
      (error) =>
        error instanceof EvaluationStoreError &&
        error.message.includes("invoice-report-guidance-candidate")
    );
    assert.equal(store.loadArmResult("invoice-report-guidance-candidate").sampleSize, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("listArmResults returns only the arms saved for the requested definition", () => {
  const tempRoot = makeTempRoot();
  try {
    const store = new EvaluationStore({ rootPath: path.join(tempRoot, "store") });
    const options = { retainWorkspaces: false };
    store.saveArmResult(
      armResultWith({
        id: "invoice-report-guidance-reference",
        runs: [armRun({ runIndex: 1 })],
      }),
      options
    );
    store.saveArmResult(
      armResultWith({
        id: "invoice-report-guidance-candidate",
        runs: [armRun({ runIndex: 1 })],
      }),
      options
    );
    store.saveArmResult(
      armResultWith({
        id: "code-review-effort-candidate",
        definitionId: "code-review-effort",
        runs: [armRun({ runIndex: 1 })],
      }),
      options
    );

    const found = store.listArmResults({ definitionId: "invoice-report-guidance" });

    assert.deepEqual(
      found.map((stored) => stored.id),
      ["invoice-report-guidance-candidate", "invoice-report-guidance-reference"]
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
