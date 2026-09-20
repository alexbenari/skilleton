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

// The CLIs are frequently installed outside PATH, so an explicit path wins over
// a bare command name that would only resolve for a lucky shell.
function resolveCliPaths({ env = process.env, appConfig = null } = {}) {
  const stored = appConfig ? appConfig.evaluation || {} : {};
  return {
    codex: env[CODEX_CLI_ENV_VAR] || stored.codexCliPath || "codex",
    claude: env[CLAUDE_CLI_ENV_VAR] || stored.claudeCliPath || "claude",
  };
}

module.exports = {
  appRootPath,
  resolveCatalogRoot,
  resolveStoreRoot,
  resolveCliPaths,
  CATALOG_ENV_VAR,
  STORE_ENV_VAR,
  CODEX_CLI_ENV_VAR,
  CLAUDE_CLI_ENV_VAR,
};
