const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { SkillInstaller } = require("../electron/skill-installer");

function writeSkill(dirPath, description) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(
    path.join(dirPath, "SKILL.md"),
    `---\nname: ${path.basename(dirPath)}\ndescription: "${description}"\n---\n`,
    "utf8"
  );
}

test("enableSkill copies nested files into the repo install target", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-installer-"));
  const codexHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const installer = new SkillInstaller({
    codexHomePath: () => codexHome,
  });
  const skill = {
    name: "alpha-review",
    localPath: path.join(libraryRoot, "alpha-review"),
  };

  try {
    writeSkill(skill.localPath, "Review helper.");
    fs.mkdirSync(path.join(skill.localPath, "nested"), { recursive: true });
    fs.writeFileSync(path.join(skill.localPath, "nested", "note.txt"), "note", "utf8");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

    const result = installer.enableSkill(skill, projectRoot, false);
    const copiedPath = path.join(projectRoot, ".agents", "skills", "alpha-review");

    assert.equal(result.status, "enabled");
    assert.equal(fs.readFileSync(path.join(copiedPath, "nested", "note.txt"), "utf8"), "note");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("enableSkill blocks a modified copied install until force is set", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-installer-"));
  const codexHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const installer = new SkillInstaller({
    codexHomePath: () => codexHome,
  });
  const skill = {
    name: "alpha-review",
    localPath: path.join(libraryRoot, "alpha-review"),
  };

  try {
    writeSkill(skill.localPath, "Review helper.");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

    installer.enableSkill(skill, projectRoot, false);
    fs.writeFileSync(
      path.join(projectRoot, ".agents", "skills", "alpha-review", "local-note.txt"),
      "local edit",
      "utf8"
    );

    const blocked = installer.enableSkill(skill, projectRoot, false);
    assert.equal(blocked.status, "blocked-modified");

    const replaced = installer.enableSkill(skill, projectRoot, true);
    assert.equal(replaced.status, "replaced");
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".agents", "skills", "alpha-review", "local-note.txt")),
      false
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("installGlobalSkill copies nested files into the Codex home skills root", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-installer-"));
  const codexHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const installer = new SkillInstaller({
    codexHomePath: () => codexHome,
  });
  const skill = {
    name: "alpha-review",
    localPath: path.join(libraryRoot, "alpha-review"),
  };

  try {
    writeSkill(skill.localPath, "Review helper.");
    fs.mkdirSync(path.join(skill.localPath, "nested"), { recursive: true });
    fs.writeFileSync(path.join(skill.localPath, "nested", "note.txt"), "note", "utf8");

    const result = installer.installGlobalSkill(skill, false);
    const copiedPath = path.join(codexHome, "skills", "alpha-review");

    assert.equal(result.status, "installed");
    assert.equal(fs.readFileSync(path.join(copiedPath, "nested", "note.txt"), "utf8"), "note");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
