const fs = require("fs");
const path = require("path");

class EvaluationReportError extends Error {}

const ARM_NAMES = {
  guidance: { reference: "Baseline", candidate: "Guided" },
  default: { reference: "Reference", candidate: "Candidate" },
};

function armNames(variedFactor) {
  return ARM_NAMES[variedFactor] || ARM_NAMES.default;
}

function describeRecommendation(recommendation, names) {
  switch (recommendation) {
    case "reference-better":
      return `${names.reference} better`;
    case "candidate-better":
      return `${names.candidate} better`;
    case "mixed":
      return "Mixed";
    case "equivalent":
      return "Equivalent within the available evidence";
    default:
      return "Inconclusive";
  }
}

// "Inconclusive" and "equivalent" are different answers, and under a
// non-inferiority framing the difference is the whole decision.
function conclusionCaveat(review, definitionLike) {
  if (review.recommendation !== "inconclusive") {
    return null;
  }
  return definitionLike.decisionFraming === "non-inferiority"
    ? "This is not a finding of equivalence. A non-inferiority question that comes back " +
        "inconclusive has failed to show safety, and reading it as permission to switch is " +
        "the error the framing exists to prevent."
    : "This is not a finding of equivalence. It means the sample was too small to tell.";
}

function bullets(lines) {
  return lines.length === 0 ? "- none\n" : `${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

function formatArmConfiguration(stored) {
  const configuration = stored.armConfiguration;
  const subjects = (configuration.guidanceSet || []).map(
    (subject) => `${subject.name} (${subject.kind}, ${subject.fingerprint})`
  );
  return [
    `Agent: ${configuration.agent}${stored.agentVersion ? ` ${stored.agentVersion}` : ""}`,
    `Model requested: ${configuration.model}`,
    `Reasoning effort requested: ${configuration.effort}`,
    `Guidance in force: ${subjects.length === 0 ? "none" : subjects.join("; ")}`,
    `Sample size: ${stored.sampleSize} run${stored.sampleSize === 1 ? "" : "s"}`,
  ];
}

function formatRunLines(stored) {
  return (stored.runs || []).map((run) => {
    const record = run.run;
    const effort = record.effortConfirmed
      ? `${record.effortReported} (confirmed)`
      : `${record.effortRequested} (as requested, unconfirmed)`;
    const checks = (run.checks || [])
      .map((check) => `${check.checkId}=${check.status}`)
      .join(", ");
    return (
      `Run ${run.runIndex}: ${record.status}, model ${record.modelReported || record.modelRequested}, ` +
      `effort ${effort}, ${record.durationMs}ms${checks ? `, checks: ${checks}` : ", no checks"}`
    );
  });
}

function formatActivation(stored) {
  return Object.entries(stored.activation || {}).map(([name, summary]) => {
    if (summary.state === "always-in-context") {
      return `${name}: always in context (${summary.kind})`;
    }
    return (
      `${name} (${summary.kind}): activated in ${summary.activated}/${summary.totalRuns}, ` +
      `not activated in ${summary.notActivated}, undetermined in ${summary.undetermined}`
    );
  });
}

function formatCost(stored) {
  const cost = stored.cost;
  if (!cost) {
    return ["no cost record"];
  }
  return [
    `Guidance source: ${cost.guidanceBytes} bytes, about ${cost.guidanceTokens} tokens`,
    `Delivered instruction bytes: ${cost.deliveredInstructionBytes}`,
    `Total run time: ${cost.totalDurationMs}ms`,
  ];
}

function costComparisonLine(reference, candidate) {
  const left = reference.cost;
  const right = candidate.cost;
  if (!left || !right) {
    return null;
  }
  const delta = right.guidanceTokens - left.guidanceTokens;
  if (delta === 0) {
    return "Guidance cost is identical in both arms.";
  }
  const direction = delta < 0 ? "fewer" : "more";
  const percent = left.guidanceTokens === 0 ? null : Math.round((Math.abs(delta) / left.guidanceTokens) * 100);
  return (
    `The candidate's guidance is about ${Math.abs(delta)} ${direction} tokens` +
    `${percent === null ? "" : ` (${percent}%)`} than the reference's.`
  );
}

function formatReview(review, names) {
  const lines = [
    `Reviewer: ${review.reviewer}${review.evaluationModel ? ` (${review.evaluationModel})` : ""}`,
    `Blinding: ${review.blinding}${review.unblinded ? ", unblinded by the reviewer" : ""}`,
    `Recommendation: ${describeRecommendation(review.recommendation, names)}`,
  ];
  if (review.evaluationModelFamily) {
    lines.push(`Evaluation model family: ${review.evaluationModelFamily}`);
  }
  return lines;
}

