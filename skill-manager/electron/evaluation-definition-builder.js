const fs = require("fs");
const path = require("path");

const {
  ArmConfiguration,
  EvaluationDefinition,
  GuidanceSet,
  Subject,
} = require("./evaluation-definition");
const { fingerprintDirectory, fingerprintFile } = require("./evaluation-fingerprint");

class EvaluationDefinitionBuilderError extends Error {}

class EvaluationDefinitionBuilder {
  constructor({ catalog, fileSystem = fs } = {}) {
    if (!catalog) {
      throw new EvaluationDefinitionBuilderError("catalog is required.");
    }
    this.catalog = catalog;
    this.fileSystem = fileSystem;
  }

  resolvePath(candidatePath, label) {
    if (!candidatePath) {
      throw new EvaluationDefinitionBuilderError(`${label} is required.`);
    }
    const resolved = path.isAbsolute(candidatePath)
      ? candidatePath
      : path.join(this.catalog.rootPath, candidatePath);
    if (!this.fileSystem.existsSync(resolved)) {
      throw new EvaluationDefinitionBuilderError(`${label} does not exist at ${resolved}.`);
    }
    return resolved;
  }

  fingerprintSource(sourcePath, kind, name) {
    const isDirectory = this.fileSystem.statSync(sourcePath).isDirectory();
    if (kind === "skill") {
      if (!isDirectory) {
        throw new EvaluationDefinitionBuilderError(
          `Skill subject ${name} must point at a directory, received ${sourcePath}.`
        );
      }
      return fingerprintDirectory(sourcePath, this.fileSystem);
    }
    if (isDirectory) {
      throw new EvaluationDefinitionBuilderError(
        `Subject ${name} of kind ${kind} must point at a file, received ${sourcePath}.`
      );
    }
    return fingerprintFile(sourcePath, this.fileSystem);
  }

  buildSubject(request) {
    const name = request.name;
    const sourcePath = this.resolvePath(request.sourcePath, `Subject ${name} sourcePath`);
    const pointerText = this.readPointerText(request, name);
    return new Subject({
      kind: request.kind,
      name,
      sourcePath,
      fingerprint: this.fingerprintSource(sourcePath, request.kind, name),
      pointerText,
      workspacePath: request.workspacePath || null,
    });
  }

  readPointerText(request, name) {
    if (request.kind !== "referenced-document") {
      return null;
    }
    if (request.pointerText) {
      return request.pointerText;
    }
    const pointerPath = this.resolvePath(request.pointerFile, `Subject ${name} pointerFile`);
    return this.fileSystem.readFileSync(pointerPath, "utf8");
  }

  buildArm(request, role) {
    if (!request) {
      throw new EvaluationDefinitionBuilderError(`${role} arm is required.`);
    }
    const subjects = (request.guidance || []).map((subject) => this.buildSubject(subject));
    return new ArmConfiguration({
      agent: request.agent,
      model: request.model,
      effort: request.effort,
      guidanceSet: new GuidanceSet(subjects),
    });
  }

  build(request) {
    const target = this.catalog.getTarget(request.targetId);
    const scenario = this.catalog.getScenario(request.scenarioId);
    if (scenario.targetId !== target.id) {
      throw new EvaluationDefinitionBuilderError(
        `Scenario ${scenario.id} belongs to target ${scenario.targetId}, not ${target.id}.`
      );
    }
    return new EvaluationDefinition({
      id: request.id,
      version: request.version || 1,
      referenceArm: this.buildArm(request.referenceArm, "reference"),
      candidateArm: this.buildArm(request.candidateArm, "candidate"),
      targetId: target.id,
      targetFingerprint: target.fingerprint,
      scenarioId: scenario.id,
      scenarioFingerprint: scenario.fingerprint,
      rubric: request.rubric || scenario.reviewDimensions,
      checks: scenario.checks.map((check) => check.toJSON()),
      checksFingerprint: scenario.checksFingerprint,
      evaluationModel: request.evaluationModel || null,
      reviewerRole: request.reviewerRole || "user",
      decisionFraming: request.decisionFraming || "improvement",
      repetitionCount: request.repetitionCount || 1,
      guidanceDifferenceMode: request.guidanceDifferenceMode || null,
      notes: request.notes || "",
    });
  }
}

module.exports = {
  EvaluationDefinitionBuilderError,
  EvaluationDefinitionBuilder,
};
