const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  SkillLibraryDBError,
  createDBAdapter,
} = require("../../electron/skill-library-db");

function createTempAdapter() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-db-"));
  const databasePath = path.join(tempRoot, "skill-manager.sqlite");
  const adapter = createDBAdapter({ databasePath });
  adapter.initialize();
  return { adapter, tempRoot, databasePath };
}

function cleanupTempRoot(tempRoot) {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

test("setLibrary followed by listLibraries returns the expected local path", () => {
  const { adapter, tempRoot } = createTempAdapter();

  try {
    const library = adapter.setLibrary("D:\\libraries\\alpha");
    const libraries = adapter.listLibraries();

    assert.equal(library.localPath, "D:\\libraries\\alpha");
    assert.deepEqual(
      libraries.map((row) => row.localPath),
      ["D:\\libraries\\alpha"]
    );
  } finally {
    adapter.close();
    cleanupTempRoot(tempRoot);
  }
});

test("replaceLibrarySkills followed by listSkills updates rows and removes absent skills", () => {
  const { adapter, tempRoot } = createTempAdapter();

  try {
    const library = adapter.setLibrary("D:\\libraries\\alpha");

    adapter.replaceLibrarySkills(library.id, [
      {
        name: "alpha-review",
        localPath: "D:\\libraries\\alpha\\alpha-review",
        description: "Review helper.",
        source: "alpha",
        gitSourceUrl: "https://github.com/example/alpha.git",
        gitTrackedRef: "main",
        gitImportedRevision: "1111111",
      },
      {
        name: "alpha-build",
        localPath: "D:\\libraries\\alpha\\alpha-build",
        description: "Build helper.",
        source: "alpha",
        gitSourceUrl: "https://github.com/example/alpha.git",
        gitTrackedRef: "main",
        gitImportedRevision: "1111111",
      },
    ]);

    adapter.replaceLibrarySkills(library.id, [
      {
        name: "alpha-build",
        localPath: "D:\\libraries\\alpha\\alpha-build-v2",
        description: "Build helper v2.",
        source: "alpha-v2",
        gitSourceUrl: "https://github.com/example/alpha-v2.git",
        gitTrackedRef: "release",
        gitImportedRevision: "2222222",
      },
    ]);

    const skills = adapter.listSkills(library.id);

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "alpha-build");
    assert.equal(skills[0].localPath, "D:\\libraries\\alpha\\alpha-build-v2");
    assert.equal(skills[0].description, "Build helper v2.");
    assert.equal(skills[0].source, "alpha-v2");
    assert.equal(skills[0].gitSourceUrl, "https://github.com/example/alpha-v2.git");
    assert.equal(skills[0].gitTrackedRef, "release");
    assert.equal(skills[0].gitImportedRevision, "2222222");
  } finally {
    adapter.close();
    cleanupTempRoot(tempRoot);
  }
});

test("replaceLibrarySkills preserves existing git provenance when refreshed rows omit it", () => {
  const { adapter, tempRoot } = createTempAdapter();

  try {
    const library = adapter.setLibrary("D:\\libraries\\alpha");

    adapter.replaceLibrarySkills(library.id, [
      {
        name: "alpha-review",
        localPath: "D:\\libraries\\alpha\\alpha-review",
        description: "Review helper.",
        source: "alpha",
        gitSourceUrl: "https://github.com/example/alpha.git",
        gitTrackedRef: "main",
        gitImportedRevision: "abc1234",
      },
    ]);

    adapter.replaceLibrarySkills(library.id, [
      {
        name: "alpha-review",
        localPath: "D:\\libraries\\alpha\\alpha-review",
        description: "Review helper refreshed.",
        source: "alpha-refresh",
      },
    ]);

    const skills = adapter.listSkills(library.id);

    assert.equal(skills.length, 1);
    assert.equal(skills[0].description, "Review helper refreshed.");
    assert.equal(skills[0].source, "alpha-refresh");
    assert.equal(skills[0].gitSourceUrl, "https://github.com/example/alpha.git");
    assert.equal(skills[0].gitTrackedRef, "main");
    assert.equal(skills[0].gitImportedRevision, "abc1234");
  } finally {
    adapter.close();
    cleanupTempRoot(tempRoot);
  }
});

test("setSkillTags followed by listSkills returns the expected tags for that skill", () => {
  const { adapter, tempRoot } = createTempAdapter();

  try {
    const library = adapter.setLibrary("D:\\libraries\\alpha");
    adapter.replaceLibrarySkills(library.id, [
      {
        name: "alpha-review",
        localPath: "D:\\libraries\\alpha\\alpha-review",
        description: "Review helper.",
        source: "alpha",
        gitSourceUrl: "https://github.com/example/alpha.git",
      },
    ]);

    adapter.setSkillTags(library.id, "alpha-review", ["design", "review"]);

    const skills = adapter.listSkills(library.id);
    assert.deepEqual(skills[0].tags, ["design", "review"]);
  } finally {
    adapter.close();
    cleanupTempRoot(tempRoot);
  }
});

test("replaceLibrarySkills rolls back when a later row fails validation", () => {
  const { adapter, tempRoot } = createTempAdapter();

  try {
    const library = adapter.setLibrary("D:\\libraries\\alpha");
    adapter.replaceLibrarySkills(library.id, [
      {
        name: "alpha-review",
        localPath: "D:\\libraries\\alpha\\alpha-review",
        description: "Review helper.",
        source: "alpha",
        gitSourceUrl: "https://github.com/example/alpha.git",
      },
    ]);

    assert.throws(
      () =>
        adapter.replaceLibrarySkills(library.id, [
          {
            name: "alpha-build",
            localPath: "D:\\libraries\\alpha\\alpha-build",
            description: "Build helper.",
            source: "alpha",
            gitSourceUrl: "https://github.com/example/alpha.git",
          },
          {
            name: "alpha-broken",
            localPath: "D:\\libraries\\alpha\\alpha-broken",
            description: null,
            source: "alpha",
            gitSourceUrl: "https://github.com/example/alpha.git",
          },
        ]),
      SkillLibraryDBError
    );

    const skills = adapter.listSkills(library.id);
    assert.deepEqual(skills.map((skill) => skill.name), ["alpha-review"]);
  } finally {
    adapter.close();
    cleanupTempRoot(tempRoot);
  }
});
