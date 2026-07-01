const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { SkillDiscovery } = require("../electron/skill-discovery");

function writeSkill(dirPath, markdown) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, "SKILL.md"), markdown, "utf8");
}

function cleanup(tempRoot) {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

test("parseSkillMetadata extracts frontmatter name and first sentence description", () => {
  const discovery = new SkillDiscovery({ fileSystem: fs });

  const metadata = discovery.parseSkillMetadata(`---
name: alpha-review
description: "Review helper. Extra detail that should be dropped."
---

# Alpha review
`);

  assert.deepEqual(metadata, {
    name: "alpha-review",
    description: "Review helper.",
  });
});

test("discoverLibrarySkills collapses packaged variants from one imported repo", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-discovery-"));
  const libraryRoot = path.join(tempRoot, "library");
  const repoRoot = path.join(libraryRoot, "alpha-pack");
  const discovery = new SkillDiscovery({ fileSystem: fs });

  try {
    writeSkill(
      path.join(repoRoot, ".agents", "skills", "alpha-review"),
      `---\nname: alpha-review\ndescription: "Codex copy."\n---\n`
    );
    writeSkill(
      path.join(repoRoot, ".claude", "skills", "alpha-review"),
      `---\nname: alpha-review\ndescription: "Claude copy."\n---\n`
    );

    const result = discovery.discoverLibrarySkills(libraryRoot);
    const skill = result.found.get("alpha-review");

    assert.ok(skill);
    assert.equal(skill.path, path.join(repoRoot, ".agents", "skills", "alpha-review"));
    assert.equal(result.collisions.size, 0);
  } finally {
    cleanup(tempRoot);
  }
});

test("discoverLibrarySkills collapses identical-content duplicates to one row", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-discovery-"));
  const libraryRoot = path.join(tempRoot, "library");
  const discovery = new SkillDiscovery({ fileSystem: fs });
  const markdown = `---
name: @alpha/review
description: "Review helper."
---
`;

  try {
    writeSkill(path.join(libraryRoot, "first", "skills", "review"), markdown);
    writeSkill(path.join(libraryRoot, "second", "skills", "review"), markdown);

    const result = discovery.discoverLibrarySkills(libraryRoot);
    const rows = Array.from(result.found.values()).filter((row) => row.name === "@alpha/review");

    assert.equal(rows.length, 1);
    assert.equal(result.collisions.size, 0);
  } finally {
    cleanup(tempRoot);
  }
});

test("skillSourceFromPath derives the repo folder label for nested skills", () => {
  const discovery = new SkillDiscovery({ fileSystem: fs });
  const libraryRoot = "D:\\libraries";
  const skillPath = "D:\\libraries\\alpha-pack\\.agents\\skills\\alpha-review";

  assert.equal(
    discovery.skillSourceFromPath(libraryRoot, skillPath, "alpha-review"),
    "alpha-pack"
  );
});

test("failOnCollisions formats unresolved duplicate names and paths", () => {
  const discovery = new SkillDiscovery({ fileSystem: fs });
  const collisions = new Map([
    [
      "alpha-review",
      ["D:\\libraries\\first\\alpha-review", "D:\\libraries\\second\\alpha-review"],
    ],
  ]);

  assert.throws(
    () => discovery.failOnCollisions(collisions),
    /Duplicate skill names found in library:\n- alpha-review/
  );
});
