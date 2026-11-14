const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  ArmConfiguration,
  EvaluationDefinition,
  GuidanceSet,
} = require("../../electron/evaluation-definition");
const { EvaluationService } = require("../../electron/evaluation-service");
const { EvaluationWorkspace } = require("../../electron/evaluation-workspace");

const DEFINITION_ID = "invoice-report-effort";
const DEFINITION_VERSION = 3;

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-service-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function armWithEffort(effort) {
  return new ArmConfiguration({
    agent: "codex",
    model: "luna",
    effort,
    guidanceSet: new GuidanceSet([]),
  });
}

function storedDefinition() {
  return new EvaluationDefinition({
    id: DEFINITION_ID,
    version: DEFINITION_VERSION,
    referenceArm: armWithEffort("medium"),
    candidateArm: armWithEffort("high"),
    targetId: "invoice-report",
    targetFingerprint: "sha256:target",
    scenarioId: "generate-report",
    scenarioFingerprint: "sha256:scenario",
    rubric: ["correctness"],
    checksFingerprint: "sha256:checks",
  });
}

function leftoverRunFile(workspace, definitionVersion) {
  return writeFile(
    path.join(
      workspace.baseFor(`${DEFINITION_ID}-v${definitionVersion}`),
      "arm-0123456789ab",
      "run-1",
      "workspace",
      "report.py"
    ),
    "print('earlier run')\n"
  );
}

// The home stub throws to stop the run in its first arm.
async function startUntilFirstArm(workspace, atFirstArm = () => {}) {
  const stoppedInFirstArm = new Error("stopped in the first arm");
  let requestedHome = null;
  const service = new EvaluationService({
    catalog: {
      getTarget: () => ({ id: "invoice-report" }),
      getScenario: () => ({ id: "generate-report" }),
    },
    store: { loadDefinition: storedDefinition },
    workspace,
    isolatedHome: {
      create(home) {
        requestedHome = home;
        throw stoppedInFirstArm;
      },
    },
    runner: {},
    checkRunner: {},
    scanAmbient: () => ({ has: () => false }),
  });
  const onProgress = (event) => {
    if (event.phase === "arm-started" && event.role === "reference") {
      atFirstArm();
    }
  };
  await assert.rejects(service.startEvaluation(DEFINITION_ID, { onProgress }), stoppedInFirstArm);
  return requestedHome;
}

// The agent is told its home's path, so anything it records about its
// configuration would carry a role named there into the review bundle.
test("the reference arm's agent home is asked for at a path that does not name the role", async () => {
  const tempRoot = makeTempRoot();
  try {
    const workspace = new EvaluationWorkspace({ tempRootPath: tempRoot });

    const requestedHome = await startUntilFirstArm(workspace);

    const pathBelowTempRoot = path.relative(tempRoot, requestedHome.homePath);
    assert.equal(
      pathBelowTempRoot.includes("reference"),
      false,
      `${pathBelowTempRoot} names the reference arm`
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an evaluation reaches its first arm with the earlier run directories of that definition version gone", async () => {
  const tempRoot = makeTempRoot();
  try {
    const workspace = new EvaluationWorkspace({ tempRootPath: tempRoot });
    const earlierRunFile = leftoverRunFile(workspace, DEFINITION_VERSION);
    let earlierRunFilePresent = null;

    await startUntilFirstArm(workspace, () => {
      earlierRunFilePresent = fs.existsSync(earlierRunFile);
    });

    assert.equal(earlierRunFilePresent, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("starting an evaluation leaves the run directories of another definition version in place", async () => {
  const tempRoot = makeTempRoot();
  try {
    const workspace = new EvaluationWorkspace({ tempRootPath: tempRoot });
    const otherVersionRunFile = leftoverRunFile(workspace, DEFINITION_VERSION - 1);
    let otherVersionRunFilePresent = null;

    await startUntilFirstArm(workspace, () => {
      otherVersionRunFilePresent = fs.existsSync(otherVersionRunFile);
    });

    assert.equal(otherVersionRunFilePresent, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
