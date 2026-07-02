const test = require("node:test");
const assert = require("node:assert/strict");

const { SkillLibrary } = require("../../electron/skill-library");

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
      gitTrackedRef: null,
      gitImportedRevision: null,
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
      gitTrackedRef: null,
      gitImportedRevision: null,
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
