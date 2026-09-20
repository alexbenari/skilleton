const { fingerprintValues } = require("./evaluation-fingerprint");

class EvaluationDefinitionError extends Error {}

const SUBJECT_KINDS = ["skill", "instruction-file", "referenced-document"];
const VARIED_FACTORS = ["guidance", "agent", "model", "effort"];
const GUIDANCE_DIFFERENCE_MODES = ["absent", "prior-version", "alternative-configuration"];
const REVIEWER_ROLES = ["user", "model", "both"];
const DECISION_FRAMINGS = ["improvement", "non-inferiority"];
const AGENTS = ["codex", "claude"];
const ARM_ROLES = ["reference", "candidate"];

function requireOneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new EvaluationDefinitionError(
      `${label} must be one of ${allowed.join(", ")}, received ${JSON.stringify(value)}.`
    );
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EvaluationDefinitionError(`${label} is required.`);
  }
  return value;
}

class Subject {
  constructor({ kind, name, sourcePath, fingerprint, pointerText = null, workspacePath = null }) {
    this.kind = requireOneOf(kind, SUBJECT_KINDS, "Subject kind");
    this.name = requireText(name, "Subject name");
    this.sourcePath = requireText(sourcePath, `Subject ${name} sourcePath`);
    this.fingerprint = requireText(fingerprint, `Subject ${name} fingerprint`);
    this.pointerText = pointerText;
    this.workspacePath = workspacePath;
    if (kind === "referenced-document") {
      requireText(pointerText, `Subject ${name} pointerText`);
      requireText(workspacePath, `Subject ${name} workspacePath`);
    }
    Object.freeze(this);
  }

  identity() {
    return `${this.kind}:${this.name}`;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      sourcePath: this.sourcePath,
      fingerprint: this.fingerprint,
      pointerText: this.pointerText,
      workspacePath: this.workspacePath,
    };
  }

  static fromJSON(raw) {
    return new Subject(raw);
  }
}

class GuidanceSet {
  constructor(subjects = []) {
    const ordered = [...subjects].sort((left, right) =>
      left.identity() < right.identity() ? -1 : 1
    );
    const identities = ordered.map((subject) => subject.identity());
    const duplicate = identities.find((value, index) => identities.indexOf(value) !== index);
    if (duplicate) {
      throw new EvaluationDefinitionError(
        `Guidance set contains ${duplicate} twice; each subject may appear once.`
      );
    }
    this.subjects = Object.freeze(ordered);
    this.fingerprint = fingerprintValues(
      ordered.flatMap((subject) => [subject.identity(), subject.fingerprint])
    );
    Object.freeze(this);
  }

  isEmpty() {
    return this.subjects.length === 0;
  }

  names() {
    return this.subjects.map((subject) => subject.name);
  }

  find(name) {
    return this.subjects.find((subject) => subject.name === name) || null;
  }

  ofKind(kind) {
    return this.subjects.filter((subject) => subject.kind === kind);
  }

  toJSON() {
    return this.subjects.map((subject) => subject.toJSON());
  }

  static fromJSON(raw = []) {
    return new GuidanceSet(raw.map(Subject.fromJSON));
  }
}

class ArmConfiguration {
  constructor({ agent, model, effort, guidanceSet }) {
    this.agent = requireOneOf(agent, AGENTS, "Arm agent");
    this.model = requireText(model, "Arm model");
    this.effort = requireText(effort, "Arm effort");
    if (!(guidanceSet instanceof GuidanceSet)) {
      throw new EvaluationDefinitionError("Arm guidanceSet must be a GuidanceSet.");
    }
    this.guidanceSet = guidanceSet;
    Object.freeze(this);
  }

  describe() {
    return `${this.agent}/${this.model}/${this.effort}`;
  }

  toJSON() {
    return {
      agent: this.agent,
      model: this.model,
      effort: this.effort,
      guidanceSet: this.guidanceSet.toJSON(),
    };
  }

