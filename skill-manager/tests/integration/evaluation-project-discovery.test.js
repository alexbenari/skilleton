const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  ProjectDiscoveryError,
  discoverProjectGuidance,
} = require("../../electron/evaluation-project-discovery");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-discovery-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function writeSkill(rootPath, name) {
  writeFile(path.join(rootPath, name, "SKILL.md"), `---\nname: ${name}\n---\n\nGuidance.\n`);
}

const INSTRUCTIONS = [
  "# Repository Instructions",
  "",
  "## Code design guidance",
  "",
  "Read the design-guidance document `coding-quality.md` before writing code.",
  "",
  "## Planning",
  "",
  "Plans follow @docs/plans-format.md exactly.",
  "",
  "A document that does not exist: `missing-guide.md`.",
].join("\n");

function makeProject({ instructionFilename = "CLAUDE.md", skillRoot = ".claude/skills" } = {}) {
  const projectPath = makeTempRoot();
  writeFile(path.join(projectPath, instructionFilename), INSTRUCTIONS);
  writeFile(path.join(projectPath, "coding-quality.md"), "# Code Design\n");
  writeFile(path.join(projectPath, "docs", "plans-format.md"), "# Plans\n");
  writeSkill(path.join(projectPath, ...skillRoot.split("/")), "writing-clean-code");
  writeSkill(path.join(projectPath, ...skillRoot.split("/")), "testing-discipline");
  return projectPath;
}

// The order is the order guidance reaches an agent: always-in-context first,
// then what it is pointed at, then what only loads when judged relevant.
test("discovery returns the instruction file, then referenced documents, then skills", () => {
  const projectPath = makeProject();
  try {
    const { guidance } = discoverProjectGuidance({ projectPath, agent: "claude" });

    assert.deepEqual(
      guidance.map((subject) => subject.kind),
      [
        "instruction-file",
        "referenced-document",
        "referenced-document",
        "skill",
        "skill",
      ]
    );
    assert.equal(guidance[0].name, "CLAUDE");
    assert.deepEqual(
      guidance.slice(1, 3).map((subject) => subject.name).sort(),
      ["coding-quality", "plans-format"]
    );
    assert.deepEqual(
      guidance.slice(3).map((subject) => subject.name),
      ["testing-discipline", "writing-clean-code"]
    );
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test("a document the instructions name but the project lacks is not offered", () => {
  const projectPath = makeProject();
  try {
    const { guidance } = discoverProjectGuidance({ projectPath, agent: "claude" });

    assert.equal(
      guidance.some((subject) => subject.name === "missing-guide"),
      false
    );
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test("a referenced document carries the paragraph that points at it", () => {
  const projectPath = makeProject();
  try {
    const { guidance } = discoverProjectGuidance({ projectPath, agent: "claude" });
    const document = guidance.find((subject) => subject.name === "coding-quality");

    assert.equal(document.pointerText.includes("before writing code"), true);
    assert.equal(document.workspacePath, "coding-quality.md");
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test("skills published under the other agent's convention are still discovered", () => {
  const projectPath = makeProject({ skillRoot: ".agents/skills" });
  try {
    const { guidance } = discoverProjectGuidance({ projectPath, agent: "claude" });

    assert.deepEqual(
      guidance.filter((subject) => subject.kind === "skill").map((subject) => subject.name),
      ["testing-discipline", "writing-clean-code"]
    );
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test("a directory without SKILL.md is not offered as a skill", () => {
  const projectPath = makeProject();
  try {
    fs.mkdirSync(path.join(projectPath, ".claude", "skills", "not-a-skill"), { recursive: true });

    const { guidance } = discoverProjectGuidance({ projectPath, agent: "claude" });

    assert.equal(
      guidance.some((subject) => subject.name === "not-a-skill"),
      false
    );
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test("codex prefers AGENTS.md where both instruction files exist", () => {
  const projectPath = makeProject();
  try {
    writeFile(path.join(projectPath, "AGENTS.md"), "# Codex Instructions\n\nNo references here.\n");

    const forCodex = discoverProjectGuidance({ projectPath, agent: "codex" });
    const forClaude = discoverProjectGuidance({ projectPath, agent: "claude" });

    assert.equal(forCodex.guidance[0].discoveredAs, "AGENTS.md");
    assert.equal(forClaude.guidance[0].discoveredAs, "CLAUDE.md");
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test("a project with no instruction file still offers its skills, and says what is missing", () => {
  const projectPath = makeTempRoot();
  try {
    writeSkill(path.join(projectPath, ".claude", "skills"), "writing-clean-code");

    const { guidance, notes } = discoverProjectGuidance({ projectPath, agent: "claude" });

    assert.deepEqual(
      guidance.map((subject) => subject.kind),
      ["skill"]
    );
    assert.equal(notes.length, 1);
    assert.equal(notes[0].includes("CLAUDE.md"), true);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test("a missing project folder is refused", () => {
  assert.throws(
    () => discoverProjectGuidance({ projectPath: path.join(os.tmpdir(), "no-such-project"), agent: "claude" }),
    (error) => error instanceof ProjectDiscoveryError && error.message.includes("does not exist")
  );
});
