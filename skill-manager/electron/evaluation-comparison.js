const fs = require("fs");
const path = require("path");

const { ArmConfiguration, armDifferences } = require("./evaluation-definition");

class EvaluationComparisonError extends Error {}

const BLINDING_LEVELS = ["full", "partial", "none"];
const ARM_LABELS = ["A", "B"];

// Execution factors cannot be fully blinded: transcript style, dependency
// choices and run manifests identify an engine to an experienced reader, and
// the app cannot scrub what is intrinsic to the output.
function blindingLevelFor(variedFactor) {
  return variedFactor === "guidance" ? "full" : "partial";
}

function fingerprintsOf(stored) {
  return {
    target: stored.targetFingerprint,
    scenario: stored.scenarioFingerprint,
    rubric: stored.rubricFingerprint,
    checks: stored.checksFingerprint,
  };
}

function assertSameGround(reference, candidate) {
  const left = fingerprintsOf(reference);
  const right = fingerprintsOf(candidate);
  const mismatched = Object.keys(left).filter((key) => left[key] !== right[key]);
  if (mismatched.length > 0) {
    throw new EvaluationComparisonError(
      `Arm results ${reference.id} and ${candidate.id} do not share the same ` +
        `${mismatched.join(", ")}; only arms run on identical ground can be compared.`
    );
  }
}

function assertOneFactor(reference, candidate) {
  const differences = armDifferences(
    ArmConfiguration.fromJSON(reference.armConfiguration),
    ArmConfiguration.fromJSON(candidate.armConfiguration)
  );
  if (differences.length === 0) {
    throw new EvaluationComparisonError(
      `Arm results ${reference.id} and ${candidate.id} have identical configurations; ` +
        "there is nothing to attribute a difference to."
    );
  }
  if (differences.length > 1) {
    throw new EvaluationComparisonError(
      `Arm results ${reference.id} and ${candidate.id} differ in ${differences.join(", ")}; ` +
        "a comparison must vary exactly one factor."
    );
  }
  return differences[0];
}

function driftBetween(reference, candidate, environment = {}) {
  const drift = [];
  if (reference.agentVersion && candidate.agentVersion) {
    const sameAgent = reference.armConfiguration.agent === candidate.armConfiguration.agent;
    if (sameAgent && reference.agentVersion !== candidate.agentVersion) {
      drift.push(
        `Agent version differs between arms: ${reference.agentVersion} against ${candidate.agentVersion}.`
      );
    }
  }
  for (const stored of [reference, candidate]) {
    const current = environment[stored.armConfiguration.agent];
    if (current && stored.agentVersion && current !== stored.agentVersion) {
      drift.push(
        `Arm ${stored.id} was recorded against ${stored.agentVersion} but ${current} is installed now.`
      );
    }
  }
  const ambientOf = (stored) => (stored.ambientGuidance ? stored.ambientGuidance.skillNames || [] : []);
  const referenceAmbient = ambientOf(reference).join(",");
  const candidateAmbient = ambientOf(candidate).join(",");
  if (referenceAmbient !== candidateAmbient) {
    drift.push(
      "Ambient skills differ between arms, so guidance outside this evaluation was not held constant."
    );
  }
  return drift;
}

function assertComparable(reference, candidate, { environment = {} } = {}) {
  assertSameGround(reference, candidate);
  const variedFactor = assertOneFactor(reference, candidate);
  return { variedFactor, drift: driftBetween(reference, candidate, environment) };
}

class ArmAssignment {
  constructor({ seed, labels }) {
    this.seed = seed;
    this.labels = Object.freeze({ ...labels });
    Object.freeze(this);
  }

  labelFor(role) {
    return this.labels[role];
  }

  roleFor(label) {
    return Object.keys(this.labels).find((role) => this.labels[role] === label) || null;
  }

  toJSON() {
    return { seed: this.seed, labels: { ...this.labels } };
  }
}

function assignLabels(seed) {
  const referenceFirst = seed % 2 === 0;
  return new ArmAssignment({
    seed,
    labels: {
      reference: referenceFirst ? ARM_LABELS[0] : ARM_LABELS[1],
      candidate: referenceFirst ? ARM_LABELS[1] : ARM_LABELS[0],
    },
  });
}

function redact(text, terms) {
  let result = text;
  for (const term of terms) {
    if (!term) {
      continue;
    }
    result = result.split(term).join("[redacted]");
  }
  return result;
}

