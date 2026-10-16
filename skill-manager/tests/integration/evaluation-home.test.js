const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { IsolatedAgentHome, EvaluationHomeError } = require("../../electron/evaluation-home");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-home-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

// Stands in for the user's real ~/.claude or ~/.codex: credentials next to the
// global guidance that must not reach a run.
function makeUserHome(rootPath, credentialFilename) {
  writeFile(path.join(rootPath, credentialFilename), '{"token":"placeholder"}');
  writeFile(path.join(rootPath, "CLAUDE.md"), "# Personal instructions\n");
  writeFile(path.join(rootPath, "AGENTS.md"), "# Personal instructions\n");
  writeFile(path.join(rootPath, "skills", "personal-skill", "SKILL.md"), "---\nname: personal-skill\n---\n");
  writeFile(path.join(rootPath, "config.toml"), 'model = "placeholder"\n');
  return rootPath;
}

test("create copies credentials and leaves global skills and instruction files behind", () => {
  const tempRoot = makeTempRoot();
  try {
    const source = makeUserHome(path.join(tempRoot, "user-claude"), ".credentials.json");
    const homePath = path.join(tempRoot, "isolated", "claude");

    const home = new IsolatedAgentHome().create({ agent: "claude", homePath, sourcePath: source });

    assert.equal(home.isolation, "isolated");
    assert.equal(fs.existsSync(path.join(homePath, ".credentials.json")), true);
    assert.equal(fs.existsSync(path.join(homePath, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(homePath, "skills")), false);
    assert.deepEqual(home.copiedFilenames, [".credentials.json"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a Codex home carries auth.json and config.toml but not AGENTS.md or global skills", () => {
  const tempRoot = makeTempRoot();
  try {
    const source = makeUserHome(path.join(tempRoot, "user-codex"), "auth.json");
    const homePath = path.join(tempRoot, "isolated", "codex");

    const home = new IsolatedAgentHome().create({ agent: "codex", homePath, sourcePath: source });

    assert.equal(fs.existsSync(path.join(homePath, "auth.json")), true);
    assert.equal(fs.existsSync(path.join(homePath, "config.toml")), true);
    assert.equal(fs.existsSync(path.join(homePath, "AGENTS.md")), false);
    assert.equal(fs.existsSync(path.join(homePath, "skills")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("each agent reports the environment variable its CLI reads", () => {
  const tempRoot = makeTempRoot();
  try {
    const claudeSource = makeUserHome(path.join(tempRoot, "user-claude"), ".credentials.json");
    const codexSource = makeUserHome(path.join(tempRoot, "user-codex"), "auth.json");
    const isolatedHome = new IsolatedAgentHome();

    const claudeHome = isolatedHome.create({
      agent: "claude",
      homePath: path.join(tempRoot, "isolated", "claude"),
      sourcePath: claudeSource,
    });
    const codexHome = isolatedHome.create({
      agent: "codex",
      homePath: path.join(tempRoot, "isolated", "codex"),
      sourcePath: codexSource,
    });

    assert.deepEqual(claudeHome.environment(), { CLAUDE_CONFIG_DIR: claudeHome.homePath });
    assert.deepEqual(codexHome.environment(), { CODEX_HOME: codexHome.homePath });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("create refuses to run when credentials are missing, rather than silently inheriting", () => {
  const tempRoot = makeTempRoot();
  try {
    const source = path.join(tempRoot, "user-claude");
    writeFile(path.join(source, "CLAUDE.md"), "# Personal instructions\n");

    assert.throws(
      () =>
        new IsolatedAgentHome().create({
          agent: "claude",
          homePath: path.join(tempRoot, "isolated", "claude"),
          sourcePath: source,
        }),
      (error) =>
        error instanceof EvaluationHomeError && error.message.includes(".credentials.json")
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an explicit inherited home is allowed and records where it inherited from", () => {
  const tempRoot = makeTempRoot();
  try {
    const source = path.join(tempRoot, "user-claude");
    writeFile(path.join(source, "CLAUDE.md"), "# Personal instructions\n");
    const homePath = path.join(tempRoot, "isolated", "claude");

    const home = new IsolatedAgentHome().create({
      agent: "claude",
      homePath,
      sourcePath: source,
      allowInheritedHome: true,
    });

    assert.equal(home.isolation, "inherited");
    assert.equal(home.isIsolated(), false);
    assert.equal(home.inheritedFrom, source);
    assert.equal(home.homePath, source);
    assert.equal(fs.existsSync(homePath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("create replaces a stale isolated home rather than merging into it", () => {
  const tempRoot = makeTempRoot();
  try {
    const source = makeUserHome(path.join(tempRoot, "user-claude"), ".credentials.json");
    const homePath = path.join(tempRoot, "isolated", "claude");
    writeFile(path.join(homePath, "skills", "leftover", "SKILL.md"), "---\nname: leftover\n---\n");

    new IsolatedAgentHome().create({ agent: "claude", homePath, sourcePath: source });

    assert.equal(fs.existsSync(path.join(homePath, "skills")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("discard removes an isolated home and leaves an inherited one alone", () => {
  const tempRoot = makeTempRoot();
  try {
    const source = makeUserHome(path.join(tempRoot, "user-claude"), ".credentials.json");
    const homePath = path.join(tempRoot, "isolated", "claude");
    const isolatedHome = new IsolatedAgentHome();
    const home = isolatedHome.create({ agent: "claude", homePath, sourcePath: source });

    isolatedHome.discard(home);
    assert.equal(fs.existsSync(homePath), false);

    const inherited = isolatedHome.create({
      agent: "claude",
      homePath: path.join(tempRoot, "isolated", "claude-2"),
      sourcePath: path.join(tempRoot, "empty-home"),
      allowInheritedHome: true,
    });
    isolatedHome.discard(inherited);
    assert.equal(fs.existsSync(source), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an unknown agent is refused", () => {
  assert.throws(
    () =>
      new IsolatedAgentHome().create({
        agent: "gemini",
        homePath: path.join(os.tmpdir(), "unused-home"),
      }),
    (error) => error instanceof EvaluationHomeError && error.message.includes("gemini")
  );
});
