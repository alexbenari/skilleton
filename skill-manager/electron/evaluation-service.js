const fs = require("fs");
const path = require("path");

const { ArmResult, ArmRun } = require("./evaluation-arm-result");
const { EvaluationDefinitionBuilder } = require("./evaluation-definition-builder");
const { SubjectActivation } = require("./evaluation-activation");
const { ArmAssignment, assertComparable, buildReviewBundle } = require("./evaluation-comparison");
const {
  assertNoAmbientCollision,
  detectContamination,
  scanAmbientGuidance,
} = require("./evaluation-ambient-guidance");
const { costRecordFor } = require("./evaluation-cost");
const { describeWorkspace, readRunManifest } = require("./evaluation-evidence");
const { fingerprintValues } = require("./evaluation-fingerprint");
const { listModelsByAgent } = require("./evaluation-models");
const { ModelReviewer, ReviewRecord, recordUserReview } = require("./evaluation-review");
const { writeReport } = require("./evaluation-report-writer");

class EvaluationServiceError extends Error {}

const ARM_ROLES = ["reference", "candidate"];

class EvaluationService {
  constructor({
    catalog,
    store,
    workspace,
    isolatedHome,
    runner,
    checkRunner,
    tempRootPath,
    fileSystem = fs,
    scanAmbient = scanAmbientGuidance,
  }) {
    this.catalog = catalog;
    this.store = store;
    this.workspace = workspace;
    this.isolatedHome = isolatedHome;
    this.runner = runner;
    this.checkRunner = checkRunner;
    this.tempRootPath = tempRootPath;
    this.fileSystem = fileSystem;
    this.scanAmbient = scanAmbient;
    this.builder = new EvaluationDefinitionBuilder({ catalog, fileSystem });
    this.cancellations = new Map();
  }

  listCatalog() {
    const agents = this.runner.supportedAgents();
    return {
      targets: this.catalog.listTargets().map((target) => target.toJSON()),
      scenarios: this.catalog.listScenarios().map((scenario) => scenario.toJSON()),
      subjects: this.catalog.listSubjectFiles(),
      definitions: this.store.listDefinitions(),
      agents,
      modelsByAgent: listModelsByAgent({ agents, fileSystem: this.fileSystem }),
    };
  }

  async availability() {
    return this.runner.availability();
  }

  proposePlan({ targetId, scenarioId }) {
    const target = this.catalog.getTarget(targetId);
    const scenario = this.catalog.getScenario(scenarioId);
    if (scenario.targetId !== target.id) {
      throw new EvaluationServiceError(
        `Scenario ${scenario.id} belongs to target ${scenario.targetId}, not ${target.id}.`
      );
    }
    return {
      targetId: target.id,
      scenarioId: scenario.id,
      targetShape: target.shape,
      pins: scenario.pins,
      requiresRunManifest: scenario.requiresRunManifest,
      rubric: [...scenario.reviewDimensions],
      reviewGuidance: scenario.reviewGuidance,
      checks: scenario.checks.map((check) => check.toJSON()),
      prompt: scenario.prompt,
    };
  }

  saveDefinition(request) {
    const existing = this.store.latestVersion(request.id);
    const definition = this.builder.build({
      ...request,
      version: existing === null ? 1 : existing + 1,
    });
    this.store.saveDefinition(definition);
    return definition;
  }

  ambientFor(agent) {
    return this.scanAmbient({ agent, fileSystem: this.fileSystem });
  }

  // The refusal has to happen before any run starts: an absent baseline against
  // a globally installed skill produces a report that looks entirely normal.
  assertRunnable(definition) {
    const agents = new Set(
      ARM_ROLES.map((role) => definition.armFor(role).agent)
    );
    const ambientByAgent = {};
    for (const agent of agents) {
      const ambient = this.ambientFor(agent);
      assertNoAmbientCollision(
        ARM_ROLES.map((role) => definition.armFor(role).guidanceSet),
        ambient
      );
      ambientByAgent[agent] = ambient;
    }
    return ambientByAgent;
  }

  homeFor(definition, role, agent) {
    return this.isolatedHome.create({
      agent,
      homePath: path.join(
        this.tempRootPath,
        "skill-manager-evaluation",
        definition.id,
        role,
        `home-${agent}`
      ),
    });
  }

