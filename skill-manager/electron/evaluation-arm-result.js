class ArmResultError extends Error {}

class ArmRun {
  constructor({
    runIndex,
    runRecord,
    evidence,
    checkResults = [],
    manifest = null,
    activationRecord = null,
    workspacePath = null,
    artifactsPath = null,
    contamination = [],
  }) {
    this.runIndex = runIndex;
    this.runRecord = runRecord;
    this.evidence = evidence;
    this.checkResults = Object.freeze([...checkResults]);
    this.manifest = manifest;
    this.activationRecord = activationRecord;
    this.workspacePath = workspacePath;
    this.artifactsPath = artifactsPath;
    this.contamination = Object.freeze(contamination.map((entry) => Object.freeze({ ...entry })));
    Object.freeze(this);
  }

  succeeded() {
    return this.runRecord.status === "completed";
  }

  checksPassed() {
    return this.checkResults.every((result) => result.status === "pass");
  }

  toJSON() {
    return {
      runIndex: this.runIndex,
      run: this.runRecord.toJSON(),
      evidence: this.evidence ? this.evidence.toJSON() : null,
      checks: this.checkResults.map((result) => result.toJSON()),
      manifest: this.manifest ? this.manifest.toJSON() : null,
      activation: this.activationRecord ? this.activationRecord.toJSON() : null,
      workspacePath: this.workspacePath,
      artifactsPath: this.artifactsPath,
      contamination: this.contamination.map((entry) => ({ ...entry })),
    };
  }
}

class ArmResult {
  constructor({
    id,
    definitionId,
    definitionVersion,
    role,
    armConfiguration,
    targetId,
    targetFingerprint,
    scenarioId,
    scenarioFingerprint,
    rubricFingerprint,
    checksFingerprint,
    comparabilityKey,
    agentVersion = null,
    modelIdentifier = null,
    homeRecord = null,
    ambientGuidance = null,
    runs = [],
    costRecord = null,
    createdAt = new Date().toISOString(),
  }) {
    if (!id) {
      throw new ArmResultError("An arm result needs an id.");
    }
    if (runs.length === 0) {
      throw new ArmResultError(`Arm result ${id} has no runs; an arm must record at least one.`);
    }
    this.id = id;
    this.definitionId = definitionId;
    this.definitionVersion = definitionVersion;
    this.role = role;
    this.armConfiguration = armConfiguration;
    this.targetId = targetId;
    this.targetFingerprint = targetFingerprint;
    this.scenarioId = scenarioId;
    this.scenarioFingerprint = scenarioFingerprint;
    this.rubricFingerprint = rubricFingerprint;
    this.checksFingerprint = checksFingerprint;
    this.comparabilityKey = comparabilityKey;
    this.agentVersion = agentVersion;
    this.modelIdentifier = modelIdentifier;
    this.homeRecord = homeRecord;
    this.ambientGuidance = ambientGuidance;
    this.runs = Object.freeze([...runs]);
    this.costRecord = costRecord;
    this.createdAt = createdAt;
    Object.freeze(this);
  }

  sampleSize() {
    return this.runs.length;
  }

  completedRuns() {
    return this.runs.filter((run) => run.succeeded());
  }

  isComplete() {
    return this.completedRuns().length === this.runs.length;
  }

  // Isolation is the claim that both arms saw the same context apart from the
  // varied factor, so a run that inherited the user's home must stay visible.
  isolationSummary() {
    if (!this.homeRecord) {
      return { isolated: false, detail: "No agent home was recorded for this arm." };
    }
    return {
      isolated: this.homeRecord.isolation === "isolated",
      detail:
        this.homeRecord.isolation === "isolated"
          ? `Isolated ${this.armConfiguration.agent} home at ${this.homeRecord.homePath}.`
          : `Inherited the user's ${this.armConfiguration.agent} home at ${this.homeRecord.inheritedFrom}.`,
    };
  }

  activationSummary() {
    const summary = {};
    for (const subject of this.armConfiguration.guidanceSet.subjects) {
      if (subject.kind === "instruction-file") {
        summary[subject.name] = { kind: subject.kind, state: "always-in-context" };
        continue;
      }
      const states = this.runs
        .map((run) => run.runRecord.signalFor(subject.name))
        .filter(Boolean)
        .map((signal) => signal.state);
      summary[subject.name] = {
        kind: subject.kind,
        activated: states.filter((state) => state === "activated").length,
        notActivated: states.filter((state) => state === "not-activated").length,
        undetermined: states.filter((state) => state === "undetermined").length,
        totalRuns: states.length,
      };
    }
    return summary;
  }

  toJSON() {
    return {
      id: this.id,
      definitionId: this.definitionId,
      definitionVersion: this.definitionVersion,
      role: this.role,
      armConfiguration: this.armConfiguration.toJSON(),
      targetId: this.targetId,
      targetFingerprint: this.targetFingerprint,
      scenarioId: this.scenarioId,
      scenarioFingerprint: this.scenarioFingerprint,
      rubricFingerprint: this.rubricFingerprint,
      checksFingerprint: this.checksFingerprint,
      comparabilityKey: this.comparabilityKey,
      agentVersion: this.agentVersion,
      modelIdentifier: this.modelIdentifier,
      home: this.homeRecord ? this.homeRecord.toJSON() : null,
      ambientGuidance: this.ambientGuidance ? this.ambientGuidance.toJSON() : null,
      isolation: this.isolationSummary(),
      activation: this.activationSummary(),
      sampleSize: this.sampleSize(),
      complete: this.isComplete(),
      cost: this.costRecord ? this.costRecord.toJSON() : null,
      runs: this.runs.map((run) => run.toJSON()),
      createdAt: this.createdAt,
    };
  }
}

module.exports = {
  ArmResultError,
  ArmResult,
  ArmRun,
};
