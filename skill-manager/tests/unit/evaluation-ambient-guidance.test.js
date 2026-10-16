const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  AmbientGuidanceError,
  assertNoAmbientCollision,
  scanAmbientGuidance,
} = require("../../electron/evaluation-ambient-guidance");
const { GuidanceSet, Subject } = require("../../electron/evaluation-definition");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-ambient-guidance-"));
}

// Stands in for a global skill root the CLI reads no matter what the run's
// isolated home says: a directory of installed skills.
function makeSkillRoot(rootPath, skillNames) {
  for (const skillName of skillNames) {
    fs.mkdirSync(path.join(rootPath, skillName), { recursive: true });
    fs.writeFileSync(
      path.join(rootPath, skillName, "SKILL.md"),
      `---\nname: ${skillName}\n---\n`,
      "utf8"
    );
  }
  return rootPath;
}

function rootsForCodex(rootPaths) {
  return { codex: () => rootPaths };
}

function skillSubject(name) {
  return new Subject({
    kind: "skill",
    name,
    sourcePath: `D:\\library\\skills\\${name}`,
    fingerprint: "sha256:skill",
  });
}

function instructionFileSubject(name) {
  return new Subject({
    kind: "instruction-file",
    name,
    sourcePath: `D:\\library\\instructions\\${name}`,
    fingerprint: "sha256:instruction-file",
  });
}

function referencedDocumentSubject(name) {
  return new Subject({
    kind: "referenced-document",
    name,
    sourcePath: `D:\\library\\documents\\${name}`,
    fingerprint: "sha256:referenced-document",
    pointerText: `Read ${name} before changing code.`,
    workspacePath: `D:\\runs\\evaluation-0001\\workspace\\${name}`,
  });
}

test("a scan lists the skills installed in each root and marks a root that does not exist absent", () => {
  const tempRoot = makeTempRoot();
  try {
    const installedRoot = makeSkillRoot(path.join(tempRoot, "agents-skills"), [
      "writing-clean-code",
      "api-and-interface-design",
    ]);
    const missingRoot = path.join(tempRoot, "codex-skills");

    const ambient = scanAmbientGuidance({
      agent: "codex",
      rootsFor: rootsForCodex([installedRoot, missingRoot]),
    });

    assert.deepEqual(ambient.roots[0], {
      path: installedRoot,
      present: true,
      skillNames: ["api-and-interface-design", "writing-clean-code"],
    });
    assert.deepEqual(ambient.roots[1], {
      path: missingRoot,
      present: false,
      skillNames: [],
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a skill installed in two roots is listed once, and the names come back sorted", () => {
  const tempRoot = makeTempRoot();
  try {
    const firstRoot = makeSkillRoot(path.join(tempRoot, "agents-skills"), [
      "writing-clean-code",
      "testing-discipline",
    ]);
    const secondRoot = makeSkillRoot(path.join(tempRoot, "codex-skills"), [
      "testing-discipline",
      "api-and-interface-design",
    ]);

    const ambient = scanAmbientGuidance({
      agent: "codex",
      rootsFor: rootsForCodex([firstRoot, secondRoot]),
    });

    assert.deepEqual(ambient.skillNames(), [
      "api-and-interface-design",
      "testing-discipline",
      "writing-clean-code",
    ]);
    assert.equal(ambient.has("testing-discipline"), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a skill subject that is also installed globally is refused, naming the skill and the root", () => {
  const tempRoot = makeTempRoot();
  try {
    const installedRoot = makeSkillRoot(path.join(tempRoot, "agents-skills"), [
      "testing-discipline",
    ]);
    const ambient = scanAmbientGuidance({
      agent: "codex",
      rootsFor: rootsForCodex([installedRoot]),
    });
    const referenceArmGuidance = new GuidanceSet([]);
    const candidateArmGuidance = new GuidanceSet([skillSubject("testing-discipline")]);

    assert.throws(
      () => assertNoAmbientCollision([referenceArmGuidance, candidateArmGuidance], ambient),
      (error) =>
        error instanceof AmbientGuidanceError &&
        error.message.includes("testing-discipline") &&
        error.message.includes(installedRoot)
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an instruction file or referenced document sharing a name with a global skill is allowed", () => {
  const tempRoot = makeTempRoot();
  try {
    const installedRoot = makeSkillRoot(path.join(tempRoot, "agents-skills"), [
      "testing-discipline",
      "coding-quality",
    ]);
    const ambient = scanAmbientGuidance({
      agent: "codex",
      rootsFor: rootsForCodex([installedRoot]),
    });
    const guidanceSet = new GuidanceSet([
      instructionFileSubject("testing-discipline"),
      referencedDocumentSubject("coding-quality"),
    ]);

    assert.doesNotThrow(() => assertNoAmbientCollision([guidanceSet], ambient));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a skill subject that is not installed globally passes the collision check", () => {
  const tempRoot = makeTempRoot();
  try {
    const installedRoot = makeSkillRoot(path.join(tempRoot, "agents-skills"), [
      "writing-clean-code",
    ]);
    const ambient = scanAmbientGuidance({
      agent: "codex",
      rootsFor: rootsForCodex([installedRoot]),
    });
    const guidanceSet = new GuidanceSet([skillSubject("testing-discipline")]);

    assert.doesNotThrow(() => assertNoAmbientCollision([guidanceSet], ambient));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a scan for an agent with no known roots is refused rather than reported as empty", () => {
  assert.throws(
    () =>
      scanAmbientGuidance({
        agent: "gemini",
        rootsFor: rootsForCodex(["D:\\library\\skills"]),
      }),
    (error) => error instanceof AmbientGuidanceError && error.message.includes("gemini")
  );
});
