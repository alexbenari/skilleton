const test = require("node:test");
const assert = require("node:assert/strict");

const { ActiveSkillLibrary } = require("../electron/active-skill-library");
const { SkillLibrary } = require("../electron/skill-library");

function createMemoryAppConfig(initialLastSelectedLibraryId = null) {
  let state = { lastSelectedLibraryId: initialLastSelectedLibraryId };
  return {
    read() {
      return { ...state };
    },
    setLastSelectedLibraryId(libraryId) {
      state = { lastSelectedLibraryId: libraryId };
      return { ...state };
    },
    clearLastSelectedLibraryId() {
      state = { lastSelectedLibraryId: null };
      return { ...state };
    },
  };
}

function createInstallerStub() {
  return {
    globalSkillsRoot() {
      return "D:\\Users\\alex\\.codex\\skills";
    },
    resolveProjectRoot(project) {
      return project || "D:\\projects\\current";
    },
    repoInstallState(skill, projectRoot) {
      return {
        state: "missing",
        projectRoot,
        entryPath: `D:\\projects\\current\\.agents\\skills\\${skill.name}`,
        installed: false,
        conflict: false,
      };
    },
    globalInstallState(skill) {
      return {
        state: "missing",
        entryPath: `D:\\Users\\alex\\.codex\\skills\\${skill.name}`,
        installed: false,
        conflict: false,
      };
    },
  };
}

test("statusSnapshot with multiple libraries and no valid last selected requires selection", () => {
  let listSkillsCalls = 0;
  const service = new ActiveSkillLibrary({
    db: {
      initialize() {},
      listLibraries() {
        return [
          { id: 1, localPath: "D:\\libraries\\alpha" },
          { id: 2, localPath: "D:\\libraries\\beta" },
        ];
      },
      listSkills() {
        listSkillsCalls += 1;
        return [];
      },
    },
    discovery: {},
    installer: createInstallerStub(),
    appConfig: createMemoryAppConfig(null),
    repositoryImporter: {},
    databasePath: "D:\\state\\skill-manager.sqlite",
    appConfigPath: "D:\\state\\skill-manager-config.json",
  });

  const snapshot = service.statusSnapshot("D:\\projects\\current");

  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.librarySelectionRequired, true);
  assert.equal(snapshot.selectedLibraryId, null);
  assert.equal(snapshot.libraries.length, 2);
  assert.equal(listSkillsCalls, 0);
});

test("statusSnapshot with one library reads skills from the DB without discovery", () => {
  let discoveryUsed = false;
  const service = new ActiveSkillLibrary({
    db: {
      initialize() {},
      listLibraries() {
        return [{ id: 7, localPath: "D:\\libraries\\alpha" }];
      },
      listSkills(libraryId) {
        assert.equal(libraryId, 7);
        return [
          {
            id: 11,
            libraryId: 7,
            name: "alpha-review",
            localPath: "D:\\libraries\\alpha\\alpha-review",
            description: "Review helper.",
            source: "alpha",
            gitSourceUrl: null,
            tags: ["review"],
          },
        ];
      },
    },
    discovery: {
      discoverLibrarySkills() {
        discoveryUsed = true;
        return { found: new Map(), collisions: new Map() };
      },
      readSkillMarkdown() {
        return { path: "", content: "" };
      },
    },
    installer: createInstallerStub(),
    appConfig: createMemoryAppConfig(null),
    repositoryImporter: {},
  });

  const snapshot = service.statusSnapshot("D:\\projects\\current");

  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.librarySelectionRequired, false);
  assert.equal(snapshot.selectedLibraryId, 7);
  assert.equal(snapshot.skillCount, 1);
  assert.equal(snapshot.skills[0].name, "alpha-review");
  assert.equal(snapshot.skills[0].tags[0], "review");
  assert.equal(discoveryUsed, false);
});

test("statusSnapshot with multiple libraries uses the stored last selected library", () => {
  const service = new ActiveSkillLibrary({
    db: {
      initialize() {},
      listLibraries() {
        return [
          { id: 1, localPath: "D:\\libraries\\alpha" },
          { id: 2, localPath: "D:\\libraries\\beta" },
        ];
      },
      listSkills(libraryId) {
        assert.equal(libraryId, 2);
        return [
          {
            id: 30,
            libraryId: 2,
            name: "beta-review",
            localPath: "D:\\libraries\\beta\\beta-review",
            description: "Beta review helper.",
            source: "beta",
            gitSourceUrl: null,
            tags: ["review"],
          },
        ];
      },
    },
    discovery: {},
    installer: createInstallerStub(),
    appConfig: createMemoryAppConfig(2),
    repositoryImporter: {},
  });

  const snapshot = service.statusSnapshot("D:\\projects\\current");

  assert.equal(snapshot.librarySelectionRequired, false);
  assert.equal(snapshot.selectedLibraryId, 2);
  assert.equal(snapshot.libraryRoot, "D:\\libraries\\beta");
  assert.equal(snapshot.skills[0].name, "beta-review");
});

