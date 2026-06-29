# Skill Install Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace link-based project and global skill installs with real copied directories, including refresh, modified-copy conflict detection, and legacy link migration.

**Architecture:** Keep the core behavior in `electron/skill-library.js` by replacing junction creation with recursive copy helpers and richer install-state classification. Thread structured install outcomes through the Electron IPC layer so `ui/renderer.js` can distinguish normal refreshes from user-confirmable overwrite conflicts without duplicating filesystem logic.

**Tech Stack:** Electron, plain Node.js filesystem APIs, `node:test`

---

### Task 1: Prove the copy-install contract in library tests

**Files:**
- Modify: `C:/dev/skill-library-manager/tests/skill-library.test.js`
- Modify: `C:/dev/skill-library-manager/electron/skill-library.js`

- [ ] **Step 1: Write the failing tests**

```js
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

test("enableSkill reports a modified copied install before replacement", () => {
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
    const replaced = skillLibrary.enableSkill(skillName, projectRoot, true);

    assert.equal(blocked.status, "blocked-modified");
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
    assert.equal(fs.readFileSync(path.join(entry, "SKILL.md"), "utf8").includes(skillName), true);
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `node --test C:/dev/skill-library-manager/tests/skill-library.test.js`
Expected: FAIL with assertions around `enableSkill()` still creating links or not returning copy-aware statuses.

- [ ] **Step 3: Write the minimal implementation in the library layer**

```js
function copyDirectory(sourcePath, targetPath) {
  removePath(targetPath);
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function compareDirectoryTrees(sourcePath, targetPath) {
  const sourceEntries = listRelativeEntries(sourcePath);
  const targetEntries = listRelativeEntries(targetPath);
  if (sourceEntries.length !== targetEntries.length) {
    return false;
  }
  for (let index = 0; index < sourceEntries.length; index += 1) {
    const sourceEntry = sourceEntries[index];
    const targetEntry = targetEntries[index];
    if (sourceEntry.relativePath !== targetEntry.relativePath) {
      return false;
    }
    if (sourceEntry.kind !== targetEntry.kind) {
      return false;
    }
    if (sourceEntry.kind === "file") {
      const sourceBuffer = fs.readFileSync(path.join(sourcePath, sourceEntry.relativePath));
      const targetBuffer = fs.readFileSync(path.join(targetPath, targetEntry.relativePath));
      if (!sourceBuffer.equals(targetBuffer)) {
        return false;
      }
    }
  }
  return true;
}

function installState(entryPath, skillPath) {
  if (!fs.existsSync(entryPath)) {
    return { state: "missing" };
  }
  const stats = fs.lstatSync(entryPath);
  if (stats.isSymbolicLink()) {
    return normalizePath(entryPath) === normalizePath(skillPath)
      ? { state: "linked-match" }
      : { state: "foreign-conflict" };
  }
  if (!stats.isDirectory() || !fs.existsSync(path.join(entryPath, SKILL_FILENAME))) {
    return { state: "foreign-conflict" };
  }
  return compareDirectoryTrees(skillPath, entryPath)
    ? { state: "copied-match" }
    : { state: "copied-modified" };
}

function enableSkill(skillName, project = null, force = false) {
  const { skills } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const projectRoot = resolveProjectRoot(project);
  const entry = projectSkillPath(projectRoot, skill.name);
  const current = installState(entry, skill.path);

  if (current.state === "missing") {
    copyDirectory(skill.path, entry);
    return { skill: skill.name, projectRoot, entry, path: skill.path, status: "enabled" };
  }
  if (current.state === "linked-match") {
    copyDirectory(skill.path, entry);
    return { skill: skill.name, projectRoot, entry, path: skill.path, status: "migrated-link" };
  }
  if (current.state === "copied-match") {
    copyDirectory(skill.path, entry);
    return { skill: skill.name, projectRoot, entry, path: skill.path, status: "refreshed" };
  }
  if ((current.state === "copied-modified" || current.state === "foreign-conflict") && !force) {
    return { skill: skill.name, projectRoot, entry, path: skill.path, status: "blocked-modified" };
  }
  copyDirectory(skill.path, entry);
  return { skill: skill.name, projectRoot, entry, path: skill.path, status: "replaced" };
}
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `node --test C:/dev/skill-library-manager/tests/skill-library.test.js`
Expected: PASS for the new copy-install tests and existing snapshot coverage.

- [ ] **Step 5: Commit**

```bash
git add C:/dev/skill-library-manager/electron/skill-library.js C:/dev/skill-library-manager/tests/skill-library.test.js
git commit -m "feat: copy installed skills into project and global scopes"
```

### Task 2: Extend global install and snapshot semantics to match the copy model

**Files:**
- Modify: `C:/dev/skill-library-manager/tests/skill-library.test.js`
- Modify: `C:/dev/skill-library-manager/electron/skill-library.js`

- [ ] **Step 1: Write the failing tests**

```js
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

test("statusSnapshot marks copied project and global installs as installed", () => {
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

    const snapshot = skillLibrary.statusSnapshot(projectRoot);
    const row = snapshot.skills.find((skill) => skill.name === skillName);

    assert.equal(row.installed, true);
    assert.equal(row.global_installed, true);
    assert.equal(row.conflict, false);
    assert.equal(row.global_conflict, false);
  } finally {
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `node --test C:/dev/skill-library-manager/tests/skill-library.test.js`
Expected: FAIL with assertions around global installs or snapshot state still assuming links.

- [ ] **Step 3: Implement the matching global and snapshot behavior**

```js
function applyScopeState(row, entryPath, skillPath, installedKey, conflictKey, entryKey, targetKey) {
  const current = installState(entryPath, skillPath);
  row[installedKey] = current.state === "copied-match" || current.state === "copied-modified" || current.state === "linked-match";
  row[conflictKey] = current.state === "foreign-conflict";
  if (row[conflictKey]) {
    row[entryKey] = entryPath;
    try {
      row[targetKey] = fs.realpathSync.native(entryPath);
    } catch {
      // ignore
    }
  }
}

function installGlobalSkill(skillName, force = false) {
  const { skills } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const entry = globalSkillPath(skill.name);
  const current = installState(entry, skill.path);

  if (current.state === "missing") {
    copyDirectory(skill.path, entry);
    return { skill: skill.name, entry, path: skill.path, globalRoot: globalSkillsRoot(), status: "installed" };
  }
  if (current.state === "linked-match") {
    copyDirectory(skill.path, entry);
    return { skill: skill.name, entry, path: skill.path, globalRoot: globalSkillsRoot(), status: "migrated-link" };
  }
  if (current.state === "copied-match") {
    copyDirectory(skill.path, entry);
    return { skill: skill.name, entry, path: skill.path, globalRoot: globalSkillsRoot(), status: "refreshed" };
  }
  if ((current.state === "copied-modified" || current.state === "foreign-conflict") && !force) {
    return { skill: skill.name, entry, path: skill.path, globalRoot: globalSkillsRoot(), status: "blocked-modified" };
  }
  copyDirectory(skill.path, entry);
  return { skill: skill.name, entry, path: skill.path, globalRoot: globalSkillsRoot(), status: "replaced" };
}
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `node --test C:/dev/skill-library-manager/tests/skill-library.test.js`
Expected: PASS for both global copy and snapshot semantics.

- [ ] **Step 5: Commit**

```bash
git add C:/dev/skill-library-manager/electron/skill-library.js C:/dev/skill-library-manager/tests/skill-library.test.js
git commit -m "feat: align global installs and snapshots with copied skills"
```

### Task 3: Thread structured outcomes through IPC and UI copy/replace prompts

**Files:**
- Modify: `C:/dev/skill-library-manager/electron/main.js`
- Modify: `C:/dev/skill-library-manager/electron/preload.js`
- Modify: `C:/dev/skill-library-manager/ui/renderer.js`

- [ ] **Step 1: Write the failing interaction expectation as a focused renderer assertion**

```js
// Add a tiny exported helper in ui/renderer.js for message formatting and
// replace confirmation branching, then test it with node:test:
test("copyInstallAction decides when to prompt for replacement", () => {
  assert.deepEqual(describeInstallOutcome("enabled", "repo"), {
    prompt: false,
    message: "Enabled copied skill in this repo.",
  });
  assert.deepEqual(describeInstallOutcome("blocked-modified", "repo"), {
    prompt: true,
    message: "The installed repo copy differs from the library. Replace it?",
  });
});
```

- [ ] **Step 2: Run the focused test or, if no standalone renderer test harness is practical, verify the helper is absent and the check fails**

Run: `node --test C:/dev/skill-library-manager/tests/skill-library.test.js`
Expected: FAIL until the UI-facing outcome mapping exists or until the backend message assertions are updated to the new statuses.

- [ ] **Step 3: Implement the IPC and renderer changes**

```js
// electron/main.js
ipcMain.handle("skill-manager:enable-skill", async (_, skill, project, force) => {
  const result = skillLibrary.enableSkill(skill, project || null, Boolean(force));
  return {
    result,
    message: messageForInstallResult(result, "repo"),
    state: skillLibrary.statusSnapshot(project || null),
  };
});

ipcMain.handle("skill-manager:install-global", async (_, skill, project, force) => {
  const result = skillLibrary.installGlobalSkill(skill, Boolean(force));
  return {
    result,
    message: messageForInstallResult(result, "global"),
    state: skillLibrary.statusSnapshot(project || null),
  };
});

// ui/renderer.js
async function enableSkill(skill, force) {
  const outcome = await runAction(
    () => api.enableSkill(skill, currentProject() || null, force),
    `Copying ${skill} into this repo...`
  );
  if (outcome && outcome.result && outcome.result.status === "blocked-modified" && !force) {
    const confirmed = window.confirm(
      `The installed copy of ${skill} differs from the library.\n\nReplace it with a fresh copy?`
    );
    if (confirmed) {
      await enableSkill(skill, true);
    }
  }
}

async function installGlobalSkill(skill, force) {
  const outcome = await runAction(
    () => api.installGlobalSkill(skill, currentProject() || null, force),
    `Copying ${skill} into global installs...`
  );
  if (outcome && outcome.result && outcome.result.status === "blocked-modified" && !force) {
    const confirmed = window.confirm(
      `The installed global copy of ${skill} differs from the library.\n\nReplace it with a fresh copy?`
    );
    if (confirmed) {
      await installGlobalSkill(skill, true);
    }
  }
}
```

- [ ] **Step 4: Run the regression suite and do a manual smoke pass**

Run: `node --test C:/dev/skill-library-manager/tests/skill-library.test.js`
Expected: PASS

Run: `npm start -- --project=C:\dev\skill-library-manager`
Expected: App opens, repo/global install buttons still work, modified-copy prompt appears only after backend reports `blocked-modified`.

- [ ] **Step 5: Commit**

```bash
git add C:/dev/skill-library-manager/electron/main.js C:/dev/skill-library-manager/electron/preload.js C:/dev/skill-library-manager/ui/renderer.js
git commit -m "feat: prompt before replacing modified copied skills"
```
