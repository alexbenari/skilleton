const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  EvaluationReviewError,
  ModelReviewer,
  ReviewRecord,
  extractJsonBlock,
  readUserReviewFile,
  recordUserReview,
  relabelRecommendation,
} = require("../../electron/evaluation-review");
const { ReviewBundle, assignLabels } = require("../../electron/evaluation-comparison");
const { AgentRunner } = require("../../electron/evaluation-agent-runner");
const { ArmConfiguration, GuidanceSet } = require("../../electron/evaluation-definition");
const { fakeAdapters } = require("../helpers/fake-agent-runner");

const RUBRIC = ["correctness", "readability"];
const SCENARIO_PROMPT = "Add unit tests for the invoice total calculation.";
const BUNDLE_ROOT = "D:\\runs\\invoice-report-effort\\bundle";
const REFERENCE_FIRST_SEED = 4;
const CANDIDATE_FIRST_SEED = 7;

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-review-"));
}

function dimensions(names = RUBRIC) {
  return names.map((name) => ({
    name,
    assessment: `A and B are close on ${name}; A states the boundary cases explicitly.`,
    evidence: "A/run-1/tests/test_invoice_total.py",
  }));
}

function reviewBundle({ seed = REFERENCE_FIRST_SEED, blinding = "partial" } = {}) {
  return new ReviewBundle({
    rootPath: BUNDLE_ROOT,
    assignment: assignLabels(seed),
    blinding,
    variedFactor: "effort",
    rubric: RUBRIC,
    scenarioPrompt: SCENARIO_PROMPT,
  });
}

function evaluationArm() {
  return new ArmConfiguration({
    agent: "claude",
    model: "opus-5",
    effort: "high",
    guidanceSet: new GuidanceSet([]),
  });
}

function reviewerFor(script) {
  return new ModelReviewer({ runner: new AgentRunner({ adapters: fakeAdapters({ claude: script }) }) });
}

function verdictReply(recommendation) {
  return [
    "I read both outputs and the rubric.",
    "```json",
    JSON.stringify({
      dimensions: dimensions(),
      recommendation,
      reasoning: "B covers the zero-line invoice; A does not.",
      uncertainty: "Neither output was run against the production data set.",
    }),
    "```",
  ].join("\n");
}

test("a review recording a recommendation outside the agreed vocabulary is refused", () => {
  assert.throws(
    () =>
      new ReviewRecord({
        reviewer: "model",
        dimensions: dimensions(),
        recommendation: "candidate-wins",
        blinding: "partial",
      }),
    (error) =>
      error instanceof EvaluationReviewError && error.message.includes('received "candidate-wins"')
  );
});

test("a review attributed to an unknown reviewer is refused", () => {
  assert.throws(
    () =>
      new ReviewRecord({
        reviewer: "committee",
        dimensions: dimensions(),
        recommendation: "mixed",
        blinding: "partial",
      }),
    (error) =>
      error instanceof EvaluationReviewError && error.message.includes('received "committee"')
  );
});

test("a review that assessed no rubric dimension at all is refused", () => {
  assert.throws(
    () =>
      new ReviewRecord({
        reviewer: "model",
        dimensions: [],
        recommendation: "mixed",
        blinding: "partial",
      }),
    (error) =>
      error instanceof EvaluationReviewError &&
      error.message === "A review must assess at least one rubric dimension."
  );
});

test("a reviewed dimension carrying a name but no assessment is refused", () => {
  assert.throws(
    () =>
      new ReviewRecord({
        reviewer: "model",
        dimensions: [{ name: "correctness", evidence: "A/run-1/tests/test_invoice_total.py" }],
        recommendation: "mixed",
        blinding: "partial",
      }),
    (error) =>
      error instanceof EvaluationReviewError &&
      error.message.includes("needs a name and an assessment") &&
      error.message.includes("correctness")
  );
});