test("refreshLibrary uses discovery results to replace DB skills", () => {
  let replaceInput = null;
  const service = new ActiveSkillLibrary({
    db: {
      initialize() {},
      listLibraries() {
        return [{ id: 3, localPath: "D:\\libraries\\alpha" }];
      },
      listSkills() {
        return [];
      },
      replaceLibrarySkills(libraryId, discoveredSkills) {
        assert.equal(libraryId, 3);
        replaceInput = discoveredSkills;
        return [];
      },
    },
    discovery: {
      discoverLibrarySkills() {
        return {
          found: new Map([
            [
              "alpha-review",
              {
                name: "alpha-review",
                path: "D:\\libraries\\alpha\\alpha-review",
                localPath: "D:\\libraries\\alpha\\alpha-review",
                description: "Review helper.",
                source: "alpha",
                gitSourceUrl: null,
              },
            ],
          ]),
          collisions: new Map(),
        };
      },
      failOnCollisions() {},
      skillSourceFromPath() {
        return "alpha";
      },
    },
    installer: createInstallerStub(),
    appConfig: createMemoryAppConfig(null),
    repositoryImporter: {},
    fileSystem: {
      existsSync() {
        return true;
      },
      statSync() {
        return { isDirectory: () => true };
      },
    },
  });

  const result = service.refreshLibrary();

  assert.equal(result.libraryId, 3);
  assert.deepEqual(replaceInput, [
    {
      name: "alpha-review",
      localPath: "D:\\libraries\\alpha\\alpha-review",
      description: "Review helper.",
      source: "alpha",
      gitSourceUrl: null,
    },
  ]);
});

test("setSkillTags normalizes tags through SkillLibrary and returns allTags", () => {
  let setSkillTagsInput = null;
  const skillRows = [
    {
      id: 20,
      libraryId: 2,
      name: "alpha-review",
      localPath: "D:\\libraries\\alpha\\alpha-review",
      description: "Review helper.",
      source: "alpha",
      gitSourceUrl: null,
      tags: ["review"],
    },
    {
      id: 21,
      libraryId: 2,
      name: "alpha-build",
      localPath: "D:\\libraries\\alpha\\alpha-build",
      description: "Build helper.",
      source: "alpha",
      gitSourceUrl: null,
      tags: ["build"],
    },
  ];
  const library = new SkillLibrary({
    libraryId: 2,
    localPath: "D:\\libraries\\alpha",
    db: {
      listSkills() {
        return skillRows;
      },
      setSkillTags(libraryId, skillName, tags) {
        setSkillTagsInput = { libraryId, skillName, tags };
        const row = skillRows.find((skill) => skill.name === skillName);
        row.tags = tags;
      },
    },
    discovery: {},
    installer: createInstallerStub(),
  });

  const result = library.setSkillTags("alpha-review", ["Review", " design ", "review", "bad tag"]);

  assert.deepEqual(setSkillTagsInput, {
    libraryId: 2,
    skillName: "alpha-review",
    tags: ["design", "review"],
  });
  assert.deepEqual(result.tags, ["design", "review"]);
  assert.deepEqual(result.allTags, ["build", "design", "review"]);
});

test("deleteLibrary clears the stored selection when multiple libraries remain", () => {
  const libraries = [
    { id: 1, localPath: "D:\\libraries\\alpha" },
    { id: 2, localPath: "D:\\libraries\\beta" },
    { id: 3, localPath: "D:\\libraries\\gamma" },
  ];
  const appConfig = createMemoryAppConfig(2);
  const service = new ActiveSkillLibrary({
    db: {
      initialize() {},
      listLibraries() {
        return libraries.slice();
      },
      deleteLibrary(libraryId) {
        const index = libraries.findIndex((library) => library.id === libraryId);
        if (index >= 0) {
          libraries.splice(index, 1);
        }
      },
      listSkills() {
        return [];
      },
    },
    discovery: {},
    installer: createInstallerStub(),
    appConfig,
    repositoryImporter: {},
  });

  service.deleteLibrary(2);

  assert.deepEqual(appConfig.read(), { lastSelectedLibraryId: null });
  const snapshot = service.statusSnapshot("D:\\projects\\current");
  assert.equal(snapshot.librarySelectionRequired, true);
  assert.equal(snapshot.selectedLibraryId, null);
  assert.equal(snapshot.libraries.length, 2);
});
