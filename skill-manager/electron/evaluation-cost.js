const fs = require("fs");

const { listFilesRecursively } = require("./evaluation-fingerprint");

// A rough characters-per-token ratio is enough to compare two guidance sets
// against each other; it is never presented as a billing figure.
const BYTES_PER_TOKEN_ESTIMATE = 4;

function estimateTokens(bytes) {
  return Math.ceil(bytes / BYTES_PER_TOKEN_ESTIMATE);
}

function sourceBytes(subject, fileSystem = fs) {
  if (subject.kind === "skill") {
    return listFilesRecursively(subject.sourcePath, fileSystem).reduce(
      (total, file) => total + fileSystem.statSync(file.absolutePath).size,
      0
    );
  }
  return fileSystem.statSync(subject.sourcePath).size;
}

class SubjectCost {
  constructor({ name, kind, fingerprint, bytes, estimatedTokens, delivery }) {
    this.name = name;
    this.kind = kind;
    this.fingerprint = fingerprint;
    this.bytes = bytes;
    this.estimatedTokens = estimatedTokens;
    this.delivery = Object.freeze({ ...delivery });
    Object.freeze(this);
  }

  toJSON() {
    return {
      name: this.name,
      kind: this.kind,
      fingerprint: this.fingerprint,
      bytes: this.bytes,
      estimatedTokens: this.estimatedTokens,
      delivery: { ...this.delivery },
    };
  }
}

class CostRecord {
  constructor({ subjects, runs }) {
    this.subjects = Object.freeze([...subjects]);
    this.runs = Object.freeze(runs.map((run) => Object.freeze({ ...run })));
    this.guidanceBytes = subjects.reduce((total, subject) => total + subject.bytes, 0);
    this.guidanceTokens = subjects.reduce((total, subject) => total + subject.estimatedTokens, 0);
    this.totalDurationMs = runs.reduce((total, run) => total + (run.durationMs || 0), 0);
    Object.freeze(this);
  }

  deliveredInstructionBytes() {
    return this.subjects.reduce(
      (total, subject) => total + (subject.delivery.deliveredInstructionBytes || 0),
      0
    );
  }

  toJSON() {
    return {
      guidanceBytes: this.guidanceBytes,
      guidanceTokens: this.guidanceTokens,
      deliveredInstructionBytes: this.deliveredInstructionBytes(),
      totalDurationMs: this.totalDurationMs,
      subjects: this.subjects.map((subject) => subject.toJSON()),
      runs: this.runs.map((run) => ({ ...run })),
    };
  }
}

function deliveryFor(subject, activationRecord, runRecords) {
  if (subject.kind === "instruction-file") {
    return {
      mode: "preloaded",
      deliveredInstructionBytes: activationRecord ? activationRecord.deliveredInstructionBytes : 0,
      instructionBudgetBytes: activationRecord ? activationRecord.instructionBudgetBytes : null,
      truncated: activationRecord ? activationRecord.truncated : false,
    };
  }
  const states = runRecords
    .map((record) => record.signalFor(subject.name))
    .filter(Boolean)
    .map((signal) => signal.state);
  const activatedCount = states.filter((state) => state === "activated").length;
  const undeterminedCount = states.filter((state) => state === "undetermined").length;
  return {
    mode: subject.kind === "skill" ? "trigger-gated" : "pointer-gated",
    deliveredInstructionBytes: 0,
    activatedRuns: activatedCount,
    undeterminedRuns: undeterminedCount,
    totalRuns: states.length,
  };
}

function runCost(runRecord) {
  return {
    role: runRecord.role,
    status: runRecord.status,
    durationMs: runRecord.durationMs,
    model: runRecord.modelReported || runRecord.modelRequested,
    effortRequested: runRecord.effortRequested,
    effortReported: runRecord.effortReported,
    effortConfirmed: runRecord.effortConfirmed(),
    usage: runRecord.usage,
  };
}

function costRecordFor({ guidanceSet, activationRecord = null, runRecords = [], fileSystem = fs }) {
  const subjects = guidanceSet.subjects.map((subject) => {
    const bytes = sourceBytes(subject, fileSystem);
    return new SubjectCost({
      name: subject.name,
      kind: subject.kind,
      fingerprint: subject.fingerprint,
      bytes,
      estimatedTokens: estimateTokens(bytes),
      delivery: deliveryFor(subject, activationRecord, runRecords),
    });
  });
  return new CostRecord({ subjects, runs: runRecords.map(runCost) });
}

module.exports = {
  costRecordFor,
  runCost,
  estimateTokens,
  CostRecord,
  SubjectCost,
  BYTES_PER_TOKEN_ESTIMATE,
};
