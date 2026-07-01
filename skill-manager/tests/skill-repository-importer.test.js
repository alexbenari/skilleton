const test = require("node:test");
const assert = require("node:assert/strict");

const { SkillRepositoryImporter } = require("../electron/skill-repository-importer");

test("addSkillsFromRepository returns a duplicate-name result without upserting", () => {
  let upsertCalled = false;
  const importer = new SkillRepositoryImporter({
    db: {
      listSkills() {
        return [
          {
            id: 11,
            name: "alpha-review",
            localPath: "D:\\libraries\\alpha\\existing\\alpha-review",
          },
        ];
      },
      upsertSkills() {
        upsertCalled = true;
      },
    },
    discovery: {
      discoverSkillsUnderPath() {
        return {
          found: new Map([
            [
              "alpha-review",
              {
                name: "alpha-review",
                path: "D:\\libraries\\alpha\\new-pack\\alpha-review",
                localPath: "D:\\libraries\\alpha\\new-pack\\alpha-review",
                description: "Review helper.",
                source: "new-pack",
              },
            ],
          ]),
          collisions: new Map(),
        };
      },
      failOnCollisions() {},
    },
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runGit() {},
  });

  const result = importer.addSkillsFromRepository({
    libraryId: 3,
    libraryRoot: "D:\\libraries\\alpha",
    repoUrl: "https://github.com/example/new-pack",
  });

  assert.equal(result.status, "duplicate-name");
  assert.equal(result.duplicateName, "alpha-review");
  assert.equal(result.existingSkillId, 11);
  assert.equal(upsertCalled, false);
});

test("addSkillsFromRepository returns cleanupOffered when the clone has no skills", () => {
  const importer = new SkillRepositoryImporter({
    db: {
      listSkills() {
        return [];
      },
      upsertSkills() {
        throw new Error("upsertSkills should not be called");
      },
    },
    discovery: {
      discoverSkillsUnderPath() {
        return { found: new Map(), collisions: new Map() };
      },
      failOnCollisions() {},
    },
    fileSystem: {
      existsSync() {
        return false;
      },
    },
    runGit() {},
  });

  const result = importer.addSkillsFromRepository({
    libraryId: 3,
    libraryRoot: "D:\\libraries\\alpha",
    repoUrl: "https://github.com/example/empty-pack",
  });

  assert.equal(result.status, "no-skills-found");
  assert.equal(result.cleanupOffered, true);
  assert.equal(result.destination, "D:\\libraries\\alpha\\empty-pack");
});

test("cleanupClonedDestination refuses to delete outside the selected library root", () => {
  const importer = new SkillRepositoryImporter({
    db: {},
    discovery: {},
    fileSystem: {
      existsSync() {
        return true;
      },
      rmSync() {
        throw new Error("rmSync should not be called");
      },
    },
  });

  assert.throws(
    () =>
      importer.cleanupClonedDestination({
        libraryRoot: "D:\\libraries\\alpha",
        destination: "D:\\somewhere-else\\pack",
      }),
    /outside the selected library root/
  );
});