function redactionTerms(reference, candidate) {
  const terms = new Set();
  for (const stored of [reference, candidate]) {
    terms.add(stored.armConfiguration.agent);
    terms.add(stored.armConfiguration.model);
    terms.add(stored.id);
    for (const subject of stored.armConfiguration.guidanceSet || []) {
      terms.add(subject.name);
      terms.add(subject.sourcePath);
    }
    for (const run of stored.runs || []) {
      if (run.workspacePath) {
        terms.add(run.workspacePath);
      }
      if (run.retained && run.retained.workspacePath) {
        terms.add(run.retained.workspacePath);
      }
    }
  }
  return [...terms].filter(Boolean).sort((left, right) => right.length - left.length);
}

function armEvidence(stored, terms) {
  return {
    sampleSize: stored.sampleSize,
    complete: stored.complete,
    runs: (stored.runs || []).map((run) => ({
      runIndex: run.runIndex,
      status: run.run.status,
      evidence: JSON.parse(redact(JSON.stringify(run.evidence || null), terms)),
      checks: JSON.parse(redact(JSON.stringify(run.checks || []), terms)),
      manifest: JSON.parse(redact(JSON.stringify(run.manifest || null), terms)),
    })),
  };
}

class ReviewBundle {
  constructor({ rootPath, assignment, blinding, variedFactor, rubric, scenarioPrompt }) {
    this.rootPath = rootPath;
    this.assignment = assignment;
    this.blinding = blinding;
    this.variedFactor = variedFactor;
    this.rubric = Object.freeze([...rubric]);
    this.scenarioPrompt = scenarioPrompt;
    Object.freeze(this);
  }

  armPath(label) {
    return path.join(this.rootPath, label);
  }

  toJSON() {
    return {
      rootPath: this.rootPath,
      assignment: this.assignment.toJSON(),
      blinding: this.blinding,
      variedFactor: this.variedFactor,
      rubric: [...this.rubric],
    };
  }
}

// The reviewer sees two unlabeled outputs, a rubric and the task. It never sees
// the subject, the agent, or which arm was expected to win.
function buildReviewBundle({
  reference,
  candidate,
  outputPath,
  variedFactor,
  rubric,
  scenarioPrompt,
  seed = Date.now(),
  fileSystem = fs,
}) {
  const assignment = assignLabels(seed);
  const blinding = blindingLevelFor(variedFactor);
  const terms = redactionTerms(reference, candidate);
  fileSystem.rmSync(outputPath, { recursive: true, force: true });
  fileSystem.mkdirSync(outputPath, { recursive: true });
  for (const [role, stored] of [
    ["reference", reference],
    ["candidate", candidate],
  ]) {
    const label = assignment.labelFor(role);
    const armPath = path.join(outputPath, label);
    fileSystem.mkdirSync(armPath, { recursive: true });
    fileSystem.writeFileSync(
      path.join(armPath, "evidence.json"),
      `${JSON.stringify(armEvidence(stored, terms), null, 2)}\n`,
      "utf8"
    );
    for (const run of stored.runs || []) {
      const retained = run.retained && run.retained.workspacePath;
      if (retained && fileSystem.existsSync(retained)) {
        fileSystem.cpSync(retained, path.join(armPath, `run-${run.runIndex}`), {
          recursive: true,
          dereference: true,
        });
      }
    }
  }
  fileSystem.writeFileSync(
    path.join(outputPath, "task.md"),
    `${scenarioPrompt}\n`,
    "utf8"
  );
  fileSystem.writeFileSync(
    path.join(outputPath, "rubric.json"),
    `${JSON.stringify({ dimensions: rubric }, null, 2)}\n`,
    "utf8"
  );
  // The assignment is deliberately NOT written into the bundle. A model
  // reviewer is given the bundle root as its workspace, so a sealed mapping
  // stored there would be a file it could simply read. It lives in the
  // comparison record instead.
  return new ReviewBundle({
    rootPath: outputPath,
    assignment,
    blinding,
    variedFactor,
    rubric,
    scenarioPrompt,
  });
}

module.exports = {
  EvaluationComparisonError,
  assertComparable,
  buildReviewBundle,
  blindingLevelFor,
  assignLabels,
  redactionTerms,
  ArmAssignment,
  ReviewBundle,
  BLINDING_LEVELS,
  ARM_LABELS,
};
