const fs = require("fs");
const path = require("path");

class EvaluationReviewError extends Error {}

const RECOMMENDATIONS = [
  "reference-better",
  "candidate-better",
  "mixed",
  "equivalent",
  "inconclusive",
];
const REVIEWERS = ["user", "model"];

class ReviewRecord {
  constructor({
    reviewer,
    dimensions,
    recommendation,
    reasoning,
    uncertainty = "",
    blinding,
    unblinded = false,
    evaluationModel = null,
    evaluationModelFamily = null,
    pairVerdicts = [],
    createdAt = new Date().toISOString(),
  }) {
    if (!REVIEWERS.includes(reviewer)) {
      throw new EvaluationReviewError(
        `Reviewer must be one of ${REVIEWERS.join(", ")}, received ${JSON.stringify(reviewer)}.`
      );
    }
    if (!RECOMMENDATIONS.includes(recommendation)) {
      throw new EvaluationReviewError(
        `Recommendation must be one of ${RECOMMENDATIONS.join(", ")}, received ${JSON.stringify(recommendation)}.`
      );
    }
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      throw new EvaluationReviewError("A review must assess at least one rubric dimension.");
    }
    for (const dimension of dimensions) {
      if (!dimension.name || !dimension.assessment) {
        throw new EvaluationReviewError(
          `Every reviewed dimension needs a name and an assessment; received ${JSON.stringify(dimension)}.`
        );
      }
    }
    this.reviewer = reviewer;
    this.dimensions = Object.freeze(dimensions.map((entry) => Object.freeze({ ...entry })));
    this.recommendation = recommendation;
    this.reasoning = reasoning || "";
    this.uncertainty = uncertainty;
    this.blinding = blinding;
    this.unblinded = unblinded;
    this.evaluationModel = evaluationModel;
    this.evaluationModelFamily = evaluationModelFamily;
    this.pairVerdicts = Object.freeze(pairVerdicts.map((entry) => Object.freeze({ ...entry })));
    this.createdAt = createdAt;
    Object.freeze(this);
  }

  // Whether the rubric dimensions were all covered decides how much a verdict
  // is worth, so it is recorded rather than assumed.
  coversRubric(rubric) {
    const reviewed = new Set(this.dimensions.map((dimension) => dimension.name));
    return rubric.every((name) => reviewed.has(name));
  }

  toJSON() {
    return {
      reviewer: this.reviewer,
      dimensions: this.dimensions.map((entry) => ({ ...entry })),
      recommendation: this.recommendation,
      reasoning: this.reasoning,
      uncertainty: this.uncertainty,
      blinding: this.blinding,
      unblinded: this.unblinded,
      evaluationModel: this.evaluationModel,
      evaluationModelFamily: this.evaluationModelFamily,
      pairVerdicts: this.pairVerdicts.map((entry) => ({ ...entry })),
      createdAt: this.createdAt,
    };
  }
}

function extractJsonBlock(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  const candidates = [];
  let match = fenced.exec(text);
  while (match) {
    candidates.push(match[1]);
    match = fenced.exec(text);
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    candidates.push(trimmed);
  }
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object" && parsed.recommendation) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function reviewPrompt({ rubric, blinding, variedFactor }) {
  const dimensions = rubric.map((name) => `- ${name}`).join("\n");
  const blindingNote =
    blinding === "partial"
      ? "The two outputs may carry incidental signs of how they were produced. Judge the " +
        "work itself and ignore any such signs."
      : "You are not told which output came from which configuration, and you must not guess.";
  return [
    "You are reviewing two independent outputs for the same task, labelled A and B.",
    "Read task.md for the task, rubric.json for the dimensions, and each of A/ and B/ for",
    "that output's produced files and evidence.json.",
    "",
    blindingNote,
    "",
    "Assess every dimension below for both outputs:",
    dimensions,
    "",
    "Judge the work on its own merits. Do not reward an output for following any particular",
    "checklist or style guide; judge whether the result is correct, clear and well built.",
    "",
    "Reply with exactly one fenced json block and no other text:",
    "```json",
    "{",
    '  "dimensions": [{"name": "...", "assessment": "...", "evidence": "..."}],',
    `  "recommendation": "one of ${RECOMMENDATIONS.join(" | ")}",`,
    '  "reasoning": "...",',
    '  "uncertainty": "what you could not determine from the evidence"',
    "}",
    "```",
    "",
    `Use "reference-better" for A and "candidate-better" for B only after deciding which is`,
    "stronger; if the difference is smaller than the variation you can see between runs of",
    'the same output, answer "inconclusive" rather than "equivalent".',
    `The varied factor for this comparison is ${variedFactor}, but that tells you nothing`,
    "about which label holds which configuration.",
  ].join("\n");
}

