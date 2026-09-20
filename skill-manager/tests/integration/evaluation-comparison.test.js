const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  EvaluationComparisonError,
  assertComparable,
  assignLabels,
  blindingLevelFor,
  buildReviewBundle,
} = require("../../electron/evaluation-comparison");

const COMPARABILITY_KEY = "sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const RUBRIC = ["correctness", "readability"];
const SCENARIO_PROMPT = "Add unit tests for the invoice total calculation.";
const REPORT_BUILDER_SOURCE = "def build(rows):\n    return sorted(rows)\n";
const REFERENCE_ID = "invoice-report-effort-reference";
const CANDIDATE_ID = "invoice-report-effort-candidate";
const EVEN_SEED = 4;
const ODD_SEED = 7;

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-comparison-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function filesUnder(directoryPath) {
  const found = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    found.push(...(entry.isDirectory() ? filesUnder(entryPath) : [entryPath]));
  }
  return found;
}

function joinedTextUnder(directoryPath) {
  return filesUnder(directoryPath)
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");
}

function skillSubject(name = "writing-clean-code") {
  return {
    kind: "skill",
    name,
    sourcePath: `D:\\library\\${name}`,
    fingerprint: "sha256:skill",
    pointerText: null,
    workspacePath: null,
  };
}

function armConfiguration({
  agent = "codex",
  model = "luna",
  effort = "high",
  guidanceSet = [skillSubject()],
} = {}) {
  return { agent, model, effort, guidanceSet };
}

// The stored shape an arm result takes on disk, which is what the comparison
// reads; it is never handed live ArmResult objects.
function storedRun({
  runIndex = 1,
  evidence = null,
  checks = [],
  manifest = null,
  retainedWorkspacePath = null,
} = {}) {
  return {
    runIndex,
    run: {
      agent: "codex",
      role: "task",
      status: "completed",
      exitCode: 0,
      durationMs: 240000,
      lastMessage: "Added the unit tests.",
      modelRequested: "luna",
      modelReported: "luna-2026-06",
      effortRequested: "high",
      effortReported: "high",
      effortConfirmed: true,
      failureReason: null,
    },
    evidence,
    checks,
    manifest,
    activation: null,
    workspacePath: null,
    artifactsPath: null,
    retained: { workspacePath: retainedWorkspacePath, transcriptPath: null },
  };
}

function storedArm(overrides = {}) {
  return {
    id: REFERENCE_ID,
    definitionId: "invoice-report-effort",
    definitionVersion: 1,
    role: "reference",
    armConfiguration: armConfiguration(),
    targetId: "invoice-report",
    targetFingerprint: "sha256:target",
    scenarioId: "generate-report",
    scenarioFingerprint: "sha256:scenario",
    rubricFingerprint: "sha256:rubric",
    checksFingerprint: "sha256:checks",
    comparabilityKey: COMPARABILITY_KEY,
    agentVersion: "codex 1.2.3",
    modelIdentifier: "luna-2026-06",
    home: null,
    isolation: { isolated: true, detail: "Isolated codex home at D:\\runs\\codex-home." },
    activation: {},
    sampleSize: 1,
    complete: true,
    cost: null,
    runs: [storedRun()],
    createdAt: "2026-09-20T10:05:00.000Z",
    ...overrides,
  };
}

function referenceArm(overrides = {}) {
  return storedArm({ id: REFERENCE_ID, role: "reference", ...overrides });
}

function candidateArm(overrides = {}) {
  return storedArm({
    id: CANDIDATE_ID,
    role: "candidate",
    armConfiguration: armConfiguration({ effort: "medium" }),
    ...overrides,
  });
}

function bundleFor(outputPath, { reference, candidate, seed = EVEN_SEED, variedFactor = "effort" }) {
  return buildReviewBundle({
    reference,
    candidate,
    outputPath,
    variedFactor,
    rubric: RUBRIC,
    scenarioPrompt: SCENARIO_PROMPT,
    seed,
  });
}

test("two arms differing only in reasoning effort are comparable and report effort as the varied factor", () => {
  const comparison = assertComparable(referenceArm(), candidateArm());

  assert.equal(comparison.variedFactor, "effort");
  assert.deepEqual(comparison.drift, []);
});

