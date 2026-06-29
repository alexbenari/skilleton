const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const skillLibrary = require("../electron/skill-library");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeSkill(dirPath, description) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(
    path.join(dirPath, "SKILL.md"),
    `---\nname: ${path.basename(dirPath)}\ndescription: "${description}"\n---\n\n# ${path.basename(dirPath)}\n`,
    "utf8"
  );
}

function writeNamedSkill(dirPath, name, description) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(
    path.join(dirPath, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`,
    "utf8"
  );
}

test("statusSnapshot counts copied global skills as installed", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const globalRoot = path.join(codeHome, "skills");
  const skillName = "copied-skill";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
    link_mode: "junction",
  });
  writeSkill(path.join(libraryRoot, skillName), "Library copy.");
  writeSkill(path.join(globalRoot, skillName), "Globally installed copy.");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const row = snapshot.skills.find((skill) => skill.name === skillName);

    assert.ok(row, "skill row should be present");
    assert.equal(row.global_installed, true);
    assert.equal(snapshot.globalEnabledCount, 1);
    assert.equal(snapshot.globalConflictCount, 0);
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("setRoot stores only the library pointer in Codex home", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  fs.mkdirSync(libraryRoot, { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const result = skillLibrary.setRoot(libraryRoot);
    const pointer = JSON.parse(
      fs.readFileSync(path.join(codeHome, "local-skill-library.json"), "utf8")
    );
    const libraryConfig = JSON.parse(
      fs.readFileSync(path.join(libraryRoot, ".skill-library-manager.json"), "utf8")
    );

    assert.equal(result.configPath, path.join(libraryRoot, ".skill-library-manager.json"));
    assert.deepEqual(pointer, {
      schema_version: 1,
      library_root: libraryRoot,
    });
    assert.deepEqual(libraryConfig, {
      schema_version: 1,
      link_mode: "junction",
      skill_tags: {},
    });
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("statusSnapshot migrates legacy Codex home config into library root", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
    link_mode: "junction",
  });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const libraryConfigPath = path.join(libraryRoot, ".skill-library-manager.json");
    const libraryConfig = JSON.parse(fs.readFileSync(libraryConfigPath, "utf8"));

    assert.equal(snapshot.error, undefined);
    assert.equal(snapshot.configPath, libraryConfigPath);
    assert.equal(snapshot.pointerPath, path.join(codeHome, "local-skill-library.json"));
    assert.deepEqual(libraryConfig, {
      schema_version: 1,
      link_mode: "junction",
      skill_tags: {},
    });
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(codeHome, "local-skill-library.json"), "utf8")),
      {
        schema_version: 1,
        library_root: libraryRoot,
      }
    );
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("statusSnapshot includes source folder for nested repo skills", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {},
  });
  writeSkill(path.join(libraryRoot, "97", "skills", "build-deploy-and-tooling"), "Build skill.");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const row = snapshot.skills.find((skill) => skill.name === "build-deploy-and-tooling");

    assert.equal(snapshot.error, undefined);
    assert.ok(row, "nested repo skill should be discovered");
    assert.equal(row.source, "97");
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("statusSnapshot uses frontmatter name instead of folder name", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {},
  });
  writeSkill(path.join(libraryRoot, "first", "skills", "clean-code"), "Plain clean code.");
  writeNamedSkill(
    path.join(libraryRoot, "second", "skills", "clean-code"),
    "@tank/clean-code",
    "Namespaced clean code."
  );
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const names = snapshot.skills.map((skill) => skill.name).sort();

    assert.equal(snapshot.error, undefined);
    assert.ok(names.includes("clean-code"));
    assert.ok(names.includes("@tank/clean-code"));
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("statusSnapshot collapses duplicate skills with identical content", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const content =
    "---\nname: @tank/clean-code\ndescription: \"Tank clean code.\"\n---\n\n# Tank clean code\n";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {},
  });
  for (const folder of ["clean-code", "tank-clean-code"]) {
    const skillDir = path.join(libraryRoot, "tank-skills", "skills", folder);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
  }
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const rows = snapshot.skills.filter((skill) => skill.name === "@tank/clean-code");

    assert.equal(snapshot.error, undefined);
    assert.equal(rows.length, 1);
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("setSkillTags persists normalized global tags in library config", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const skillName = "tagged-skill";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
  });
  writeSkill(path.join(libraryRoot, skillName), "Tagged skill.");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const result = skillLibrary.setSkillTags(skillName, [
      "Frontend",
      " design ",
      "frontend",
      "bad tag",
      "review!",
    ]);
    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const row = snapshot.skills.find((skill) => skill.name === skillName);
    const libraryConfig = JSON.parse(
      fs.readFileSync(path.join(libraryRoot, ".skill-library-manager.json"), "utf8")
    );

    assert.deepEqual(result.tags, ["design", "frontend"]);
    assert.deepEqual(row.tags, ["design", "frontend"]);
    assert.deepEqual(snapshot.allTags, ["design", "frontend"]);
    assert.deepEqual(libraryConfig.skill_tags[skillName], ["design", "frontend"]);
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("setRoot preserves existing library tags", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  fs.mkdirSync(libraryRoot, { recursive: true });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {
      saved: ["utility"],
    },
  });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    skillLibrary.setRoot(libraryRoot);
    const libraryConfig = JSON.parse(
      fs.readFileSync(path.join(libraryRoot, ".skill-library-manager.json"), "utf8")
    );

    assert.deepEqual(libraryConfig.skill_tags, {
      saved: ["utility"],
    });
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("statusSnapshot collapses packaged variants from one imported repo", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const repoRoot = path.join(libraryRoot, "impeccable");
  const skillName = "impeccable";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
    link_mode: "junction",
  });
  writeSkill(path.join(repoRoot, ".agents", "skills", skillName), "Codex package.");
  writeSkill(path.join(repoRoot, ".claude", "skills", skillName), "Claude package.");
  writeSkill(path.join(repoRoot, ".cursor", "skills", skillName), "Cursor package.");
  writeSkill(path.join(repoRoot, "plugin", "skills", skillName), "Plugin package.");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const rows = snapshot.skills.filter((skill) => skill.name === skillName);

    assert.equal(snapshot.error, undefined);
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].path,
      path.join(repoRoot, ".agents", "skills", skillName)
    );
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("statusSnapshot still reports duplicate names across separate sources", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const skillName = "shared";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
    link_mode: "junction",
  });
  writeSkill(path.join(libraryRoot, "first", "skills", skillName), "First copy.");
  writeSkill(path.join(libraryRoot, "second", "skills", skillName), "Second copy.");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const snapshot = skillLibrary.statusSnapshot(projectRoot);

    assert.match(snapshot.error, /Duplicate skill names found in library:/);
    assert.match(snapshot.error, new RegExp(`- ${skillName}`));
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("enableSkill copies nested files into the repo install target", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const skillName = "copied-skill";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {},
  });
  writeSkill(path.join(libraryRoot, skillName), "Library copy.");
  fs.mkdirSync(path.join(libraryRoot, skillName, "nested"), { recursive: true });
  fs.writeFileSync(
    path.join(libraryRoot, skillName, "nested", "helper.txt"),
    "from-library",
    "utf8"
  );
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const result = skillLibrary.enableSkill(skillName, projectRoot, false);
    const entry = path.join(projectRoot, ".agents", "skills", skillName);

    assert.equal(result.status, "enabled");
    assert.equal(fs.lstatSync(entry).isSymbolicLink(), false);
    assert.equal(
      fs.readFileSync(path.join(entry, "nested", "helper.txt"), "utf8"),
      "from-library"
    );
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("enableSkill blocks a modified copied install until force is set", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const skillName = "copied-skill";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {},
  });
  writeSkill(path.join(libraryRoot, skillName), "Library copy.");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    skillLibrary.enableSkill(skillName, projectRoot, false);
    fs.writeFileSync(
      path.join(projectRoot, ".agents", "skills", skillName, "local-note.txt"),
      "local edit",
      "utf8"
    );

    const blocked = skillLibrary.enableSkill(skillName, projectRoot, false);

    assert.equal(blocked.status, "blocked-modified");
    assert.equal(
      fs.readFileSync(
        path.join(projectRoot, ".agents", "skills", skillName, "local-note.txt"),
        "utf8"
      ),
      "local edit"
    );

    const replaced = skillLibrary.enableSkill(skillName, projectRoot, true);

    assert.equal(replaced.status, "replaced");
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".agents", "skills", skillName, "local-note.txt")),
      false
    );
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("enableSkill replaces a legacy junction with a copied directory", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const skillName = "legacy-link";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {},
  });
  writeSkill(path.join(libraryRoot, skillName), "Library copy.");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, ".agents", "skills"), { recursive: true });
  fs.symlinkSync(
    path.resolve(path.join(libraryRoot, skillName)),
    path.join(projectRoot, ".agents", "skills", skillName),
    process.platform === "win32" ? "junction" : "dir"
  );

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const result = skillLibrary.enableSkill(skillName, projectRoot, false);
    const entry = path.join(projectRoot, ".agents", "skills", skillName);

    assert.equal(result.status, "migrated-link");
    assert.equal(fs.lstatSync(entry).isSymbolicLink(), false);
    assert.equal(
      fs.readFileSync(path.join(entry, "SKILL.md"), "utf8").includes(skillName),
      true
    );
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("installGlobalSkill copies nested files into Codex home", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const skillName = "global-copy";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {},
  });
  writeSkill(path.join(libraryRoot, skillName), "Global library copy.");
  fs.mkdirSync(path.join(libraryRoot, skillName, "assets"), { recursive: true });
  fs.writeFileSync(path.join(libraryRoot, skillName, "assets", "note.txt"), "asset", "utf8");

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    const result = skillLibrary.installGlobalSkill(skillName, false);
    const entry = path.join(codeHome, "skills", skillName);

    assert.equal(result.status, "installed");
    assert.equal(fs.lstatSync(entry).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(entry, "assets", "note.txt"), "utf8"), "asset");
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("statusSnapshot keeps modified copied installs marked as installed", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-manager-"));
  const codeHome = path.join(tempRoot, ".codex");
  const libraryRoot = path.join(tempRoot, "library");
  const projectRoot = path.join(tempRoot, "project");
  const skillName = "snapshot-copy";

  writeJson(path.join(codeHome, "local-skill-library.json"), {
    schema_version: 1,
    library_root: libraryRoot,
  });
  writeJson(path.join(libraryRoot, ".skill-library-manager.json"), {
    schema_version: 1,
    link_mode: "junction",
    skill_tags: {},
  });
  writeSkill(path.join(libraryRoot, skillName), "Snapshot copy.");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });

  const originalCodeHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codeHome;

  try {
    skillLibrary.enableSkill(skillName, projectRoot, false);
    skillLibrary.installGlobalSkill(skillName, false);
    fs.writeFileSync(
      path.join(projectRoot, ".agents", "skills", skillName, "local-note.txt"),
      "repo edit",
      "utf8"
    );

    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const row = snapshot.skills.find((skill) => skill.name === skillName);

    assert.equal(row.installed, true);
    assert.equal(row.global_installed, true);
    assert.equal(row.conflict, false);
    assert.equal(row.project_install_state, "copied-modified");
    assert.equal(row.global_install_state, "copied-match");
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
