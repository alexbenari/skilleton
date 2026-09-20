const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { listDirectoryNames, listFileNames, entryKind } = require("../../electron/evaluation-fs");
const { fingerprintDirectory } = require("../../electron/evaluation-fingerprint");
const { scanAmbientGuidance } = require("../../electron/evaluation-ambient-guidance");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-fs-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

// Windows allows a directory junction without administrator rights, which is
// what a published skill library actually looks like on this machine.
function linkDirectory(target, linkPath) {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

test("listDirectoryNames counts a symlinked directory, which readdir reports as a link", () => {
  const tempRoot = makeTempRoot();
  try {
    const realSkill = path.join(tempRoot, "library", "writing-clean-code");
    writeFile(path.join(realSkill, "SKILL.md"), "---\nname: writing-clean-code\n---\n");
    const skillRoot = path.join(tempRoot, "skills");
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.mkdirSync(path.join(skillRoot, "plain-skill"), { recursive: true });
    linkDirectory(realSkill, path.join(skillRoot, "linked-skill"));

    assert.deepEqual(listDirectoryNames(skillRoot), ["linked-skill", "plain-skill"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("entryKind resolves a symlinked directory and reports a broken link", () => {
  const tempRoot = makeTempRoot();
  try {
    const realSkill = path.join(tempRoot, "library", "domain-modeling");
    writeFile(path.join(realSkill, "SKILL.md"), "---\nname: domain-modeling\n---\n");
    const skillRoot = path.join(tempRoot, "skills");
    fs.mkdirSync(skillRoot, { recursive: true });
    linkDirectory(realSkill, path.join(skillRoot, "linked-skill"));
    linkDirectory(path.join(tempRoot, "library", "gone"), path.join(skillRoot, "dangling"));

    const entries = Object.fromEntries(
      fs
        .readdirSync(skillRoot, { withFileTypes: true })
        .map((entry) => [entry.name, entryKind(path.join(skillRoot, entry.name), entry, fs)])
    );

    assert.equal(entries["linked-skill"], "directory");
    assert.equal(entries.dangling, "broken-link");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("fingerprintDirectory reads through a symlinked subdirectory", () => {
  const tempRoot = makeTempRoot();
  try {
    const shared = path.join(tempRoot, "shared");
    writeFile(path.join(shared, "notes.md"), "original\n");
    const subject = path.join(tempRoot, "subject");
    fs.mkdirSync(subject, { recursive: true });
    writeFile(path.join(subject, "SKILL.md"), "---\nname: subject\n---\n");
    linkDirectory(shared, path.join(subject, "reference"));

    const before = fingerprintDirectory(subject);
    writeFile(path.join(shared, "notes.md"), "changed\n");
    const after = fingerprintDirectory(subject);

    assert.notEqual(before, after);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("listFileNames ignores directories and keeps names sorted", () => {
  const tempRoot = makeTempRoot();
  try {
    writeFile(path.join(tempRoot, "subjects", "coding-quality-v2.md"), "v2\n");
    writeFile(path.join(tempRoot, "subjects", "coding-quality-v1.md"), "v1\n");
    fs.mkdirSync(path.join(tempRoot, "subjects", "archive"), { recursive: true });

    assert.deepEqual(listFileNames(path.join(tempRoot, "subjects")), [
      "coding-quality-v1.md",
      "coding-quality-v2.md",
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the ambient guidance scan sees symlinked skills, which is what the refusal depends on", () => {
  const tempRoot = makeTempRoot();
  try {
    const realSkill = path.join(tempRoot, "library", "firecrawl");
    writeFile(path.join(realSkill, "SKILL.md"), "---\nname: firecrawl\n---\n");
    const globalRoot = path.join(tempRoot, "global-skills");
    fs.mkdirSync(globalRoot, { recursive: true });
    linkDirectory(realSkill, path.join(globalRoot, "firecrawl"));

    const ambient = scanAmbientGuidance({
      agent: "codex",
      rootsFor: { codex: () => [globalRoot] },
    });

    assert.deepEqual(ambient.skillNames(), ["firecrawl"]);
    assert.equal(ambient.has("firecrawl"), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