test("two arms differing in both model and effort are refused and the message names both factors", () => {
  assert.throws(
    () =>
      assertComparable(
        referenceArm(),
        candidateArm({ armConfiguration: armConfiguration({ model: "vega", effort: "medium" }) })
      ),
    (error) =>
      error instanceof EvaluationComparisonError &&
      error.message.includes("differ in model, effort") &&
      error.message.includes("exactly one factor")
  );
});

test("two arms with identical configurations are refused because nothing can be attributed", () => {
  assert.throws(
    () => assertComparable(referenceArm(), candidateArm({ armConfiguration: armConfiguration() })),
    (error) =>
      error instanceof EvaluationComparisonError &&
      error.message.includes(REFERENCE_ID) &&
      error.message.includes(CANDIDATE_ID) &&
      error.message.includes("identical configurations")
  );
});

test("arms run on different scenarios are refused and the message names the scenario", () => {
  assert.throws(
    () =>
      assertComparable(
        referenceArm(),
        candidateArm({ scenarioFingerprint: "sha256:a-different-scenario" })
      ),
    (error) =>
      error instanceof EvaluationComparisonError &&
      error.message.includes("do not share the same scenario") &&
      error.message.includes("identical ground")
  );
});

test("arms judged against different rubrics are refused and the message names the rubric", () => {
  assert.throws(
    () =>
      assertComparable(
        referenceArm(),
        candidateArm({ rubricFingerprint: "sha256:a-different-rubric" })
      ),
    (error) =>
      error instanceof EvaluationComparisonError &&
      error.message.includes("do not share the same rubric")
  );
});

test("the same agent at two different versions between arms is reported as drift", () => {
  const comparison = assertComparable(
    referenceArm({ agentVersion: "codex 1.2.3" }),
    candidateArm({ agentVersion: "codex 2.0.0" })
  );

  assert.equal(comparison.drift.length, 1);
  assert.equal(
    comparison.drift[0],
    "Agent version differs between arms: codex 1.2.3 against codex 2.0.0."
  );
});

test("an arm recorded against an agent version older than the installed one is reported as drift naming the arm", () => {
  const comparison = assertComparable(referenceArm(), candidateArm(), {
    environment: { codex: "codex 2.0.0" },
  });

  assert.equal(comparison.drift.length, 2);
  assert.deepEqual(comparison.drift, [
    `Arm ${REFERENCE_ID} was recorded against codex 1.2.3 but codex 2.0.0 is installed now.`,
    `Arm ${CANDIDATE_ID} was recorded against codex 1.2.3 but codex 2.0.0 is installed now.`,
  ]);
});

test("ambient skills present for one arm and not the other are reported as drift", () => {
  const ambient = (skillNames) => ({
    agent: "codex",
    roots: [{ path: "C:\\Users\\analyst\\.agents\\skills", present: true, skillNames }],
    skillCount: skillNames.length,
    skillNames,
  });

  const comparison = assertComparable(
    referenceArm({ ambientGuidance: ambient(["testing-discipline"]) }),
    candidateArm({ ambientGuidance: ambient([]) })
  );

  assert.deepEqual(comparison.drift, [
    "Ambient skills differ between arms, so guidance outside this evaluation was not held constant.",
  ]);
});

test("a guidance comparison can be blinded fully, and an execution comparison only partially", () => {
  assert.equal(blindingLevelFor("guidance"), "full");
  assert.equal(blindingLevelFor("agent"), "partial");
  assert.equal(blindingLevelFor("model"), "partial");
  assert.equal(blindingLevelFor("effort"), "partial");
});

test("an even seed labels the reference A and an odd seed labels it B", () => {
  assert.deepEqual(assignLabels(EVEN_SEED).toJSON(), {
    seed: EVEN_SEED,
    labels: { reference: "A", candidate: "B" },
  });
  assert.deepEqual(assignLabels(ODD_SEED).toJSON(), {
    seed: ODD_SEED,
    labels: { reference: "B", candidate: "A" },
  });
});

test("assigning labels from the same seed twice gives the same mapping", () => {
  assert.deepEqual(assignLabels(EVEN_SEED).toJSON(), assignLabels(EVEN_SEED).toJSON());
});