  async runOnce({ definition, role, runIndex, target, scenario, home, agentVersion, onProgress, signal }) {
    const arm = definition.armFor(role);
    const prepared = this.workspace.prepare({
      evaluationId: `${definition.id}-v${definition.version}`,
      role,
      runIndex,
      target,
      scenario,
    });
    const activation = new SubjectActivation({
      agent: arm.agent,
      fileSystem: this.fileSystem,
    }).activate(prepared.workspacePath, arm.guidanceSet);
    prepared.recordActivation(activation.artifacts);
    this.emit(onProgress, { phase: "run-started", role, runIndex, agent: arm.agent });
    const runRecord = await this.runner.run({
      role: "task",
      arm,
      home,
      agentVersion,
      workspacePath: prepared.workspacePath,
      prompt: scenario.prompt,
      transcriptPath: prepared.transcriptPath,
      lastMessagePath: prepared.lastMessagePath,
      signal,
      onEvent: (event) => this.emit(onProgress, { phase: "run-event", role, runIndex, event }),
    });
    const manifest = readRunManifest(prepared.workspacePath, this.fileSystem);
    const evidence = describeWorkspace(prepared, target, this.fileSystem);
    const checkResults = await this.checkRunner.runAll(scenario.checks, {
      workspacePath: prepared.workspacePath,
      checksPath: target.checksPath,
      manifest,
    });
    this.emit(onProgress, {
      phase: "run-finished",
      role,
      runIndex,
      status: runRecord.status,
      checks: checkResults.map((result) => ({ id: result.checkId, status: result.status })),
    });
    const contamination = detectContamination({
      transcriptPath: prepared.transcriptPath,
      ownGuidanceSet: arm.guidanceSet,
      otherGuidanceSet: definition.armFor(role === "reference" ? "candidate" : "reference")
        .guidanceSet,
      fileSystem: this.fileSystem,
    });
    if (contamination.length > 0) {
      this.emit(onProgress, { phase: "contamination", role, runIndex, contamination });
    }
    return new ArmRun({
      runIndex,
      runRecord,
      evidence,
      checkResults,
      manifest,
      activationRecord: activation,
      workspacePath: prepared.workspacePath,
      artifactsPath: prepared.artifactsPath,
      contamination,
    });
  }

  async runArm({ definition, role, target, scenario, ambientByAgent, onProgress, signal }) {
    const arm = definition.armFor(role);
    const home = this.homeFor(definition, role, arm.agent);
    let agentVersion = null;
    try {
      agentVersion = await this.runner.version(arm.agent);
    } catch {
      agentVersion = null;
    }
    const runs = [];
    for (let runIndex = 1; runIndex <= definition.repetitionCount; runIndex += 1) {
      runs.push(
        await this.runOnce({
          definition,
          role,
          runIndex,
          target,
          scenario,
          home,
          agentVersion,
          onProgress,
          signal,
        })
      );
    }
    const armResult = new ArmResult({
      id: `${definition.id}-v${definition.version}-${role}-${Date.now()}`,
      definitionId: definition.id,
      definitionVersion: definition.version,
      role,
      armConfiguration: arm,
      targetId: definition.targetId,
      targetFingerprint: definition.targetFingerprint,
      scenarioId: definition.scenarioId,
      scenarioFingerprint: definition.scenarioFingerprint,
      rubricFingerprint: fingerprintValues(definition.rubric),
      checksFingerprint: definition.checksFingerprint,
      comparabilityKey: definition.comparabilityKey(),
      agentVersion,
      modelIdentifier: runs[0] ? runs[0].runRecord.modelReported : null,
      homeRecord: home,
      ambientGuidance: ambientByAgent[arm.agent] || null,
      runs,
      costRecord: costRecordFor({
        guidanceSet: arm.guidanceSet,
        activationRecord: runs[0] ? runs[0].activationRecord : null,
        runRecords: runs.map((run) => run.runRecord),
        fileSystem: this.fileSystem,
      }),
    });
    this.store.saveArmResult(armResult);
    return this.store.loadArmResult(armResult.id);
  }

  emit(onProgress, event) {
    if (onProgress) {
      onProgress(event);
    }
  }

