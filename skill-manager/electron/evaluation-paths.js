const fs = require("fs");
const os = require("os");
const path = require("path");

const CATALOG_ENV_VAR = "SKILL_MANAGER_EVALUATION_CATALOG";
const STORE_ENV_VAR = "SKILL_MANAGER_EVALUATION_ROOT";
const CODEX_CLI_ENV_VAR = "SKILL_MANAGER_CODEX_CLI";
const CLAUDE_CLI_ENV_VAR = "SKILL_MANAGER_CLAUDE_CLI";

function appRootPath() {
  return path.resolve(__dirname, "..");
}

function resolveCatalogRoot({ env = process.env, override = null } = {}) {
  return override || env[CATALOG_ENV_VAR] || path.join(appRootPath(), "evaluations");
}

function resolveStoreRoot({ env = process.env, override = null, userDataPath = null } = {}) {
  if (override) {
    return override;
  }
  if (env[STORE_ENV_VAR]) {
    return env[STORE_ENV_VAR];
  }
  if (userDataPath) {
    return path.join(userDataPath, "evaluations");
  }
  return path.join(appRootPath(), "evaluations-data");
}

// Neither CLI is reliably on PATH: Codex installs under a hashed directory, and
// Claude's own installer only updates the PATH of shells started afterwards. An
// Electron app launched from a desktop shortcut inherits neither, so the app
// looks in the places the installers actually use before giving up.
const CLI_SEARCH_PATHS = {
  codex: ({ env, homeDirectory }) => [
    path.join(env.LOCALAPPDATA || path.join(homeDirectory, "AppData", "Local"), "OpenAI", "Codex", "bin", "*", "codex.exe"),
    path.join(homeDirectory, ".local", "bin", "codex.exe"),
    path.join(env.APPDATA || path.join(homeDirectory, "AppData", "Roaming"), "npm", "codex.cmd"),
  ],
  claude: ({ env, homeDirectory }) => [
    path.join(homeDirectory, ".local", "bin", "claude.exe"),
    path.join(env.APPDATA || path.join(homeDirectory, "AppData", "Roaming"), "Claude", "claude-code", "*", "claude.exe"),
    path.join(env.APPDATA || path.join(homeDirectory, "AppData", "Roaming"), "npm", "claude.cmd"),
  ],
};

// The one wildcard stands for a whole path segment: Codex installs under a
// build hash and Claude under a version number, and the newest wins.
function newestMatch(pattern, fileSystem) {
  const segments = pattern.split(path.sep);
  const starIndex = segments.indexOf("*");
  if (starIndex === -1) {
    return fileSystem.existsSync(pattern) ? pattern : null;
  }
  const parent = segments.slice(0, starIndex).join(path.sep);
  const remainder = segments.slice(starIndex + 1).join(path.sep);
  if (!fileSystem.existsSync(parent)) {
    return null;
  }
  const candidates = fileSystem
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name, remainder))
    .filter((candidate) => fileSystem.existsSync(candidate))
    .map((candidate) => ({ candidate, modifiedMs: fileSystem.statSync(candidate).mtimeMs }))
    .sort((left, right) => right.modifiedMs - left.modifiedMs);
  return candidates.length > 0 ? candidates[0].candidate : null;
}

function discoverCliPath(agent, { env = process.env, fileSystem = fs, homeDirectory = os.homedir() } = {}) {
  const build = CLI_SEARCH_PATHS[agent];
  if (!build) {
    return null;
  }
  for (const pattern of build({ env, homeDirectory })) {
    const found = newestMatch(pattern, fileSystem);
    if (found) {
      return found;
    }
  }
  return null;
}

// An explicit path wins over a bare command name that would only resolve for a
// lucky shell; discovery wins over nothing at all.
function resolveCliPaths({ env = process.env, appConfig = null, fileSystem = fs } = {}) {
  const stored = appConfig ? appConfig.evaluation || {} : {};
  return {
    codex:
      env[CODEX_CLI_ENV_VAR] ||
      stored.codexCliPath ||
      discoverCliPath("codex", { env, fileSystem }) ||
      "codex",
    claude:
      env[CLAUDE_CLI_ENV_VAR] ||
      stored.claudeCliPath ||
      discoverCliPath("claude", { env, fileSystem }) ||
      "claude",
  };
}

module.exports = {
  appRootPath,
  resolveCatalogRoot,
  resolveStoreRoot,
  resolveCliPaths,
  discoverCliPath,
  CLI_SEARCH_PATHS,
  CATALOG_ENV_VAR,
  STORE_ENV_VAR,
  CODEX_CLI_ENV_VAR,
  CLAUDE_CLI_ENV_VAR,
};