test("every assigned label maps back to the role it was given", () => {
  const assignment = assignLabels(ODD_SEED);

  assert.equal(assignment.roleFor(assignment.labelFor("reference")), "reference");
  assert.equal(assignment.roleFor(assignment.labelFor("candidate")), "candidate");
  assert.equal(assignment.roleFor("C"), null);
});

test("the review bundle holds the task, the rubric and one labelled directory per arm", () => {
  const tempRoot = makeTempRoot();
  try {
    const outputPath = path.join(tempRoot, "bundle");

    const bundle = bundleFor(outputPath, {
      reference: referenceArm(),
      candidate: candidateArm(),
    });

    assert.deepEqual(fs.readdirSync(outputPath).sort(), ["A", "B", "rubric.json", "task.md"]);
    assert.deepEqual(fs.readdirSync(bundle.armPath("A")), ["evidence.json"]);
    assert.deepEqual(fs.readdirSync(bundle.armPath("B")), ["evidence.json"]);
    assert.equal(fs.readFileSync(path.join(outputPath, "task.md"), "utf8"), `${SCENARIO_PROMPT}\n`);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(outputPath, "rubric.json"), "utf8")),
      { dimensions: RUBRIC }
    );
    assert.equal(bundle.blinding, "partial");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// A model reviewer is handed the bundle root as its working directory, so a
// sealed A/B mapping stored inside it would be a file the reviewer could read.
test("the review bundle contains no file recording which label holds which arm", () => {
  const tempRoot = makeTempRoot();
  try {
    const outputPath = path.join(tempRoot, "bundle");

    const bundle = bundleFor(outputPath, {
      reference: referenceArm(),
      candidate: candidateArm(),
    });

    const everyFile = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else {
          everyFile.push({ name: entry.name, text: fs.readFileSync(entryPath, "utf8") });
        }
      }
    };
    walk(outputPath);

    assert.equal(
      everyFile.some((file) => file.name === "assignment.json"),
      false
    );
    for (const file of everyFile) {
      assert.equal(file.text.includes('"reference"'), false, `${file.name} names a role`);
      assert.equal(file.text.includes('"candidate"'), false, `${file.name} names a role`);
    }
    assert.deepEqual(bundle.assignment.toJSON(), {
      seed: EVEN_SEED,
      labels: { reference: "A", candidate: "B" },
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("no file in the review bundle names the agent, the model or the subject the arms were built from", () => {
  const tempRoot = makeTempRoot();
  try {
    const outputPath = path.join(tempRoot, "bundle");
    const run = storedRun({
      evidence: {
        files: [
          { path: "src/report_builder.py", bytes: 1240, role: "source" },
          { path: ".agents/skills/writing-clean-code/SKILL.md", bytes: 3100, role: "guidance" },
        ],
        dependencies: [],
      },
      checks: [
        { checkId: "unit-tests", kind: "validator", status: "pass", summary: "All 12 unit tests passed." },
      ],
      manifest: {
        toolVersions: { codex: "codex 1.2.3" },
        modelIdentifier: "luna-2026-06",
        loadedGuidance: ["writing-clean-code"],
      },
    });

    bundleFor(outputPath, {
      reference: referenceArm({ runs: [run] }),
      candidate: candidateArm({ runs: [run] }),
    });

    const bundleText = joinedTextUnder(outputPath);
    assert.equal(bundleText.includes("[redacted]"), true);
    assert.equal(bundleText.includes("codex"), false);
    assert.equal(bundleText.includes("luna"), false);
    assert.equal(bundleText.includes("writing-clean-code"), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a retained run workspace is copied into the bundle under its arm's label", () => {
  const tempRoot = makeTempRoot();
  try {
    const retainedPath = path.join(tempRoot, "store", "run-1", "workspace");
    writeFile(path.join(retainedPath, "src", "report_builder.py"), REPORT_BUILDER_SOURCE);
    const outputPath = path.join(tempRoot, "bundle");

    bundleFor(outputPath, {
      reference: referenceArm({ runs: [storedRun({ retainedWorkspacePath: retainedPath })] }),
      candidate: candidateArm(),
    });

    assert.equal(
      fs.readFileSync(path.join(outputPath, "A", "run-1", "src", "report_builder.py"), "utf8"),
      REPORT_BUILDER_SOURCE
    );
    assert.equal(fs.existsSync(path.join(outputPath, "B", "run-1")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
