const test = require("node:test");
const assert = require("node:assert/strict");

const { fingerprintText } = require("../../electron/evaluation-fingerprint");
const {
  Subject,
  GuidanceSet,
  EvaluationDefinition,
  EvaluationDefinitionError,
  variedFactorBetween,
} = require("../../electron/evaluation-definition");
const { sampleArm, sampleDefinitionFields } = require("../helpers/sample-definitions");

function skillSubject(name, guidanceText) {
  return new Subject({
    kind: "skill",
    name,
    sourcePath: `skills/${name}/SKILL.md`,
    fingerprint: fingerprintText(guidanceText),
  });
}

const CODE_REVIEW_V1 = skillSubject("code-review", "Name the risk before the fix.\n");
const CODE_REVIEW_V2 = skillSubject("code-review", "Name the risk, then propose the fix.\n");
const TESTING_DISCIPLINE = skillSubject("testing-discipline", "Assert the contract.\n");

function messageIncludes(...fragments) {
  return (error) => {
    assert.ok(error instanceof EvaluationDefinitionError, `expected an EvaluationDefinitionError, got ${error}`);
    for (const fragment of fragments) {
      assert.ok(
        error.message.includes(fragment),
        `expected message to mention ${JSON.stringify(fragment)}, got ${JSON.stringify(error.message)}`
      );
    }
    return true;
  };
}

test("variedFactorBetween reports effort for arms that differ only in effort", () => {
  const reference = sampleArm({ agent: "codex", model: "luna", effort: "medium" });
  const candidate = sampleArm({ agent: "codex", model: "luna", effort: "high" });

  assert.equal(variedFactorBetween(reference, candidate), "effort");
});

test("variedFactorBetween reports agent when the other agent brings its own model", () => {
  const reference = sampleArm({ agent: "codex", model: "luna", effort: "medium" });
  const candidate = sampleArm({ agent: "claude", model: "opus-5", effort: "medium" });

  assert.equal(variedFactorBetween(reference, candidate), "agent");
});

test("variedFactorBetween reports guidance when one subject fingerprint differs", () => {
  const reference = sampleArm({ subjects: [CODE_REVIEW_V1, TESTING_DISCIPLINE] });
  const candidate = sampleArm({ subjects: [CODE_REVIEW_V2, TESTING_DISCIPLINE] });

  assert.equal(variedFactorBetween(reference, candidate), "guidance");
});

test("variedFactorBetween rejects arms that differ in model and effort", () => {
  const reference = sampleArm({ agent: "codex", model: "luna", effort: "medium" });
  const candidate = sampleArm({ agent: "codex", model: "luna-mini", effort: "high" });

  assert.throws(
    () => variedFactorBetween(reference, candidate),
    messageIncludes("model", "effort")
  );
});

test("variedFactorBetween rejects two identical arms", () => {
  const reference = sampleArm({ agent: "codex", model: "luna", effort: "medium" });
  const candidate = sampleArm({ agent: "codex", model: "luna", effort: "medium" });

  assert.throws(
    () => variedFactorBetween(reference, candidate),
    messageIncludes("codex/luna/medium")
  );
});

test("Subject of kind referenced-document rejects a missing pointerText", () => {
  assert.throws(
    () =>
      new Subject({
        kind: "referenced-document",
        name: "coding-quality.md",
        sourcePath: "docs/coding-quality.md",
        fingerprint: fingerprintText("Keep modules narrow.\n"),
        workspacePath: "coding-quality.md",
      }),
    messageIncludes("pointerText")
  );
});

test("Subject of kind referenced-document rejects a missing workspacePath", () => {
  assert.throws(
    () =>
      new Subject({
        kind: "referenced-document",
        name: "coding-quality.md",
        sourcePath: "docs/coding-quality.md",
        fingerprint: fingerprintText("Keep modules narrow.\n"),
        pointerText: "Read coding-quality.md before changing code.",
      }),
    messageIncludes("workspacePath")
  );
});

