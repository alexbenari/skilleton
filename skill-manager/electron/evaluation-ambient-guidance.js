const fs = require("fs");
const os = require("os");
const path = require("path");

const { listDirectoryNames } = require("./evaluation-fs");

class AmbientGuidanceError extends Error {}

// Codex reads these roots no matter what CODEX_HOME, USERPROFILE or HOME say,
// and offers no config key to disable them, so the app can only see them and
// report them. Verified on 2026-09-20 against codex-cli 0.155.0-alpha.9.2.
const GLOBAL_SKILL_ROOTS = {
  codex: () => [
    path.join(os.homedir(), ".agents", "skills"),
    path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills"),
  ],
  claude: () => [
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  ],
};

class AmbientGuidance {
  constructor({ agent, roots }) {
    this.agent = agent;
    this.roots = Object.freeze(roots.map((root) => Object.freeze({ ...root })));
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
    };
  }
}

function scanAmbientGuidance({ agent, fileSystem = fs, rootsFor = GLOBAL_SKILL_ROOTS } = {}) {
  const resolve = rootsFor[agent];
  if (!resolve) {
    throw new AmbientGuidanceError(
      `No ambient guidance roots known for agent ${JSON.stringify(agent)}.`
    );
  }
  const roots = resolve().map((rootPath) => {
    if (!fileSystem.existsSync(rootPath)) {
      return { path: rootPath, present: false, skillNames: [] };
    }
    const skillNames = listDirectoryNames(rootPath, fileSystem);
    return { path: rootPath, present: true, skillNames };
  });
  return new AmbientGuidance({ agent, roots });
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
  AmbientGuidance,
  scanAmbientGuidance,
  assertNoAmbientCollision,
  GLOBAL_SKILL_ROOTS,
};
