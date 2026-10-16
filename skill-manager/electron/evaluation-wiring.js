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

// Registered from one place so the Electron entry point and the UI smoke
// harness cannot drift apart on channel names or payload shapes.
function registerEvaluationIpc(ipcMain, { getService, setService, sendProgress, onOpenPath }) {
  const service = () => getService();
  ipcMain.handle("skill-manager:evaluation-list-catalog", async () => service().listCatalog());
  ipcMain.handle("skill-manager:evaluation-availability", async () => service().availability());
  ipcMain.handle("skill-manager:evaluation-propose-plan", async (_, input) =>
    service().proposePlan(input)
  );
  ipcMain.handle("skill-manager:evaluation-discover-project", async (_, input) =>
    service().discoverProjectGuidance(input)
  );
  ipcMain.handle("skill-manager:evaluation-save-definition", async (_, request) =>
    service().saveDefinition(request).toJSON()
  );
  ipcMain.handle("skill-manager:evaluation-list-arm-results", async (_, filter) =>
    service().store.listArmResults(filter || {})
  );
  ipcMain.handle("skill-manager:evaluation-list-comparisons", async () =>
    service().store.listComparisons()
  );
  ipcMain.handle("skill-manager:evaluation-start", async (_, definitionId, options) => {
    const result = await service().startEvaluation(definitionId, {
      ...(options || {}),
      onProgress: sendProgress,
    });
    return {
      comparisonId: result.comparisonId,
      bundlePath: result.bundle.rootPath,
      variedFactor: result.comparison.variedFactor,
      drift: result.comparison.drift,
    };
  });
  ipcMain.handle("skill-manager:evaluation-cancel", async (_, definitionId) =>
    service().cancel(definitionId)
  );
  ipcMain.handle("skill-manager:evaluation-submit-user-review", async (_, comparisonId, input) =>
    service().addUserReview(comparisonId, input)
  );
  ipcMain.handle("skill-manager:evaluation-open-report", async (_, comparisonId) => {
    const reportPath = service().store.reportPath(comparisonId);
    await onOpenPath(reportPath);
    return { reportPath };
  });
  ipcMain.handle("skill-manager:evaluation-open-path", async (_, targetPath) => {
    await onOpenPath(targetPath);
    return { targetPath };
  });
  ipcMain.handle("skill-manager:evaluation-set-cli-paths", async (_, paths) => setService(paths));
}

module.exports = {
  createEvaluationService,
  buildAdapters,
  registerEvaluationIpc,
  REVIEW_SANDBOX_ENV_VAR,
};