  static fromJSON(raw) {
    return new ArmConfiguration({
      agent: raw.agent,
      model: raw.model,
      effort: raw.effort,
      guidanceSet: GuidanceSet.fromJSON(raw.guidanceSet),
    });
  }
}

// Models are agent-specific, so a changed agent carries a changed model with it
// and that pair still counts as the single factor "agent".
function executionDifferences(reference, candidate) {
  const differences = [];
  if (reference.agent !== candidate.agent) {
    differences.push("agent");
  } else if (reference.model !== candidate.model) {
    differences.push("model");
  }
  if (reference.effort !== candidate.effort) {
    differences.push("effort");
  }
  return differences;
}

function armDifferences(reference, candidate) {
  const differences = executionDifferences(reference, candidate);
  if (reference.guidanceSet.fingerprint !== candidate.guidanceSet.fingerprint) {
    differences.push("guidance");
  }
  return differences;
}

function variedFactorBetween(reference, candidate) {
  const differences = armDifferences(reference, candidate);
  if (differences.length === 0) {
    throw new EvaluationDefinitionError(
      `Both arms are the same configuration (${reference.describe()}) with the same guidance; ` +
        "an evaluation must vary exactly one factor."
    );
  }
  if (differences.length > 1) {
    throw new EvaluationDefinitionError(
      `Arms differ in more than one factor (${differences.join(", ")}); ` +
        "an evaluation must vary exactly one factor so its result can be attributed."
    );
  }
  return differences[0];
}

class EvaluationDefinition {
  constructor({
    id,
    version = 1,
    referenceArm,
    candidateArm,
    targetId,
    targetFingerprint,
    scenarioId,
    scenarioFingerprint,
    rubric,
    checks = [],
    checksFingerprint,
    evaluationModel = null,
    reviewerRole = "user",
    decisionFraming = "improvement",
    repetitionCount = 1,
    guidanceDifferenceMode = null,
    createdAt = new Date().toISOString(),
    notes = "",
  }) {
    this.id = requireText(id, "Evaluation definition id");
    if (!Number.isInteger(version) || version < 1) {
      throw new EvaluationDefinitionError("Evaluation definition version must be a positive integer.");
    }
    this.version = version;
    if (!(referenceArm instanceof ArmConfiguration) || !(candidateArm instanceof ArmConfiguration)) {
      throw new EvaluationDefinitionError("Both arms must be ArmConfiguration values.");
    }
    this.referenceArm = referenceArm;
    this.candidateArm = candidateArm;
    this.variedFactor = variedFactorBetween(referenceArm, candidateArm);
    this.guidanceDifferenceMode = this.resolveGuidanceDifferenceMode(guidanceDifferenceMode);
    this.targetId = requireText(targetId, "Evaluation target id");
    this.targetFingerprint = requireText(targetFingerprint, "Evaluation target fingerprint");
    this.scenarioId = requireText(scenarioId, "Evaluation scenario id");
    this.scenarioFingerprint = requireText(scenarioFingerprint, "Evaluation scenario fingerprint");
    this.rubric = Object.freeze([...rubric]);
    if (this.rubric.length === 0) {
      throw new EvaluationDefinitionError(
        "The rubric must name at least one review dimension, fixed before the runs start."
      );
    }
    this.checks = Object.freeze([...checks]);
    this.checksFingerprint = requireText(checksFingerprint, "Evaluation checks fingerprint");
    this.reviewerRole = requireOneOf(reviewerRole, REVIEWER_ROLES, "Reviewer role");
    this.decisionFraming = requireOneOf(decisionFraming, DECISION_FRAMINGS, "Decision framing");
    this.evaluationModel = evaluationModel;
    if (this.reviewerRole !== "user" && !evaluationModel) {
      throw new EvaluationDefinitionError(
        `Reviewer role ${this.reviewerRole} needs an evaluation model.`
      );
    }
    if (!Number.isInteger(repetitionCount) || repetitionCount < 1) {
      throw new EvaluationDefinitionError("Repetition count must be a positive integer.");
    }
    this.repetitionCount = repetitionCount;
    this.createdAt = createdAt;
    this.notes = notes;
    Object.freeze(this);
  }

