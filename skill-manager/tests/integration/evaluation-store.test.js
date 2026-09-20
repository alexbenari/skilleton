const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { fingerprintText } = require("../../electron/evaluation-fingerprint");
const {
  GuidanceSet,
  ArmConfiguration,
  EvaluationDefinition,
} = require("../../electron/evaluation-definition");
const { EvaluationStore, EvaluationStoreError } = require("../../electron/evaluation-store");

function createStoreRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-store-"));
}

function arm(effort) {
  return new ArmConfiguration({
    agent: "codex",
    model: "luna",
    effort,
    guidanceSet: new GuidanceSet([]),
  });
}

function sampleDefinition(overrides = {}) {
  return new EvaluationDefinition({
    id: "code-review-effort",
    referenceArm: arm("medium"),
    candidateArm: arm("high"),
    targetId: "sample-target",
    targetFingerprint: fingerprintText("The sample target content.\n"),
    scenarioId: "sample-scenario",
    scenarioFingerprint: fingerprintText("The sample scenario prompt.\n"),
    rubric: ["correctness", "structure"],
    checks: [{ id: "unit", kind: "validator", command: "manifest:test", timeoutSeconds: 300 }],
    checksFingerprint: fingerprintText("unit/manifest:test\n"),
    createdAt: "2026-04-07T09:00:00.000Z",
    notes: "First revision.",
    ...overrides,
  });
}

test("saveDefinition writes definitions/<id>/v1.json and loadDefinition returns an equal definition", () => {
  const storeRoot = createStoreRoot();
  try {
    const store = new EvaluationStore({ rootPath: storeRoot });
    const definition = sampleDefinition();

    const writtenPath = store.saveDefinition(definition);

    assert.equal(
      writtenPath,
      path.join(storeRoot, "definitions", "code-review-effort", "v1.json")
    );
    assert.equal(fs.existsSync(writtenPath), true);
    assert.deepEqual(store.loadDefinition("code-review-effort").toJSON(), definition.toJSON());
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("saveDefinition of version 2 leaves v1 untouched and loadDefinition defaults to the latest", () => {
  const storeRoot = createStoreRoot();
  try {
    const store = new EvaluationStore({ rootPath: storeRoot });
    const first = sampleDefinition();
    const second = first.withChanges({ notes: "Second revision." });
    store.saveDefinition(first);
    const firstFileContents = fs.readFileSync(
      path.join(storeRoot, "definitions", "code-review-effort", "v1.json"),
      "utf8"
    );

    store.saveDefinition(second);

    assert.equal(second.version, 2);
    assert.equal(
      fs.existsSync(path.join(storeRoot, "definitions", "code-review-effort", "v2.json")),
      true
    );
    assert.equal(
      fs.readFileSync(
        path.join(storeRoot, "definitions", "code-review-effort", "v1.json"),
        "utf8"
      ),
      firstFileContents
    );
    assert.equal(store.loadDefinition("code-review-effort").version, 2);
    assert.equal(store.loadDefinition("code-review-effort").notes, "Second revision.");
    assert.equal(store.loadDefinition("code-review-effort", 1).version, 1);
    assert.equal(store.loadDefinition("code-review-effort", 1).notes, "First revision.");
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("saveDefinition rejects a version that was already saved", () => {
  const storeRoot = createStoreRoot();
  try {
    const store = new EvaluationStore({ rootPath: storeRoot });
    store.saveDefinition(sampleDefinition());

    assert.throws(
      () => store.saveDefinition(sampleDefinition({ notes: "Rewritten history." })),
      (error) => {
        assert.ok(error instanceof EvaluationStoreError);
        assert.ok(
          error.message.includes("code-review-effort") && error.message.includes("version 1"),
          `unexpected message ${JSON.stringify(error.message)}`
        );
        return true;
      }
    );
    assert.equal(store.loadDefinition("code-review-effort").notes, "First revision.");
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("listDefinitions reports the id with both saved versions", () => {
  const storeRoot = createStoreRoot();
  try {
    const store = new EvaluationStore({ rootPath: storeRoot });
    const first = sampleDefinition();
    store.saveDefinition(first);
    store.saveDefinition(first.withChanges({ notes: "Second revision." }));

    assert.deepEqual(store.listDefinitions(), [
      { id: "code-review-effort", versions: [1, 2] },
    ]);
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("loadDefinition fails for an id that was never saved", () => {
  const storeRoot = createStoreRoot();
  try {
    const store = new EvaluationStore({ rootPath: storeRoot });

    assert.throws(
      () => store.loadDefinition("unknown-evaluation"),
      (error) => {
        assert.ok(error instanceof EvaluationStoreError);
        assert.ok(
          error.message.includes("unknown-evaluation"),
          `unexpected message ${JSON.stringify(error.message)}`
        );
        return true;
      }
    );
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
});
