const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  EvaluationReportError,
  conclusionCaveat,
  costComparisonLine,
  describeRecommendation,
  writeReport,
} = require("../../electron/evaluation-report-writer");
const { ReviewRecord } = require("../../electron/evaluation-review");

const RUBRIC = ["correctness", "readability"];
const TARGET_ID = "invoice-report";
const SCENARIO_ID = "generate-report";
const EQUIVALENCE_PHRASE = "Equivalent within the available evidence";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-report-writer-"));
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

function armConfiguration({ effort = "high", guidanceSet = [skillSubject()] } = {}) {
  return { agent: "codex", model: "luna", effort, guidanceSet };
}

function storedRun(runIndex) {
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
    evidence: null,
    checks: [
      { checkId: "unit-tests", kind: "validator", status: "pass", summary: "All 12 unit tests passed." },
    ],
    manifest: null,
    activation: null,
    workspacePath: null,
    artifactsPath: null,
    retained: { workspacePath: null, transcriptPath: null },
  };
}

function costRecord({ guidanceTokens = 1205, guidanceBytes = 4820 } = {}) {
  return {
    guidanceBytes,
    guidanceTokens,
    deliveredInstructionBytes: 0,
    totalDurationMs: 240000,
    subjects: [],
    runs: [],
  };
}

// The stored shape an arm result takes on disk, which is what the report reads.
function storedArm(overrides = {}) {
  const runIndexes = overrides.sampleSize ? [...Array(overrides.sampleSize).keys()] : [0];
  return {
    id: "invoice-report-effort-reference",
    definitionId: "invoice-report-effort",
    definitionVersion: 1,
    role: "reference",
    armConfiguration: armConfiguration(),
    targetId: TARGET_ID,
    targetFingerprint: "sha256:target",
    scenarioId: SCENARIO_ID,
    scenarioFingerprint: "sha256:scenario",
    rubricFingerprint: "sha256:rubric",
    checksFingerprint: "sha256:checks",
    comparabilityKey: "sha256:comparability",
    agentVersion: "codex 1.2.3",
    modelIdentifier: "luna-2026-06",
    home: null,
    isolation: { isolated: true, detail: "Isolated codex home at D:\\runs\\codex-home." },
    activation: {},
    sampleSize: runIndexes.length,
    complete: true,
    cost: costRecord(),
    runs: runIndexes.map((index) => storedRun(index + 1)),
    createdAt: "2026-09-20T10:05:00.000Z",
    ...overrides,
  };
}

function referenceArm(overrides = {}) {
  return storedArm({ id: "invoice-report-effort-reference", role: "reference", ...overrides });
}

function candidateArm(overrides = {}) {
  return storedArm({
    id: "invoice-report-effort-candidate",
    role: "candidate",
    armConfiguration: armConfiguration({ effort: "medium" }),
    ...overrides,
  });
}

function dimensions(names = RUBRIC) {
  return names.map((name) => ({
    name,
    assessment: `Both outputs are close on ${name}.`,
    evidence: "A/run-1/tests/test_invoice_total.py",
  }));
}

function review({
  reviewer = "model",
  recommendation = "candidate-better",
  names = RUBRIC,
  reasoning = "The candidate output covers the zero-line invoice.",
  uncertainty = "",
} = {}) {
  return new ReviewRecord({
    reviewer,
    dimensions: dimensions(names),
    recommendation,
    reasoning,
    uncertainty,
    blinding: "partial",
    evaluationModel: reviewer === "model" ? "opus-5" : null,
    evaluationModelFamily: reviewer === "model" ? "claude" : null,
  });
}

function definitionLike(overrides = {}) {
  return {
    id: "invoice-report-effort",
    decisionFraming: "improvement",
    guidanceDifferenceMode: null,
    rubric: RUBRIC,
    ...overrides,
  };
}