test("a review that assessed every rubric dimension covers the rubric", () => {
  const record = new ReviewRecord({
    reviewer: "model",
    dimensions: dimensions(),
    recommendation: "candidate-better",
    blinding: "partial",
  });

  assert.equal(record.coversRubric(RUBRIC), true);
});

test("a review that skipped one rubric dimension does not cover the rubric", () => {
  const record = new ReviewRecord({
    reviewer: "model",
    dimensions: dimensions(["correctness"]),
    recommendation: "candidate-better",
    blinding: "partial",
  });

  assert.equal(record.coversRubric(RUBRIC), false);
  assert.equal(record.coversRubric(["correctness"]), true);
});

test("a fenced json verdict block is read out of the surrounding prose", () => {
  const parsed = extractJsonBlock(verdictReply("candidate-better"));

  assert.equal(parsed.recommendation, "candidate-better");
  assert.equal(parsed.reasoning, "B covers the zero-line invoice; A does not.");
});

test("the last verdict block wins when the reviewer revised its answer", () => {
  const reply = [
    "My first reading:",
    "```json",
    JSON.stringify({ dimensions: dimensions(), recommendation: "reference-better" }),
    "```",
    "On a second pass over the evidence I changed my mind:",
    "```json",
    JSON.stringify({ dimensions: dimensions(), recommendation: "candidate-better" }),
    "```",
  ].join("\n");

  assert.equal(extractJsonBlock(reply).recommendation, "candidate-better");
});

test("a bare json object with no fence is accepted as the verdict", () => {
  const reply = JSON.stringify({ dimensions: dimensions(), recommendation: "equivalent" });

  assert.equal(extractJsonBlock(reply).recommendation, "equivalent");
});

test("prose carrying no json block at all yields no verdict", () => {
  assert.equal(extractJsonBlock("Both outputs look reasonable to me."), null);
});

test("a json block that names no recommendation yields no verdict", () => {
  const reply = ["```json", JSON.stringify({ dimensions: dimensions() }), "```"].join("\n");

  assert.equal(extractJsonBlock(reply), null);
});

test("when the candidate was shown as A, a verdict for A is recorded as candidate-better", () => {
  const assignment = assignLabels(CANDIDATE_FIRST_SEED);

  assert.equal(assignment.labelFor("candidate"), "A");
  assert.equal(relabelRecommendation("reference-better", assignment), "candidate-better");
  assert.equal(relabelRecommendation("candidate-better", assignment), "reference-better");
});

test("when the reference was shown as A, a verdict for A stays reference-better", () => {
  const assignment = assignLabels(REFERENCE_FIRST_SEED);

  assert.equal(assignment.labelFor("reference"), "A");
  assert.equal(relabelRecommendation("reference-better", assignment), "reference-better");
  assert.equal(relabelRecommendation("candidate-better", assignment), "candidate-better");
});

test("a verdict that picks neither side passes through the label mapping unchanged", () => {
  const assignment = assignLabels(CANDIDATE_FIRST_SEED);

  assert.equal(relabelRecommendation("mixed", assignment), "mixed");
  assert.equal(relabelRecommendation("equivalent", assignment), "equivalent");
  assert.equal(relabelRecommendation("inconclusive", assignment), "inconclusive");
});

test("a completed model review is recorded against the model that produced it and the bundle's blinding", async () => {
  const record = await reviewerFor({ lastMessage: verdictReply("candidate-better") }).review({
    bundle: reviewBundle(),
    arm: evaluationArm(),
  });

  assert.equal(record.reviewer, "model");
  assert.equal(record.recommendation, "candidate-better");
  assert.equal(record.blinding, "partial");
  assert.equal(record.unblinded, false);
  assert.equal(record.evaluationModel, "opus-5");
  assert.equal(record.evaluationModelFamily, "claude");
  assert.equal(record.uncertainty, "Neither output was run against the production data set.");
  assert.deepEqual(
    record.dimensions.map((dimension) => dimension.name),
    RUBRIC
  );
});

