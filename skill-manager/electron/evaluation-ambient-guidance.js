const fs = require("fs");
const os = require("os");
const path = require("path");

const { listDirectoryNames } = require("./evaluation-fs");

class AmbientGuidanceError extends Error {}

// What each agent still reads once its home is isolated, measured on
// 2026-09-20 against codex-cli 0.155.0-alpha.9.2 and Claude Code 2.1.275.
//
// Codex keeps reading ~/.agents/skills whatever CODEX_HOME, USERPROFILE and
// HOME say, and offers no config key to disable it. Its own $CODEX_HOME/skills
// does move with the relocated home, so an isolated run does not see it.
//
// Claude relocates cleanly: with CLAUDE_CONFIG_DIR pointed elsewhere, a run saw
// none of the user's ~/.claude/skills, and it does not read ~/.agents/skills at
// all, which is a Codex convention. What it does carry is the skills bundled
// with the CLI itself, which are not on any root the app can enumerate.
const GLOBAL_SKILL_ROOTS = {
  codex: ({ isolated = true } = {}) =>
    isolated
      ? [path.join(os.homedir(), ".agents", "skills")]
      : [
          path.join(os.homedir(), ".agents", "skills"),
          path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills"),
        ],
  claude: ({ isolated = true } = {}) =>
    isolated ? [] : [path.join(os.homedir(), ".claude", "skills")],
};

const BUNDLED_SKILLS_NOTE = {
  claude:
    "Claude Code ships its own skills, which are present in every run and are not on any " +
    "root this app can enumerate. A subject sharing a name with one of them is not detected " +
    "here; the per-run contamination check catches it from the transcript instead.",
  codex: null,
};

class AmbientGuidance {
  constructor({ agent, roots, isolated = true, bundledSkillsNote = null }) {
    this.agent = agent;
    this.roots = Object.freeze(roots.map((root) => Object.freeze({ ...root })));
    this.isolated = isolated;
    this.bundledSkillsNote = bundledSkillsNote;
    Object.freeze(this);
  }

  skillNames() {
    return [...new Set(this.roots.flatMap((root) => root.skillNames))].sort();
  }

  has(skillName) {
    return this.skillNames().includes(skillName);
  }

  toJSON() {
    return {
      agent: this.agent,
      roots: this.roots.map((root) => ({ ...root })),
      skillCount: this.skillNames().length,
      skillNames: this.skillNames(),
      isolated: this.isolated,
      bundledSkillsNote: this.bundledSkillsNote,
    };
  }
}

function scanAmbientGuidance({
  agent,
  isolated = true,
  fileSystem = fs,
  rootsFor = GLOBAL_SKILL_ROOTS,
} = {}) {
  const resolve = rootsFor[agent];
  if (!resolve) {
    throw new AmbientGuidanceError(
      `No ambient guidance roots known for agent ${JSON.stringify(agent)}.`
    );
  }
  const roots = resolve({ isolated }).map((rootPath) => {
    if (!fileSystem.existsSync(rootPath)) {
      return { path: rootPath, present: false, skillNames: [] };
    }
    const skillNames = listDirectoryNames(rootPath, fileSystem);
    return { path: rootPath, present: true, skillNames };
  });
  return new AmbientGuidance({
    agent,
    roots,
    isolated,
    bundledSkillsNote: BUNDLED_SKILLS_NOTE[agent] || null,
  });
}

// Root scanning is a prediction; this is the measurement. Any guidance the
// other arm carried that shows up in this arm's transcript means the arms were
// not separated, whatever the roots suggested.
function detectContamination({
  transcriptPath,
  ownGuidanceSet,
  otherGuidanceSet,
  fileSystem = fs,
}) {
  const ownNames = new Set(ownGuidanceSet.subjects.map((subject) => subject.name));
  const watched = otherGuidanceSet.subjects
    .map((subject) => subject.name)
    .filter((name) => !ownNames.has(name));
  if (watched.length === 0 || !transcriptPath || !fileSystem.existsSync(transcriptPath)) {
    return [];
  }
  let transcript = "";
  try {
    transcript = fileSystem.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }
  return watched
    .filter((name) => transcript.includes(name))
    .map((name) => ({
      subjectName: name,
      evidence: `${name} appears in this arm's transcript although it was not activated for it.`,
    }));
}

// A subject that is also installed globally reaches the baseline arm too, so an
// "absent" comparison against it would measure nothing. That is worth refusing
// rather than reporting, because the report would look normal.
function assertNoAmbientCollision(guidanceSets, ambient) {
  const collisions = [];
  for (const guidanceSet of guidanceSets) {
    for (const subject of guidanceSet.ofKind("skill")) {
      if (ambient.has(subject.name)) {
        collisions.push(subject.name);
      }
    }
  }
  if (collisions.length > 0) {
    const names = [...new Set(collisions)].sort();
    throw new AmbientGuidanceError(
      `${names.join(", ")} ${names.length === 1 ? "is" : "are"} installed in a global skill root ` +
        `that ${ambient.agent} always reads (${ambient.roots
          .filter((root) => root.present)
          .map((root) => root.path)
          .join(", ")}), so every arm would load ${names.length === 1 ? "it" : "them"} regardless ` +
        "of this evaluation. Uninstall globally before comparing, or choose a different subject."
    );
  }
}

module.exports = {
  AmbientGuidanceError,
  detectContamination,
  BUNDLED_SKILLS_NOTE,
  AmbientGuidance,
  scanAmbientGuidance,
  assertNoAmbientCollision,
  GLOBAL_SKILL_ROOTS,
};