function reportFor({
  variedFactor = "effort",
  drift = [],
  reference = referenceArm(),
  candidate = candidateArm(),
  reviews = [review()],
  definition = definitionLike(),
  ambientGuidance = null,
}) {
  const tempRoot = makeTempRoot();
  const outputPath = path.join(tempRoot, "reports", "report.md");
  try {
    writeReport({
      comparison: { variedFactor, drift },
      reference,
      candidate,
      reviews,
      definitionLike: definition,
      scenarioId: SCENARIO_ID,
      targetId: TARGET_ID,
      ambientGuidance,
      outputPath,
    });
    return fs.readFileSync(outputPath, "utf8");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function sectionOf(report, heading) {
  return report.split(`## ${heading}\n`)[1];
}

test("a guidance comparison names its arms Baseline and Guided", () => {
  const report = reportFor({ variedFactor: "guidance" });

  assert.equal(report.includes("## Baseline arm\n"), true);
  assert.equal(report.includes("## Guided arm\n"), true);
  assert.equal(report.includes("## Reference arm\n"), false);
});

test("an effort comparison names its arms Reference and Candidate", () => {
  const report = reportFor({ variedFactor: "effort" });

  assert.equal(report.includes("## Reference arm\n"), true);
  assert.equal(report.includes("## Candidate arm\n"), true);
  assert.equal(report.includes("## Baseline arm\n"), false);
});

test("the conclusion states how many runs stand behind each arm", () => {
  const report = reportFor({
    reference: referenceArm({ sampleSize: 3 }),
    candidate: candidateArm({ sampleSize: 2 }),
  });

  assert.equal(
    report.includes(
      "**model review:** Candidate better, from 3 reference runs and 2 candidate runs."
    ),
    true
  );
});

test("a single run per arm is reported in the singular on both sides", () => {
  const report = reportFor({
    reference: referenceArm({ sampleSize: 1 }),
    candidate: candidateArm({ sampleSize: 2 }),
  });

  assert.equal(
    report.includes(
      "**model review:** Candidate better, from 1 reference run and 2 candidate runs."
    ),
    true
  );
});

test("an inconclusive verdict under an improvement framing is not reported as equivalence", () => {
  const report = reportFor({ reviews: [review({ recommendation: "inconclusive" })] });

  assert.equal(
    report.includes(
      "> This is not a finding of equivalence. It means the sample was too small to tell."
    ),
    true
  );
  assert.equal(report.includes(EQUIVALENCE_PHRASE), false);
});

test("an inconclusive verdict under a non-inferiority framing is reported as a failure to show safety", () => {
  const report = reportFor({
    reviews: [review({ recommendation: "inconclusive" })],
    definition: definitionLike({ decisionFraming: "non-inferiority" }),
  });

  assert.equal(report.includes("has failed to show safety"), true);
  assert.equal(
    report.includes("reading it as permission to switch is the error the framing exists to prevent"),
    true
  );
  assert.equal(report.includes(EQUIVALENCE_PHRASE), false);
});

test("a non-inferiority report states the guidance cost difference behind the verdict", () => {
  const report = reportFor({
    reference: referenceArm({ cost: costRecord({ guidanceTokens: 800 }) }),
    candidate: candidateArm({ cost: costRecord({ guidanceTokens: 600 }) }),
    definition: definitionLike({ decisionFraming: "non-inferiority" }),
  });

  assert.equal(
    report.includes(
      "Cost difference behind this verdict: The candidate's guidance is about 200 fewer tokens (25%) than the reference's."
    ),
    true
  );
});

test("the cost comparison reports fewer tokens when the candidate's guidance is the cheaper one", () => {
  assert.equal(
    costComparisonLine(
      referenceArm({ cost: costRecord({ guidanceTokens: 800 }) }),
      candidateArm({ cost: costRecord({ guidanceTokens: 600 }) })
    ),
    "The candidate's guidance is about 200 fewer tokens (25%) than the reference's."
  );
  assert.equal(
    costComparisonLine(
      referenceArm({ cost: costRecord({ guidanceTokens: 800 }) }),
      candidateArm({ cost: costRecord({ guidanceTokens: 1000 }) })
    ),
    "The candidate's guidance is about 200 more tokens (25%) than the reference's."
  );
  assert.equal(
    costComparisonLine(
      referenceArm({ cost: costRecord({ guidanceTokens: 800 }) }),
      candidateArm({ cost: costRecord({ guidanceTokens: 800 }) })
    ),
    "Guidance cost is identical in both arms."
  );
});

test("an improvement report leaves the cost difference out of the conclusion", () => {
  const report = reportFor({
    reference: referenceArm({ cost: costRecord({ guidanceTokens: 800 }) }),
    candidate: candidateArm({ cost: costRecord({ guidanceTokens: 600 }) }),
  });

  assert.equal(report.includes("Cost difference behind this verdict"), false);
});

test("two reviews reaching different verdicts are reported as a disagreement, not a tie", () => {
  const report = reportFor({
    reviews: [
      review({ reviewer: "model", recommendation: "candidate-better" }),
      review({ reviewer: "user", recommendation: "mixed" }),
    ],
  });

  assert.equal(
    report.includes(
      "> The reviews disagree. That is a finding about the automated reviewer, not a tie, " +
        "and both verdicts are recorded separately below."
    ),
    true
  );
});

test("two reviews reaching the same verdict are reported without a disagreement note", () => {
  const report = reportFor({
    reviews: [
      review({ reviewer: "model", recommendation: "candidate-better" }),
      review({ reviewer: "user", recommendation: "candidate-better" }),
    ],
  });

  assert.equal(report.includes("The reviews disagree"), false);
});

test("activation is reported per arm, counting the runs where it could not be determined", () => {
  const activation = {
    "writing-clean-code": {
      kind: "skill",
      activated: 2,
      notActivated: 0,
      undetermined: 1,
      totalRuns: 3,
    },
    "repository-instructions": { kind: "instruction-file", state: "always-in-context" },
  };
  const report = reportFor({
    reference: referenceArm({ sampleSize: 3, activation }),
    candidate: candidateArm({ sampleSize: 3, activation }),
  });

  const section = sectionOf(report, "Activation");
  assert.equal(
    section.includes(
      "- writing-clean-code (skill): activated in 2/3, not activated in 0, undetermined in 1"
    ),
    true
  );
  assert.equal(
    section.includes("- repository-instructions: always in context (instruction-file)"),
    true
  );
  assert.equal(section.includes("### Reference\n"), true);
  assert.equal(section.includes("### Candidate\n"), true);
});

test("ambient guidance reaching both arms is listed by skill name and by the roots it came from", () => {
  const report = reportFor({
    ambientGuidance: {
      agent: "codex",
      roots: [
        { path: "C:\\Users\\analyst\\.agents\\skills", present: true, skillNames: ["testing-discipline"] },
        { path: "C:\\Users\\analyst\\.codex\\skills", present: false, skillNames: [] },
      ],
      skillCount: 1,
      skillNames: ["testing-discipline"],
    },
  });

  assert.equal(
    report.includes(
      "Ambient guidance reaching both arms regardless of isolation " +
        "(1 skills from C:\\Users\\analyst\\.agents\\skills):"
    ),
    true
  );
  assert.equal(report.includes("- testing-discipline"), true);
  assert.equal(report.includes("C:\\Users\\analyst\\.codex\\skills"), false);
});

test("a report without ambient guidance says nothing about roots that were never scanned", () => {
  const report = reportFor({});

  assert.equal(report.includes("Ambient guidance reaching both arms"), false);
});

test("drift found while comparing the arms is recorded under the scope of evidence", () => {
  const report = reportFor({
    drift: ["Agent version differs between arms: codex 1.2.3 against codex 2.0.0."],
  });

  const scope = sectionOf(report, "Scope of evidence");
  assert.equal(
    scope.includes("- Drift: Agent version differs between arms: codex 1.2.3 against codex 2.0.0."),
    true
  );
  assert.equal(scope.includes(`- This comparison covers scenario ${SCENARIO_ID} only.`), true);
  assert.equal(scope.includes("- Blinding: model=partial."), true);
});

test("a review that skipped a rubric dimension is reported as resting on a subset", () => {
  const report = reportFor({ reviews: [review({ names: ["correctness"] })] });

  assert.equal(
    report.includes(
      "> This review did not cover every rubric dimension, so the verdict rests on a subset."
    ),
    true
  );
});

test("a review covering every rubric dimension is reported without the subset warning", () => {
  const report = reportFor({ reviews: [review()] });

  assert.equal(report.includes("so the verdict rests on a subset"), false);
});

test("each recommendation is described in the arm names of the comparison", () => {
  const guidanceNames = { reference: "Baseline", candidate: "Guided" };

  assert.equal(describeRecommendation("reference-better", guidanceNames), "Baseline better");
  assert.equal(describeRecommendation("candidate-better", guidanceNames), "Guided better");
  assert.equal(describeRecommendation("mixed", guidanceNames), "Mixed");
  assert.equal(describeRecommendation("equivalent", guidanceNames), EQUIVALENCE_PHRASE);
  assert.equal(describeRecommendation("inconclusive", guidanceNames), "Inconclusive");
});

test("a verdict that is not inconclusive carries no caveat", () => {
  assert.equal(
    conclusionCaveat(review({ recommendation: "candidate-better" }), definitionLike()),
    null
  );
  assert.equal(
    conclusionCaveat(
      review({ recommendation: "equivalent" }),
      definitionLike({ decisionFraming: "non-inferiority" })
    ),
    null
  );
});

test("a report with no review at all is refused", () => {
  const tempRoot = makeTempRoot();
  try {
    assert.throws(
      () =>
        writeReport({
          comparison: { variedFactor: "effort", drift: [] },
          reference: referenceArm(),
          candidate: candidateArm(),
          reviews: [],
          definitionLike: definitionLike(),
          scenarioId: SCENARIO_ID,
          targetId: TARGET_ID,
          outputPath: path.join(tempRoot, "reports", "report.md"),
        }),
      (error) =>
        error instanceof EvaluationReportError &&
        error.message === "A report needs at least one review."
    );
    assert.equal(fs.existsSync(path.join(tempRoot, "reports")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