test("a model review whose run failed is refused and the failure reason is reported", async () => {
  const reviewer = reviewerFor({
    status: "failed",
    failureReason: "the CLI exited before finishing",
    lastMessage: verdictReply("candidate-better"),
  });

  await assert.rejects(
    () => reviewer.review({ bundle: reviewBundle(), arm: evaluationArm() }),
    (error) =>
      error instanceof EvaluationReviewError &&
      error.message ===
        "The evaluation model did not complete its review: the CLI exited before finishing."
  );
});

test("a model review that answers in prose alone is refused rather than guessed at", async () => {
  const reviewer = reviewerFor({ lastMessage: "B is a bit better, but it is a close call." });

  await assert.rejects(
    () => reviewer.review({ bundle: reviewBundle(), arm: evaluationArm() }),
    (error) =>
      error instanceof EvaluationReviewError &&
      error.message === "The evaluation model returned no parseable JSON verdict block."
  );
});

test("a user review taken under the bundle's blinding is recorded as the user's own verdict", () => {
  const record = recordUserReview({
    bundle: reviewBundle(),
    input: {
      dimensions: dimensions(),
      recommendation: "reference-better",
      reasoning: "A handles the zero-line invoice.",
    },
  });

  assert.equal(record.reviewer, "user");
  assert.equal(record.recommendation, "reference-better");
  assert.equal(record.blinding, "partial");
  assert.equal(record.unblinded, false);
});

test("a user review taken after the labels were revealed is recorded as unblinded", () => {
  const record = recordUserReview({
    bundle: reviewBundle(),
    input: {
      dimensions: dimensions(),
      recommendation: "reference-better",
      unblinded: true,
    },
  });

  assert.equal(record.blinding, "none");
  assert.equal(record.unblinded, true);
});

test("per-pair verdicts the user recorded are carried into the review record", () => {
  const pairVerdicts = [
    { runPair: "A/run-1 against B/run-1", winner: "A", note: "B omitted the zero-line invoice." },
    { runPair: "A/run-2 against B/run-2", winner: "B", note: "A duplicated the fixture setup." },
  ];

  const record = recordUserReview({
    bundle: reviewBundle(),
    input: { dimensions: dimensions(), recommendation: "mixed", pairVerdicts },
  });

  assert.deepEqual(record.pairVerdicts.map((entry) => ({ ...entry })), pairVerdicts);
});

test("reading a user review from a path that holds no file is refused by name", () => {
  const tempRoot = makeTempRoot();
  try {
    const missingPath = path.join(tempRoot, "user-review.json");

    assert.throws(
      () => readUserReviewFile(missingPath, reviewBundle()),
      (error) =>
        error instanceof EvaluationReviewError &&
        error.message === `No user review at ${missingPath}.`
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("reading a user review file that is not valid json is refused by name", () => {
  const tempRoot = makeTempRoot();
  try {
    const filePath = path.join(tempRoot, "user-review.json");
    fs.writeFileSync(filePath, "{ recommendation: reference-better", "utf8");

    assert.throws(
      () => readUserReviewFile(filePath, reviewBundle()),
      (error) =>
        error instanceof EvaluationReviewError &&
        error.message.startsWith(`${filePath} is not valid JSON:`)
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a user review read from a file is recorded with the roles reattached", () => {
  const tempRoot = makeTempRoot();
  try {
    const filePath = path.join(tempRoot, "user-review.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        dimensions: dimensions(),
        recommendation: "reference-better",
        reasoning: "The A output states the boundary cases explicitly.",
      }),
      "utf8"
    );

    const record = readUserReviewFile(filePath, reviewBundle({ seed: CANDIDATE_FIRST_SEED }));

    assert.equal(record.reviewer, "user");
    assert.equal(record.recommendation, "candidate-better");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
