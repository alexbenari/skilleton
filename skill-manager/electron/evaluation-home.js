const fs = require("fs");
const os = require("os");
const path = require("path");

class EvaluationHomeError extends Error {}

const AGENT_HOME_PROFILES = {
  claude: {
    envVarName: "CLAUDE_CONFIG_DIR",
    defaultSource: () => path.join(os.homedir(), ".claude"),
    credentialFilenames: [".credentials.json"],
    optionalFilenames: [],
  },
  codex: {
    envVarName: "CODEX_HOME",
    defaultSource: () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    credentialFilenames: ["auth.json"],
    optionalFilenames: ["config.toml"],
  },
};

class AgentHome {
  constructor({ agent, homePath, envVarName, isolation, copiedFilenames, inheritedFrom = null }) {
    this.agent = agent;
    this.homePath = homePath;
    this.envVarName = envVarName;
    this.isolation = isolation;
    this.copiedFilenames = Object.freeze([...copiedFilenames]);
    this.inheritedFrom = inheritedFrom;
    Object.freeze(this);
  }

  isIsolated() {
    return this.isolation === "isolated";
  }

  environment() {
    return { [this.envVarName]: this.homePath };
  }

  toJSON() {
    return {
      agent: this.agent,
      homePath: this.homePath,
      envVarName: this.envVarName,
      isolation: this.isolation,
      copiedFilenames: [...this.copiedFilenames],
      inheritedFrom: this.inheritedFrom,
    };
  }
}

class IsolatedAgentHome {
  constructor({ fileSystem = fs, profiles = AGENT_HOME_PROFILES } = {}) {
    this.fileSystem = fileSystem;
    this.profiles = profiles;
  }

  profileFor(agent) {
    const profile = this.profiles[agent];
    if (!profile) {
      throw new EvaluationHomeError(
        `No home profile for agent ${JSON.stringify(agent)}; known agents are ${Object.keys(
          this.profiles
        ).join(", ")}.`
      );
    }
    return profile;
  }

  // Copying only credentials is what removes the user's global skills, rules,
  // instruction files, plugins, and MCP servers from the run in one step.
  create({ agent, homePath, sourcePath = null, allowInheritedHome = false, optionalFiles = {} }) {
    const profile = this.profileFor(agent);
    const source = sourcePath || profile.defaultSource();
    const missing = [];
    const copied = [];
    this.fileSystem.rmSync(homePath, { recursive: true, force: true });
    this.fileSystem.mkdirSync(homePath, { recursive: true });
    for (const filename of profile.credentialFilenames) {
      const from = path.join(source, filename);
      if (!this.fileSystem.existsSync(from)) {
        missing.push(from);
        continue;
      }
      this.fileSystem.copyFileSync(from, path.join(homePath, filename));
      copied.push(filename);
    }
    for (const filename of profile.optionalFilenames) {
      const from = path.join(source, filename);
      if (this.fileSystem.existsSync(from)) {
        this.fileSystem.copyFileSync(from, path.join(homePath, filename));
        copied.push(filename);
      }
    }
    for (const [filename, contents] of Object.entries(optionalFiles)) {
      this.fileSystem.writeFileSync(path.join(homePath, filename), contents, "utf8");
      copied.push(filename);
    }
    if (missing.length > 0) {
      if (!allowInheritedHome) {
        throw new EvaluationHomeError(
          `Cannot isolate the ${agent} home: ${missing.join(", ")} not found. ` +
            "Without it the run would fall back to the user's home and inherit global " +
            "skills and instruction files, which invalidates the comparison."
        );
      }
      this.fileSystem.rmSync(homePath, { recursive: true, force: true });
      return new AgentHome({
        agent,
        homePath: source,
        envVarName: profile.envVarName,
        isolation: "inherited",
        copiedFilenames: [],
        inheritedFrom: source,
      });
    }
    return new AgentHome({
      agent,
      homePath,
      envVarName: profile.envVarName,
      isolation: "isolated",
      copiedFilenames: copied,
    });
  }

  discard(home) {
    if (home.isIsolated()) {
      this.fileSystem.rmSync(home.homePath, { recursive: true, force: true });
    }
  }
}

module.exports = {
  EvaluationHomeError,
  IsolatedAgentHome,
  AgentHome,
  AGENT_HOME_PROFILES,
};
