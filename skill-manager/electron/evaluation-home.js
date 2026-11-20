const fs = require("fs");
const os = require("os");
const path = require("path");

class EvaluationHomeError extends Error {}

// A copied OAuth credentials file is a trap: the first copy to refresh rotates
// the refresh token and strands the original and every other copy. A long-lived
// token in the environment (`claude setup-token`) never rotates, so when it is
// present the home carries no credentials file at all and the CLI reads the
// token from the environment it inherits.
const AGENT_HOME_PROFILES = {
  claude: {
    envVarName: "CLAUDE_CONFIG_DIR",
    defaultSource: () => path.join(os.homedir(), ".claude"),
    credentialFilenames: [".credentials.json"],
    optionalFilenames: [],
    tokenEnvVar: "CLAUDE_CODE_OAUTH_TOKEN",
  },
  codex: {
    envVarName: "CODEX_HOME",
    defaultSource: () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    credentialFilenames: ["auth.json"],
    optionalFilenames: ["config.toml"],
    tokenEnvVar: null,
  },
};

const CREDENTIAL_SOURCES = ["copied-file", "environment-token", "inherited"];

// Records written before the credential source was tracked carry only the
// copied filenames; the source follows from them, since an isolated home with
// nothing copied can only have authenticated from the environment.
function defaultCredentialSource({ copiedFilenames = [], inheritedFrom = null }) {
  if (inheritedFrom) {
    return "inherited";
  }
  return copiedFilenames.length > 0 ? "copied-file" : "environment-token";
}

class AgentHome {
  constructor({
    agent,
    homePath,
    envVarName,
    isolation,
    copiedFilenames,
    inheritedFrom = null,
    credentialSource = defaultCredentialSource({ copiedFilenames, inheritedFrom }),
  }) {
    if (!CREDENTIAL_SOURCES.includes(credentialSource)) {
      throw new EvaluationHomeError(
        `Credential source must be one of ${CREDENTIAL_SOURCES.join(", ")}, received ${JSON.stringify(credentialSource)}.`
      );
    }
    this.agent = agent;
    this.homePath = homePath;
    this.envVarName = envVarName;
    this.isolation = isolation;
    this.copiedFilenames = Object.freeze([...copiedFilenames]);
    this.credentialSource = credentialSource;
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
      credentialSource: this.credentialSource,
      inheritedFrom: this.inheritedFrom,
    };
  }
}

class IsolatedAgentHome {
  constructor({ fileSystem = fs, profiles = AGENT_HOME_PROFILES, env = process.env } = {}) {
    this.fileSystem = fileSystem;
    this.profiles = profiles;
    this.env = env;
  }

  tokenInEnvironment(profile) {
    const value = profile.tokenEnvVar ? this.env[profile.tokenEnvVar] : null;
    return typeof value === "string" && value.trim() !== "";
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
    const tokenPresent = this.tokenInEnvironment(profile);
    const missing = [];
    const copied = [];
    this.fileSystem.rmSync(homePath, { recursive: true, force: true });
    this.fileSystem.mkdirSync(homePath, { recursive: true });
    for (const filename of tokenPresent ? [] : profile.credentialFilenames) {
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
        credentialSource: "inherited",
        inheritedFrom: source,
      });
    }
    return new AgentHome({
      agent,
      homePath,
      envVarName: profile.envVarName,
      isolation: "isolated",
      copiedFilenames: copied,
      credentialSource: tokenPresent ? "environment-token" : "copied-file",
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
