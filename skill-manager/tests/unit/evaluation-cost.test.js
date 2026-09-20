const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { costRecordFor, runCost, estimateTokens } = require("../../electron/evaluation-cost");
const { GuidanceSet, Subject } = require("../../electron/evaluation-definition");
const { ActivationRecord } = require("../../electron/evaluation-activation");
const { ActivationSignal, RunRecord } = require("../../electron/evaluation-agent-runner");

const INSTRUCTION_TEXT = "# Repository Instructions\n\nRun the unit tests before committing.\n";
const INSTRUCTION_BYTES = 65;
const SKILL_TEXT = "---\nname: writing-clean-code\n---\n\nPrefer small modules.\n";
const SKILL_BYTES = 56;
const SKILL_NOTES_TEXT = "Keep each module under two hundred lines.\n";
const SKILL_DIRECTORY_BYTES = 98;
const DOCUMENT_TEXT = "# Code Design\n\nPrefer composition over inheritance.\n";
const DOCUMENT_BYTES = 52;
const CODEX_INSTRUCTION_BUDGET_BYTES = 32 * 1024;

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-cost-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function instructionSubject(sourceRoot) {
  return new Subject({
    kind: "instruction-file",
    name: "repository-instructions",
    sourcePath: writeFile(path.join(sourceRoot, "instructions.md"), INSTRUCTION_TEXT),
    fingerprint: "sha256:instructions",
  });
}

function skillSubject(sourceRoot, name = "writing-clean-code") {
  const skillPath = path.join(sourceRoot, name);
  writeFile(path.join(skillPath, "SKILL.md"), SKILL_TEXT);
  writeFile(path.join(skillPath, "reference", "notes.md"), SKILL_NOTES_TEXT);
  return new Subject({ kind: "skill", name, sourcePath: skillPath, fingerprint: "sha256:skill" });
}

function referencedDocumentSubject(sourceRoot) {
  return new Subject({
    kind: "referenced-document",
    name: "coding-quality",
    sourcePath: writeFile(path.join(sourceRoot, "coding-quality-v1.md"), DOCUMENT_TEXT),
    fingerprint: "sha256:document",
    pointerText: "## Code design guidance\n\nRead `coding-quality.md` first.\n",
    workspacePath: "coding-quality.md",
  });
}

function runWithSignal(subjectName, kind, state) {
  return new RunRecord({
    agent: "codex",
    role: "task",
    status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z",
    endedAt: "2026-09-20T10:04:00.000Z",
    durationMs: 240000,
    modelRequested: "luna",
    effortRequested: "high",
    effortReported: "high",
    activationSignals: [
      new ActivationSignal({
        subjectName,
        kind,
        state,
        evidence: "codex transcript",
      }),
    ],
  });
}

function costFor(record, name) {
  return record.subjects.find((subject) => subject.name === name);
}

test("costRecordFor reports each subject's bytes and estimated tokens, and totals them", () => {
  const tempRoot = makeTempRoot();
  try {
    const guidanceSet = new GuidanceSet([
      instructionSubject(tempRoot),
      skillSubject(tempRoot),
    ]);

    const record = costRecordFor({ guidanceSet });

    assert.equal(costFor(record, "repository-instructions").bytes, INSTRUCTION_BYTES);
    assert.equal(costFor(record, "repository-instructions").estimatedTokens, 17);
    assert.equal(costFor(record, "writing-clean-code").bytes, SKILL_DIRECTORY_BYTES);
    assert.equal(costFor(record, "writing-clean-code").estimatedTokens, 25);
    assert.equal(record.guidanceBytes, INSTRUCTION_BYTES + SKILL_DIRECTORY_BYTES);
    assert.equal(record.guidanceTokens, 17 + 25);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("estimateTokens rounds a partly filled token up to a whole one", () => {
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(64), 16);
  assert.equal(estimateTokens(65), 17);
});

test("an instruction-file subject is preloaded, carrying the delivered bytes and budget of the activation", () => {
  const tempRoot = makeTempRoot();
  try {
    const guidanceSet = new GuidanceSet([instructionSubject(tempRoot)]);
    const activationRecord = new ActivationRecord({
      agent: "codex",
      artifacts: ["AGENTS.md"],
      instructionFilename: "AGENTS.md",
      deliveredInstructionBytes: 40960,
      instructionBudgetBytes: CODEX_INSTRUCTION_BUDGET_BYTES,
      documentPaths: {},
      skillPaths: {},
    });

    const record = costRecordFor({ guidanceSet, activationRecord });

    assert.deepEqual(costFor(record, "repository-instructions").delivery, {
      mode: "preloaded",
      deliveredInstructionBytes: 40960,
      instructionBudgetBytes: CODEX_INSTRUCTION_BUDGET_BYTES,
      truncated: true,
    });
    assert.equal(record.deliveredInstructionBytes(), 40960);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a skill subject is trigger-gated and counts the runs whose transcript settled its activation", () => {
  const tempRoot = makeTempRoot();
  try {
    const guidanceSet = new GuidanceSet([skillSubject(tempRoot)]);
    const runRecords = [
      runWithSignal("writing-clean-code", "skill", "activated"),
      runWithSignal("writing-clean-code", "skill", "not-activated"),
      runWithSignal("writing-clean-code", "skill", "undetermined"),
    ];

    const record = costRecordFor({ guidanceSet, runRecords });

    assert.deepEqual(costFor(record, "writing-clean-code").delivery, {
      mode: "trigger-gated",
      deliveredInstructionBytes: 0,
      activatedRuns: 1,
      undeterminedRuns: 1,
      totalRuns: 3,
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a referenced-document subject is pointer-gated rather than preloaded", () => {
  const tempRoot = makeTempRoot();
  try {
    const guidanceSet = new GuidanceSet([referencedDocumentSubject(tempRoot)]);
    const runRecords = [runWithSignal("coding-quality", "referenced-document", "activated")];

    const record = costRecordFor({ guidanceSet, runRecords });

    assert.equal(costFor(record, "coding-quality").bytes, DOCUMENT_BYTES);
    assert.deepEqual(costFor(record, "coding-quality").delivery, {
      mode: "pointer-gated",
      deliveredInstructionBytes: 0,
      activatedRuns: 1,
      undeterminedRuns: 0,
      totalRuns: 1,
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a skill subject's bytes cover its whole directory, not only SKILL.md", () => {
  const tempRoot = makeTempRoot();
  try {
    const subject = skillSubject(tempRoot);
    const guidanceSet = new GuidanceSet([subject]);

    const record = costRecordFor({ guidanceSet });

    assert.equal(fs.statSync(path.join(subject.sourcePath, "SKILL.md")).size, SKILL_BYTES);
    assert.equal(costFor(record, "writing-clean-code").bytes, SKILL_DIRECTORY_BYTES);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a run whose CLI never confirmed the requested effort is not costed as having applied it", () => {
  const unconfirmed = new RunRecord({
    agent: "codex",
    role: "task",
    status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z",
    endedAt: "2026-09-20T10:04:00.000Z",
    durationMs: 240000,
    modelRequested: "luna",
    effortRequested: "high",
    effortReported: null,
    usage: { inputTokens: 1000, outputTokens: 500 },
  });

  const cost = runCost(unconfirmed);

  assert.equal(cost.effortRequested, "high");
  assert.equal(cost.effortReported, null);
  assert.equal(cost.effortConfirmed, false);
  assert.equal(cost.durationMs, 240000);
  assert.deepEqual(cost.usage, { inputTokens: 1000, outputTokens: 500 });
});
