const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { SubjectActivation, EvaluationActivationError } = require("../../electron/evaluation-activation");
const { GuidanceSet, Subject } = require("../../electron/evaluation-definition");

const POINTER_TEXT =
  "## Code design guidance\n\nRead the repository design-guidance document `coding-quality.md` first.\n";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-activation-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function skillSubject(sourceRoot, name) {
  const skillPath = path.join(sourceRoot, name);
  writeFile(path.join(skillPath, "SKILL.md"), `---\nname: ${name}\n---\n\nPrefer small modules.\n`);
  writeFile(path.join(skillPath, "reference", "notes.md"), "Longer notes.\n");
  return new Subject({
    kind: "skill",
    name,
    sourcePath: skillPath,
    fingerprint: "sha256:skill",
  });
}

function instructionSubject(sourceRoot, contents = "# Repository Instructions\n\nRun the tests.\n") {
  return new Subject({
    kind: "instruction-file",
    name: "repository-instructions",
    sourcePath: writeFile(path.join(sourceRoot, "instructions.md"), contents),
    fingerprint: "sha256:instructions",
  });
}

function referencedDocumentSubject(sourceRoot) {
  return new Subject({
    kind: "referenced-document",
    name: "coding-quality",
    sourcePath: writeFile(path.join(sourceRoot, "coding-quality-v1.md"), "# Code Design\n"),
    fingerprint: "sha256:document",
    pointerText: POINTER_TEXT,
    workspacePath: "coding-quality.md",
  });
}

