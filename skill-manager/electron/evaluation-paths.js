const fs = require("fs");
const os = require("os");
const path = require("path");

const { listDirectoryNames } = require("./evaluation-fs");

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

// An app started from a desktop shortcut finds neither CLI on PATH, so it looks
// where the installers put them. The CLI the Claude desktop app bundles comes
// first, because a stale standalone one refuses newer model ids.
const CLI_SEARCH_PATHS = {
  codex: ({ homeDirectory, localAppData, roamingAppData }) => [
    path.join(localAppData, "OpenAI", "Codex", "bin", "*", "codex.exe"),
    path.join(homeDirectory, ".local", "bin", "codex.exe"),
    path.join(roamingAppData, "npm", "codex.cmd"),
  ],
  claude: ({ homeDirectory, localAppData, roamingAppData }) => [
    path.join(localAppData, "Claude-Data", "*", "claude-code", "*", "*", "claude.exe"),
    path.join(homeDirectory, ".local", "bin", "claude.exe"),
    path.join(roamingAppData, "npm", "claude.cmd"),
  ],
};

// Each wildcard stands for one whole folder name: a package id, a version or a
// build hash.
function matchesOf(pattern, fileSystem) {
  const segments = pattern.split(path.sep);
  const starIndex = segments.indexOf("*");
  if (starIndex === -1) return fileSystem.existsSync(pattern) ? [pattern] : [];
  const parent = segments.slice(0, starIndex).join(path.sep);
  const remainder = segments.slice(starIndex + 1);
  return listDirectoryNames(parent, fileSystem).flatMap((name) =>
    matchesOf(path.join(parent, name, ...remainder), fileSystem)
  );
}

function newestMatch(pattern, fileSystem) {
  const newestFirst = matchesOf(pattern, fileSystem)
    .map((candidate) => ({ candidate, modifiedMs: fileSystem.statSync(candidate).mtimeMs }))
    .sort((left, right) => right.modifiedMs - left.modifiedMs);
  return newestFirst.length > 0 ? newestFirst[0].candidate : null;
}

function discoverCliPath(agent, { env = process.env, fileSystem = fs, homeDirectory = os.homedir() } = {}) {
  const build = CLI_SEARCH_PATHS[agent];
  if (!build) return null;
  const folders = {
    homeDirectory,
    localAppData: env.LOCALAPPDATA || path.join(homeDirectory, "AppData", "Local"),
    roamingAppData: env.APPDATA || path.join(homeDirectory, "AppData", "Roaming"),
  };
  for (const pattern of build(folders)) {
    const found = newestMatch(pattern, fileSystem);
    if (found) return found;
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
  CATALOG_ENV_VAR,
  STORE_ENV_VAR,
  CODEX_CLI_ENV_VAR,
  CLAUDE_CLI_ENV_VAR,
};