  async startEvaluation(definitionId, { onProgress = null, version = null } = {}) {
    const definition = this.store.loadDefinition(definitionId, version);
    const target = this.catalog.getTarget(definition.targetId);
    const scenario = this.catalog.getScenario(definition.scenarioId);
    const ambientByAgent = this.assertRunnable(definition);
    const controller = new AbortController();
    this.cancellations.set(definitionId, controller);
    try {
      const arms = {};
      for (const role of ARM_ROLES) {
        this.emit(onProgress, { phase: "arm-started", role });
        arms[role] = await this.runArm({
          definition,
          role,
          target,
          scenario,
          ambientByAgent,
          onProgress,
          signal: controller.signal,
        });
      }
      const comparison = assertComparable(arms.reference, arms.candidate);
      const comparisonId = `${definition.id}-v${definition.version}-${Date.now()}`;
      const bundle = buildReviewBundle({
        reference: arms.reference,
        candidate: arms.candidate,
        outputPath: path.join(this.store.comparisonDirectory(comparisonId), "review-bundle"),
        variedFactor: comparison.variedFactor,
        rubric: definition.rubric,
        scenarioPrompt: scenario.prompt,
        fileSystem: this.fileSystem,
      });
      const record = {
        id: comparisonId,
        definitionId: definition.id,
        definitionVersion: definition.version,
        variedFactor: comparison.variedFactor,
        drift: comparison.drift,
        referenceArmId: arms.reference.id,
        candidateArmId: arms.candidate.id,
        bundle: bundle.toJSON(),
        reviews: [],
        createdAt: new Date().toISOString(),
      };
      this.store.saveComparison(record);
      this.emit(onProgress, { phase: "bundle-ready", comparisonId, bundlePath: bundle.rootPath });
      return { comparisonId, bundle, comparison, arms, definition };
    } finally {
      this.cancellations.delete(definitionId);
    }
  }

  bundleFor(comparisonRecord) {
    const stored = comparisonRecord.bundle;
    return {
      rootPath: stored.rootPath,
      blinding: stored.blinding,
      variedFactor: stored.variedFactor,
      rubric: stored.rubric,
      assignment: new ArmAssignment(stored.assignment),
    };
  }

  async addModelReview(comparisonId, { arm, home = null, timeoutMs = null }) {
    const record = this.store.loadComparison(comparisonId);
    const reviewer = new ModelReviewer({ runner: this.runner, fileSystem: this.fileSystem });
    const review = await reviewer.review({
      bundle: this.bundleFor(record),
      arm,
      home,
      timeoutMs,
      transcriptPath: path.join(this.store.comparisonDirectory(comparisonId), "review-transcript.jsonl"),
      lastMessagePath: path.join(this.store.comparisonDirectory(comparisonId), "review-last-message.txt"),
    });
    return this.attachReview(comparisonId, review);
  }

  addUserReview(comparisonId, input) {
    const record = this.store.loadComparison(comparisonId);
    const review = recordUserReview({ bundle: this.bundleFor(record), input });
    return this.attachReview(comparisonId, review);
  }

  // Reviews accumulate rather than replace: under the "both" reviewer role a
  // disagreement between the user and the model is itself the finding.
  attachReview(comparisonId, review) {
    const record = this.store.loadComparison(comparisonId);
    record.reviews = [...(record.reviews || []), review.toJSON()];
    this.fileSystem.rmSync(
      path.join(this.store.comparisonDirectory(comparisonId), "comparison.json"),
      { force: true }
    );
    this.store.saveComparison(record);
    return this.generateReport(comparisonId);
  }

  generateReport(comparisonId) {
    const record = this.store.loadComparison(comparisonId);
    if (!record.reviews || record.reviews.length === 0) {
      throw new EvaluationServiceError(
        `Comparison ${comparisonId} has no review yet, so there is nothing to conclude.`
      );
    }
    const definition = this.store.loadDefinition(record.definitionId, record.definitionVersion);
    const reference = this.store.loadArmResult(record.referenceArmId);
    const candidate = this.store.loadArmResult(record.candidateArmId);
    const outputPath = this.store.reportPath(comparisonId);
    writeReport({
      comparison: record,
      reference,
      candidate,
      reviews: record.reviews.map((review) => new ReviewRecord(review)),
      definitionLike: definition,
      scenarioId: definition.scenarioId,
      targetId: definition.targetId,
      ambientGuidance: reference.ambientGuidance,
      outputPath,
      fileSystem: this.fileSystem,
    });
    return { comparisonId, reportPath: outputPath };
  }

  cancel(definitionId) {
    const controller = this.cancellations.get(definitionId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }
}

module.exports = {
  EvaluationServiceError,
  EvaluationService,
  ARM_ROLES,
};