function writeReport({
  comparison,
  reference,
  candidate,
  reviews,
  definitionLike,
  scenarioId,
  targetId,
  ambientGuidance = null,
  outputPath,
  fileSystem = fs,
}) {
  if (!reviews || reviews.length === 0) {
    throw new EvaluationReportError("A report needs at least one review.");
  }
  const names = armNames(comparison.variedFactor);
  const sections = [];

  sections.push(`# Evaluation report: ${definitionLike.id || "comparison"}\n`);
  sections.push(
    `Varied factor: **${comparison.variedFactor}**` +
      `${definitionLike.guidanceDifferenceMode ? ` (${definitionLike.guidanceDifferenceMode})` : ""}\n`
  );
  sections.push(
    `Decision framing: **${definitionLike.decisionFraming || "improvement"}**  \n` +
      `Target: ${targetId}  \n` +
      `Scenario: ${scenarioId}\n`
  );

  sections.push("## Conclusion\n");
  for (const review of reviews) {
    const caveat = conclusionCaveat(review, definitionLike);
    sections.push(
      `**${review.reviewer} review:** ${describeRecommendation(review.recommendation, names)}, ` +
        `from ${reference.sampleSize} ${names.reference.toLowerCase()} ` +
        `run${reference.sampleSize === 1 ? "" : "s"} and ` +
        `${candidate.sampleSize} ${names.candidate.toLowerCase()} ` +
        `run${candidate.sampleSize === 1 ? "" : "s"}.\n`
    );
    if (caveat) {
      sections.push(`> ${caveat}\n`);
    }
    if (review.reasoning) {
      sections.push(`${review.reasoning}\n`);
    }
  }
  if (reviews.length > 1) {
    const distinct = new Set(reviews.map((review) => review.recommendation));
    if (distinct.size > 1) {
      sections.push(
        "> The reviews disagree. That is a finding about the automated reviewer, not a tie, " +
          "and both verdicts are recorded separately below.\n"
      );
    }
  }
  if (definitionLike.decisionFraming === "non-inferiority") {
    const costLine = costComparisonLine(reference, candidate);
    if (costLine) {
      sections.push(`Cost difference behind this verdict: ${costLine}\n`);
    }
  }

  sections.push(`## ${names.reference} arm\n`);
  sections.push(bullets(formatArmConfiguration(reference)));
  sections.push(bullets(formatRunLines(reference)));

  sections.push(`## ${names.candidate} arm\n`);
  sections.push(bullets(formatArmConfiguration(candidate)));
  sections.push(bullets(formatRunLines(candidate)));

  sections.push("## Activation\n");
  sections.push(`### ${names.reference}\n`);
  sections.push(bullets(formatActivation(reference)));
  sections.push(`### ${names.candidate}\n`);
  sections.push(bullets(formatActivation(candidate)));

  sections.push("## Cost\n");
  sections.push(`### ${names.reference}\n`);
  sections.push(bullets(formatCost(reference)));
  sections.push(`### ${names.candidate}\n`);
  sections.push(bullets(formatCost(candidate)));

  sections.push("## Run context\n");
  sections.push(
    bullets([
      `${names.reference} isolation: ${reference.isolation ? reference.isolation.detail : "unrecorded"}`,
      `${names.candidate} isolation: ${candidate.isolation ? candidate.isolation.detail : "unrecorded"}`,
    ])
  );
  if (ambientGuidance) {
    sections.push(
      `Ambient guidance reaching both arms regardless of isolation ` +
        `(${ambientGuidance.skillCount} skills from ` +
        `${ambientGuidance.roots.filter((root) => root.present).map((root) => root.path).join(", ")}):\n`
    );
    sections.push(bullets(ambientGuidance.skillNames));
  }

  sections.push("## Review detail\n");
  for (const review of reviews) {
    sections.push(bullets(formatReview(review, names)));
    sections.push(
      bullets(
        review.dimensions.map(
          (dimension) =>
            `**${dimension.name}**: ${dimension.assessment}${dimension.evidence ? ` (${dimension.evidence})` : ""}`
        )
      )
    );
    if (review.uncertainty) {
      sections.push(`Uncertainty: ${review.uncertainty}\n`);
    }
    if (!review.coversRubric(definitionLike.rubric || [])) {
      sections.push(
        "> This review did not cover every rubric dimension, so the verdict rests on a subset.\n"
      );
    }
  }

  sections.push("## Scope of evidence\n");
  const scope = [
    `This comparison covers scenario ${scenarioId} only.`,
    `Blinding: ${reviews.map((review) => `${review.reviewer}=${review.blinding}`).join(", ")}.`,
  ];
  for (const note of comparison.drift || []) {
    scope.push(`Drift: ${note}`);
  }
  sections.push(bullets(scope));

  const contents = `${sections.join("\n")}`;
  fileSystem.mkdirSync(path.dirname(outputPath), { recursive: true });
  fileSystem.writeFileSync(outputPath, contents, "utf8");
  return outputPath;
}

module.exports = {
  EvaluationReportError,
  writeReport,
  describeRecommendation,
  conclusionCaveat,
  armNames,
  costComparisonLine,
};
