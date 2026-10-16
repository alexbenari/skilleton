const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { detectContamination } = require("../../electron/evaluation-ambient-guidance");
const { GuidanceSet, Subject } = require("../../electron/evaluation-definition");

function skillNamed(name) {
  return new Subject({
    kind: "skill",
    name,
    sourcePath: `D:\\library\\${name}`,
    fingerprint: "sha256:skill",
  });
}

function transcriptContaining(text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-contamination-"));
  const transcriptPath = path.join(root, "transcript.jsonl");
  fs.writeFileSync(transcriptPath, text, "utf8");
  return { root, transcriptPath };
}

// Scanning skill roots predicts what an arm will see; this measures what it did
// see. Guidance bundled with the CLI sits on no root the app can enumerate, so
// a collision with one only ever shows up in the transcript.
test("a baseline arm whose transcript names the other arm's subject is reported as contaminated", () => {
  const { root, transcriptPath } = transcriptContaining(
    '{"type":"tool_use","name":"Skill","input":{"skill":"writing-clean-code"}}\n'
  );
  try {
    const contamination = detectContamination({
      transcriptPath,
      ownGuidanceSet: new GuidanceSet([]),
      otherGuidanceSet: new GuidanceSet([skillNamed("writing-clean-code")]),
    });

    assert.equal(contamination.length, 1);
    assert.equal(contamination[0].subjectName, "writing-clean-code");
    assert.equal(contamination[0].evidence.includes("writing-clean-code"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an arm that carries a subject itself is not reported as contaminated by it", () => {
  const { root, transcriptPath } = transcriptContaining(
    '{"type":"tool_use","name":"Skill","input":{"skill":"writing-clean-code"}}\n'
  );
  try {
    const guidanceSet = new GuidanceSet([skillNamed("writing-clean-code")]);

    assert.deepEqual(
      detectContamination({
        transcriptPath,
        ownGuidanceSet: guidanceSet,
        otherGuidanceSet: guidanceSet,
      }),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only the subjects the other arm carried are watched for", () => {
  const { root, transcriptPath } = transcriptContaining(
    '{"type":"tool_use","name":"Skill","input":{"skill":"testing-discipline"}}\n'
  );
  try {
    assert.deepEqual(
      detectContamination({
        transcriptPath,
        ownGuidanceSet: new GuidanceSet([]),
        otherGuidanceSet: new GuidanceSet([skillNamed("writing-clean-code")]),
      }),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a clean transcript and a missing transcript both report no contamination", () => {
  const { root, transcriptPath } = transcriptContaining('{"type":"tool_use","name":"Read"}\n');
  try {
    const otherGuidanceSet = new GuidanceSet([skillNamed("writing-clean-code")]);
    const ownGuidanceSet = new GuidanceSet([]);

    assert.deepEqual(detectContamination({ transcriptPath, ownGuidanceSet, otherGuidanceSet }), []);
    assert.deepEqual(
      detectContamination({
        transcriptPath: path.join(root, "absent.jsonl"),
        ownGuidanceSet,
        otherGuidanceSet,
      }),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