test("a skill subject installs into the agent's own project skill root", () => {
  const tempRoot = makeTempRoot();
  try {
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const guidanceSet = new GuidanceSet([skillSubject(path.join(tempRoot, "library"), "writing-clean-code")]);

    const claudeRecord = new SubjectActivation({ agent: "claude" }).activate(workspacePath, guidanceSet);
    const codexWorkspace = path.join(tempRoot, "workspace-codex");
    fs.mkdirSync(codexWorkspace, { recursive: true });
    const codexRecord = new SubjectActivation({ agent: "codex" }).activate(codexWorkspace, guidanceSet);

    assert.equal(
      fs.existsSync(path.join(workspacePath, ".claude", "skills", "writing-clean-code", "SKILL.md")),
      true
    );
    assert.equal(
      fs.existsSync(path.join(codexWorkspace, ".agents", "skills", "writing-clean-code", "SKILL.md")),
      true
    );
    assert.deepEqual(claudeRecord.skillPaths, {
      "writing-clean-code": ".claude/skills/writing-clean-code",
    });
    assert.deepEqual(codexRecord.skillPaths, {
      "writing-clean-code": ".agents/skills/writing-clean-code",
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a skill subject's nested files are installed alongside SKILL.md", () => {
  const tempRoot = makeTempRoot();
  try {
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const guidanceSet = new GuidanceSet([skillSubject(path.join(tempRoot, "library"), "testing-discipline")]);

    new SubjectActivation({ agent: "claude" }).activate(workspacePath, guidanceSet);

    assert.equal(
      fs.readFileSync(
        path.join(workspacePath, ".claude", "skills", "testing-discipline", "reference", "notes.md"),
        "utf8"
      ),
      "Longer notes.\n"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("one instruction-file subject is written under each agent's own filename with identical content", () => {
  const tempRoot = makeTempRoot();
  try {
    const sourceRoot = path.join(tempRoot, "subjects");
    const guidanceSet = new GuidanceSet([instructionSubject(sourceRoot)]);
    const claudeWorkspace = path.join(tempRoot, "claude");
    const codexWorkspace = path.join(tempRoot, "codex");
    fs.mkdirSync(claudeWorkspace, { recursive: true });
    fs.mkdirSync(codexWorkspace, { recursive: true });

    const claudeRecord = new SubjectActivation({ agent: "claude" }).activate(claudeWorkspace, guidanceSet);
    const codexRecord = new SubjectActivation({ agent: "codex" }).activate(codexWorkspace, guidanceSet);

    const claudeText = fs.readFileSync(path.join(claudeWorkspace, "CLAUDE.md"), "utf8");
    const codexText = fs.readFileSync(path.join(codexWorkspace, "AGENTS.md"), "utf8");
    assert.equal(claudeText, codexText);
    assert.equal(claudeText, "# Repository Instructions\n\nRun the tests.\n");
    assert.equal(claudeRecord.instructionFilename, "CLAUDE.md");
    assert.equal(codexRecord.instructionFilename, "AGENTS.md");
    assert.equal(fs.existsSync(path.join(claudeWorkspace, "AGENTS.md")), false);
    assert.equal(fs.existsSync(path.join(codexWorkspace, "CLAUDE.md")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the instruction file is a materialized copy, not a link back to the subject source", () => {
  const tempRoot = makeTempRoot();
  try {
    const sourceRoot = path.join(tempRoot, "subjects");
    const subject = instructionSubject(sourceRoot);
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });

    new SubjectActivation({ agent: "claude" }).activate(workspacePath, new GuidanceSet([subject]));
    fs.writeFileSync(path.join(workspacePath, "CLAUDE.md"), "rewritten by the run\n", "utf8");

    assert.equal(
      fs.readFileSync(subject.sourcePath, "utf8"),
      "# Repository Instructions\n\nRun the tests.\n"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a referenced-document subject writes the document and its pointer", () => {
  const tempRoot = makeTempRoot();
  try {
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const guidanceSet = new GuidanceSet([referencedDocumentSubject(path.join(tempRoot, "subjects"))]);

    const record = new SubjectActivation({ agent: "codex" }).activate(workspacePath, guidanceSet);

    assert.equal(fs.readFileSync(path.join(workspacePath, "coding-quality.md"), "utf8"), "# Code Design\n");
    assert.equal(fs.readFileSync(path.join(workspacePath, "AGENTS.md"), "utf8"), `${POINTER_TEXT.trimEnd()}\n`);
    assert.deepEqual(record.documentPaths, { "coding-quality": "coding-quality.md" });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an empty guidance set writes neither pointer nor document", () => {
  const tempRoot = makeTempRoot();
  try {
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });

    const record = new SubjectActivation({ agent: "claude" }).activate(workspacePath, new GuidanceSet([]));

    assert.deepEqual(record.artifacts, []);
    assert.equal(fs.existsSync(path.join(workspacePath, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(workspacePath, "coding-quality.md")), false);
    assert.equal(record.deliveredInstructionBytes, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an instruction-file subject and a pointer share one instruction file", () => {
  const tempRoot = makeTempRoot();
  try {
    const sourceRoot = path.join(tempRoot, "subjects");
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const guidanceSet = new GuidanceSet([
      instructionSubject(sourceRoot),
      referencedDocumentSubject(sourceRoot),
    ]);

    new SubjectActivation({ agent: "claude" }).activate(workspacePath, guidanceSet);

    const instructionText = fs.readFileSync(path.join(workspacePath, "CLAUDE.md"), "utf8");
    assert.equal(instructionText.includes("Run the tests."), true);
    assert.equal(instructionText.includes("coding-quality.md"), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// Guidance discovered from a real project takes each pointer out of that
// project's own instruction file, so the two arrive together and the pointer
// would otherwise be written twice.
test("a pointer the instruction file already carries is not repeated", () => {
  const tempRoot = makeTempRoot();
  try {
    const sourceRoot = path.join(tempRoot, "subjects");
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const instructionsWithPointer = `# Repository Instructions\n\n${POINTER_TEXT}\nRun the tests.\n`;
    const guidanceSet = new GuidanceSet([
      instructionSubject(sourceRoot, instructionsWithPointer),
      referencedDocumentSubject(sourceRoot),
    ]);

    new SubjectActivation({ agent: "claude" }).activate(workspacePath, guidanceSet);

    const instructionText = fs.readFileSync(path.join(workspacePath, "CLAUDE.md"), "utf8");
    const occurrences = instructionText.split("Read the repository design-guidance document").length - 1;
    assert.equal(occurrences, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a pointer the instruction file does not carry is still appended", () => {
  const tempRoot = makeTempRoot();
  try {
    const sourceRoot = path.join(tempRoot, "subjects");
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const guidanceSet = new GuidanceSet([
      instructionSubject(sourceRoot, "# Repository Instructions\n\nRun the tests.\n"),
      referencedDocumentSubject(sourceRoot),
    ]);

    new SubjectActivation({ agent: "claude" }).activate(workspacePath, guidanceSet);

    const instructionText = fs.readFileSync(path.join(workspacePath, "CLAUDE.md"), "utf8");
    assert.equal(instructionText.includes("coding-quality.md"), true);
    assert.equal(instructionText.includes("Run the tests."), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the reported artifact list names every file activation wrote", () => {
  const tempRoot = makeTempRoot();
  try {
    const sourceRoot = path.join(tempRoot, "subjects");
    const workspacePath = path.join(tempRoot, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const guidanceSet = new GuidanceSet([
      skillSubject(path.join(tempRoot, "library"), "domain-modeling"),
      referencedDocumentSubject(sourceRoot),
    ]);

    const record = new SubjectActivation({ agent: "claude" }).activate(workspacePath, guidanceSet);

    assert.deepEqual(
      [...record.artifacts].sort(),
      [".claude/skills/domain-modeling", "CLAUDE.md", "coding-quality.md"].sort()
    );
    for (const artifact of record.artifacts) {
      assert.equal(fs.existsSync(path.join(workspacePath, ...artifact.split("/"))), true);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an instruction file above the Codex project-doc budget is flagged truncated for Codex only", () => {
  const tempRoot = makeTempRoot();
  try {
    const sourceRoot = path.join(tempRoot, "subjects");
    const oversized = `# Repository Instructions\n\n${"guidance line\n".repeat(3000)}`;
    const guidanceSet = new GuidanceSet([instructionSubject(sourceRoot, oversized)]);
    const claudeWorkspace = path.join(tempRoot, "claude");
    const codexWorkspace = path.join(tempRoot, "codex");
    fs.mkdirSync(claudeWorkspace, { recursive: true });
    fs.mkdirSync(codexWorkspace, { recursive: true });

    const claudeRecord = new SubjectActivation({ agent: "claude" }).activate(claudeWorkspace, guidanceSet);
    const codexRecord = new SubjectActivation({ agent: "codex" }).activate(codexWorkspace, guidanceSet);

    assert.equal(codexRecord.deliveredInstructionBytes > 32 * 1024, true);
    assert.equal(codexRecord.truncated, true);
    assert.equal(claudeRecord.truncated, false);
    assert.equal(claudeRecord.deliveredInstructionBytes, codexRecord.deliveredInstructionBytes);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an unknown agent is refused before anything is written", () => {
  assert.throws(
    () => new SubjectActivation({ agent: "gemini" }),
    (error) => error instanceof EvaluationActivationError && error.message.includes("gemini")
  );
});
