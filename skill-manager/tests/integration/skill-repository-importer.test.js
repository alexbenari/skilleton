const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { SkillDiscovery } = require("../../electron/skill-discovery");
const { SkillRepositoryImporter } = require("../../electron/skill-repository-importer");
const { createDBAdapter } = require("../../electron/skill-library-db");

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function initLocalRepo(repoPath, files) {
  fs.mkdirSync(repoPath, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(path.join(repoPath, relativePath), content);
  }
  runGit(["init"], repoPath);
  runGit(["config", "user.name", "Skill Manager Tests"], repoPath);
  runGit(["config", "user.email", "skill-manager-tests@example.com"], repoPath);
  runGit(["add", "."], repoPath);
  runGit(["commit", "-m", "Initial import fixture"], repoPath);
  return runGit(["rev-parse", "HEAD"], repoPath);
}

function listChildNames(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }
  return fs.readdirSync(targetPath).sort();
}

function listTempWorkspaces(tempImportRoot) {
  const skillManagerTempRoot = path.join(tempImportRoot, "skill-manager");
  if (!fs.existsSync(skillManagerTempRoot)) {
    return [];
  }
  return fs.readdirSync(skillManagerTempRoot).sort();
}

function createTempEnvironment() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-repository-importer-"));
  const libraryRoot = path.join(tempRoot, "library");
  const tempImportRoot = path.join(tempRoot, "temp-imports");
  const databasePath = path.join(tempRoot, "skill-manager.sqlite");
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(tempImportRoot, { recursive: true });
  const db = createDBAdapter({ databasePath });
  db.initialize();
  const library = db.setLibrary(libraryRoot);
  const discovery = new SkillDiscovery({ fileSystem: fs });
  const importer = new SkillRepositoryImporter({
    db,
    discovery,
    fileSystem: fs,
    runGit,
    tempRootPath: tempImportRoot,
  });
  return {
    tempRoot,
    libraryRoot,
    tempImportRoot,
    db,
    library,
    importer,
  };
}

function cleanupTempEnvironment({ db, tempRoot }) {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

test("addSkillsFromRepository clones to temp, copies repo contents without .git, and catalogs final paths", () => {
  const env = createTempEnvironment();
  const repoPath = path.join(env.tempRoot, "alpha-pack");

  try {
    const importedRevision = initLocalRepo(repoPath, {
      ".agents/skills/alpha-review/SKILL.md": `---
name: alpha-review
description: "Review helper."
---
`,
      "references/guide.md": "# Guide\n",
      "scripts/check.txt": "ok\n",
    });

    const result = env.importer.addSkillsFromRepository({
      libraryId: env.library.id,
      libraryRoot: env.libraryRoot,
      repoUrl: repoPath,
    });

    const destination = path.join(env.libraryRoot, "alpha-pack");
    const importedSkillPath = path.join(destination, ".agents", "skills", "alpha-review");
    const copiedGuidePath = path.join(destination, "references", "guide.md");
    const copiedScriptPath = path.join(destination, "scripts", "check.txt");
    const skills = env.db.listSkills(env.library.id);

    assert.equal(result.status, "cataloged");
    assert.deepEqual(result.importedSkillNames, ["alpha-review"]);
    assert.equal(fs.existsSync(importedSkillPath), true);
    assert.equal(fs.existsSync(copiedGuidePath), true);
    assert.equal(fs.existsSync(copiedScriptPath), true);
    assert.equal(fs.existsSync(path.join(destination, ".git")), false);
    assert.deepEqual(listTempWorkspaces(env.tempImportRoot), []);

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "alpha-review");
    assert.equal(skills[0].localPath, importedSkillPath);
    assert.equal(skills[0].source, "alpha-pack");
    assert.equal(skills[0].gitSourceUrl, repoPath);
    assert.equal(skills[0].gitImportedRevision, importedRevision);
    assert.equal(typeof skills[0].gitTrackedRef, "string");
    assert.notEqual(skills[0].gitTrackedRef.length, 0);
  } finally {
    cleanupTempEnvironment(env);
  }
});

test("addSkillsFromRepository auto-cleans temp clones and writes nothing when no skills are found", () => {
  const env = createTempEnvironment();
  const repoPath = path.join(env.tempRoot, "empty-pack");

  try {
    initLocalRepo(repoPath, {
      "README.md": "# Empty pack\n",
    });

    const result = env.importer.addSkillsFromRepository({
      libraryId: env.library.id,
      libraryRoot: env.libraryRoot,
      repoUrl: repoPath,
    });

    assert.equal(result.status, "no-skills-found");
    assert.equal(fs.existsSync(path.join(env.libraryRoot, "empty-pack")), false);
    assert.deepEqual(listTempWorkspaces(env.tempImportRoot), []);
    assert.deepEqual(env.db.listSkills(env.library.id), []);
  } finally {
    cleanupTempEnvironment(env);
  }
});
