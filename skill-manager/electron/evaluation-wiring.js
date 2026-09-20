const { AgentRunner } = require("./evaluation-agent-runner");
const { CheckRunner } = require("./evaluation-check-runner");
const { ClaudeAgentAdapter } = require("./evaluation-agent-claude");
const { CodexAgentAdapter } = require("./evaluation-agent-codex");
const { EvaluationCatalog } = require("./evaluation-catalog");
const { EvaluationService } = require("./evaluation-service");
const { EvaluationStore } = require("./evaluation-store");
const { EvaluationWorkspace } = require("./evaluation-workspace");
const { IsolatedAgentHome } = require("./evaluation-home");
const { resolveCatalogRoot, resolveCliPaths, resolveStoreRoot } = require("./evaluation-paths");

const REVIEW_SANDBOX_ENV_VAR = "SKILL_MANAGER_CODEX_REVIEW_SANDBOX";

function buildAdapters(cliPaths, env = process.env) {
  return {
    codex: new CodexAgentAdapter({
      cliPath: cliPaths.codex,
      reviewSandbox: env[REVIEW_SANDBOX_ENV_VAR] || "read-only",
    }),
    claude: new ClaudeAgentAdapter({ cliPath: cliPaths.claude }),
  };
}

function createEvaluationService({ appConfig = null, userDataPath = null, tempRootPath, env = process.env } = {}) {
  if (!tempRootPath) {
    throw new Error("createEvaluationService needs a tempRootPath.");
  }
  const cliPaths = resolveCliPaths({ env, appConfig });
  return new EvaluationService({
    catalog: new EvaluationCatalog({ rootPath: resolveCatalogRoot({ env }) }),
    store: new EvaluationStore({ rootPath: resolveStoreRoot({ env, userDataPath }) }),
    workspace: new EvaluationWorkspace({ tempRootPath }),
    isolatedHome: new IsolatedAgentHome(),
    runner: new AgentRunner({ adapters: buildAdapters(cliPaths, env) }),
    checkRunner: new CheckRunner(),
    tempRootPath,
  });
}

module.exports = {
  createEvaluationService,
  buildAdapters,
  REVIEW_SANDBOX_ENV_VAR,
};