test("GuidanceSet rejects the same subject identity twice", () => {
  assert.throws(
    () => new GuidanceSet([CODE_REVIEW_V1, CODE_REVIEW_V2]),
    messageIncludes("skill:code-review")
  );
});

test("GuidanceSet fingerprint does not depend on the order the subjects were passed in", () => {
  const declaredOneWay = new GuidanceSet([CODE_REVIEW_V1, TESTING_DISCIPLINE]);
  const declaredTheOtherWay = new GuidanceSet([TESTING_DISCIPLINE, CODE_REVIEW_V1]);

  assert.equal(declaredTheOtherWay.fingerprint, declaredOneWay.fingerprint);
  assert.deepEqual(declaredTheOtherWay.names(), ["code-review", "testing-discipline"]);
});

test("EvaluationDefinition rejects a guidance difference mode when the varied factor is effort", () => {
  assert.throws(
    () =>
      new EvaluationDefinition(
        sampleDefinitionFields({
          referenceArm: sampleArm({ effort: "medium" }),
          candidateArm: sampleArm({ effort: "high" }),
          guidanceDifferenceMode: "prior-version",
        })
      ),
    messageIncludes("prior-version", "effort")
  );
});

test("EvaluationDefinition rejects prior-version mode when the arms hold different subjects", () => {
  assert.throws(
    () =>
      new EvaluationDefinition(
        sampleDefinitionFields({
          referenceArm: sampleArm({ subjects: [CODE_REVIEW_V1] }),
          candidateArm: sampleArm({ subjects: [TESTING_DISCIPLINE] }),
          guidanceDifferenceMode: "prior-version",
        })
      ),
    messageIncludes("prior-version", "skill:code-review", "skill:testing-discipline")
  );
});

test("EvaluationDefinition rejects absent mode when the reference arm already has guidance", () => {
  assert.throws(
    () =>
      new EvaluationDefinition(
        sampleDefinitionFields({
          referenceArm: sampleArm({ subjects: [CODE_REVIEW_V1] }),
          candidateArm: sampleArm({ subjects: [CODE_REVIEW_V1, TESTING_DISCIPLINE] }),
          guidanceDifferenceMode: "absent",
        })
      ),
    messageIncludes("absent", "code-review")
  );
});

test("EvaluationDefinition rejects reviewerRole model without an evaluation model", () => {
  assert.throws(
    () =>
      new EvaluationDefinition(
        sampleDefinitionFields({ reviewerRole: "model", evaluationModel: null })
      ),
    messageIncludes("model", "evaluation model")
  );
});

test("EvaluationDefinition accepts reviewerRole user without an evaluation model", () => {
  const definition = new EvaluationDefinition(
    sampleDefinitionFields({ reviewerRole: "user", evaluationModel: null })
  );

  assert.equal(definition.reviewerRole, "user");
  assert.equal(definition.evaluationModel, null);
});

test("EvaluationDefinition versionedId names the definition and its version", () => {
  const definition = new EvaluationDefinition(
    sampleDefinitionFields({ id: "code-review-effort", version: 3 })
  );

  assert.equal(definition.versionedId(), "code-review-effort-v3");
});

test("EvaluationDefinition round-trips through toJSON and fromJSON", () => {
  const definition = new EvaluationDefinition(
    sampleDefinitionFields({
      referenceArm: sampleArm({ effort: "medium", subjects: [CODE_REVIEW_V1] }),
      candidateArm: sampleArm({ effort: "high", subjects: [CODE_REVIEW_V1] }),
    })
  );

  const restored = EvaluationDefinition.fromJSON(definition.toJSON());

  assert.equal(restored.variedFactor, "effort");
  assert.equal(restored.referenceArm.describe(), "codex/luna/medium");
  assert.equal(restored.candidateArm.describe(), "codex/luna/high");
  assert.deepEqual(restored.referenceArm.guidanceSet.names(), ["code-review"]);
  assert.equal(restored.comparabilityKey(), definition.comparabilityKey());
  assert.deepEqual(restored.toJSON(), definition.toJSON());
});
