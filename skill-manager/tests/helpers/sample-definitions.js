const { fingerprintText } = require("../../electron/evaluation-fingerprint");
const {
  ArmConfiguration,
  EvaluationDefinition,
  GuidanceSet,
} = require("../../electron/evaluation-definition");

function sampleArm({ agent = "codex", model = "luna", effort = "medium", subjects = [] } = {}) {
  return new ArmConfiguration({
    agent,
    model,
    effort,
    guidanceSet: new GuidanceSet(subjects),
  });
}

function sampleDefinitionFields(overrides = {}) {
  return {
    id: "code-review-effort",
    referenceArm: sampleArm({ effort: "medium" }),
    candidateArm: sampleArm({ effort: "high" }),
    targetId: "sample-target",
    targetFingerprint: fingerprintText("The sample target content.\n"),
    scenarioId: "sample-scenario",
    scenarioFingerprint: fingerprintText("The sample scenario prompt.\n"),
    rubric: ["correctness", "structure"],
    checks: [{ id: "unit", kind: "validator", command: "manifest:test", timeoutSeconds: 300 }],
    checksFingerprint: fingerprintText("unit/manifest:test\n"),
    createdAt: "2026-04-07T09:00:00.000Z",
    ...overrides,
  };
}

function sampleDefinition(overrides = {}) {
  return new EvaluationDefinition(sampleDefinitionFields(overrides));
}

module.exports = { sampleArm, sampleDefinitionFields, sampleDefinition };