  resolveGuidanceDifferenceMode(declared) {
    if (this.variedFactor !== "guidance") {
      if (declared) {
        throw new EvaluationDefinitionError(
          `Guidance difference mode ${declared} only applies when the varied factor is guidance, ` +
            `and this evaluation varies ${this.variedFactor}.`
        );
      }
      return null;
    }
    requireOneOf(declared, GUIDANCE_DIFFERENCE_MODES, "Guidance difference mode");
    this.assertGuidanceModeMatchesArms(declared);
    return declared;
  }

  assertGuidanceModeMatchesArms(mode) {
    const referenceSet = this.referenceArm.guidanceSet;
    const candidateSet = this.candidateArm.guidanceSet;
    if (mode === "absent" && !referenceSet.isEmpty()) {
      throw new EvaluationDefinitionError(
        `Guidance difference mode absent needs an empty reference guidance set, ` +
          `but it holds ${referenceSet.names().join(", ")}.`
      );
    }
    if (mode === "prior-version") {
      const referenceIdentities = referenceSet.subjects.map((subject) => subject.identity());
      const candidateIdentities = candidateSet.subjects.map((subject) => subject.identity());
      const sameMembers =
        referenceIdentities.length === candidateIdentities.length &&
        referenceIdentities.every((identity, index) => identity === candidateIdentities[index]);
      if (!sameMembers) {
        throw new EvaluationDefinitionError(
          "Guidance difference mode prior-version needs the same subjects in both arms, " +
            `but the reference holds ${referenceIdentities.join(", ") || "nothing"} and the ` +
            `candidate holds ${candidateIdentities.join(", ") || "nothing"}.`
        );
      }
    }
  }

  armFor(role) {
    requireOneOf(role, ARM_ROLES, "Arm role");
    return role === "reference" ? this.referenceArm : this.candidateArm;
  }

  comparabilityKey() {
    return fingerprintValues([
      this.targetFingerprint,
      this.scenarioFingerprint,
      fingerprintValues(this.rubric),
      this.checksFingerprint,
    ]);
  }

  withChanges(changes) {
    return new EvaluationDefinition({
      ...this.toJSON(),
      referenceArm: changes.referenceArm || this.referenceArm,
      candidateArm: changes.candidateArm || this.candidateArm,
      ...changes,
      version: this.version + 1,
      createdAt: new Date().toISOString(),
    });
  }

  toJSON() {
    return {
      id: this.id,
      version: this.version,
      variedFactor: this.variedFactor,
      guidanceDifferenceMode: this.guidanceDifferenceMode,
      referenceArm: this.referenceArm.toJSON(),
      candidateArm: this.candidateArm.toJSON(),
      targetId: this.targetId,
      targetFingerprint: this.targetFingerprint,
      scenarioId: this.scenarioId,
      scenarioFingerprint: this.scenarioFingerprint,
      rubric: [...this.rubric],
      checks: [...this.checks],
      checksFingerprint: this.checksFingerprint,
      evaluationModel: this.evaluationModel,
      reviewerRole: this.reviewerRole,
      decisionFraming: this.decisionFraming,
      repetitionCount: this.repetitionCount,
      comparabilityKey: this.comparabilityKey(),
      createdAt: this.createdAt,
      notes: this.notes,
    };
  }

  static fromJSON(raw) {
    return new EvaluationDefinition({
      ...raw,
      referenceArm: ArmConfiguration.fromJSON(raw.referenceArm),
      candidateArm: ArmConfiguration.fromJSON(raw.candidateArm),
    });
  }
}

module.exports = {
  EvaluationDefinitionError,
  Subject,
  GuidanceSet,
  ArmConfiguration,
  EvaluationDefinition,
  variedFactorBetween,
  armDifferences,
  SUBJECT_KINDS,
  VARIED_FACTORS,
  GUIDANCE_DIFFERENCE_MODES,
  REVIEWER_ROLES,
  DECISION_FRAMINGS,
  AGENTS,
  ARM_ROLES,
};