// Labels are re-attached after the review returns, so the mapping from A/B to
// reference/candidate never reaches the reviewer.
function relabelRecommendation(recommendation, assignment) {
  if (recommendation === "reference-better" || recommendation === "candidate-better") {
    const label = recommendation === "reference-better" ? "A" : "B";
    const role = assignment.roleFor(label);
    return role === "reference" ? "reference-better" : "candidate-better";
  }
  return recommendation;
}

class ModelReviewer {
  constructor({ runner, fileSystem = fs } = {}) {
    if (!runner) {
      throw new EvaluationReviewError("ModelReviewer needs a runner.");
    }
    this.runner = runner;
    this.fileSystem = fileSystem;
  }

  async review({ bundle, arm, home = null, timeoutMs = null, transcriptPath = null }) {
    const record = await this.runner.run({
      role: "review",
      arm,
      home,
      workspacePath: bundle.rootPath,
      prompt: reviewPrompt({
        rubric: bundle.rubric,
        blinding: bundle.blinding,
        variedFactor: bundle.variedFactor,
      }),
      timeoutMs,
      transcriptPath,
    });
    if (record.status !== "completed") {
      throw new EvaluationReviewError(
        `The evaluation model did not complete its review: ${record.failureReason || record.status}.`
      );
    }
    const parsed = extractJsonBlock(record.lastMessage);
    if (!parsed) {
      throw new EvaluationReviewError(
        "The evaluation model returned no parseable JSON verdict block."
      );
    }
    return new ReviewRecord({
      reviewer: "model",
      dimensions: parsed.dimensions || [],
      recommendation: relabelRecommendation(parsed.recommendation, bundle.assignment),
      reasoning: parsed.reasoning,
      uncertainty: parsed.uncertainty || "",
      blinding: bundle.blinding,
      evaluationModel: arm.model,
      evaluationModelFamily: arm.agent,
    });
  }
}

function recordUserReview({ bundle, input }) {
  return new ReviewRecord({
    reviewer: "user",
    dimensions: input.dimensions || [],
    recommendation: relabelRecommendation(input.recommendation, bundle.assignment),
    reasoning: input.reasoning,
    uncertainty: input.uncertainty || "",
    blinding: input.unblinded ? "none" : bundle.blinding,
    unblinded: Boolean(input.unblinded),
    pairVerdicts: input.pairVerdicts || [],
  });
}

function readUserReviewFile(filePath, bundle, fileSystem = fs) {
  if (!fileSystem.existsSync(filePath)) {
    throw new EvaluationReviewError(`No user review at ${filePath}.`);
  }
  let input;
  try {
    input = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new EvaluationReviewError(`${filePath} is not valid JSON: ${error.message}`);
  }
  return recordUserReview({ bundle, input });
}

module.exports = {
  EvaluationReviewError,
  ReviewRecord,
  ModelReviewer,
  recordUserReview,
  readUserReviewFile,
  reviewPrompt,
  extractJsonBlock,
  relabelRecommendation,
  RECOMMENDATIONS,
  REVIEWERS,
};
