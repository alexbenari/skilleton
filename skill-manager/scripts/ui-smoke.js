const os = require("os");
const path = require("path");

const { app, BrowserWindow, ipcMain } = require("electron");

const { createEvaluationService, registerEvaluationIpc } = require("../electron/evaluation-wiring");

// Drives the real index.html with the real preload against the real service, so
// a renderer error or a mismatched IPC channel fails here rather than in front
// of a user.
const problems = [];
const log = [];

function record(kind, text) {
  log.push(`${kind}: ${text}`);
  if (kind === "error" || kind === "page-error") {
    problems.push(text);
  }
}

async function main() {
  const service = createEvaluationService({ tempRootPath: os.tmpdir() });
  registerEvaluationIpc(ipcMain, {
    getService: () => service,
    setService: () => ({ codexCliPath: null, claudeCliPath: null }),
    sendProgress: () => {},
    onOpenPath: async (targetPath) => record("open-path", targetPath),
  });
  ipcMain.handle("skill-manager:get-bootstrap", async () => ({ initialProject: process.cwd() }));
  ipcMain.handle("skill-manager:get-state", async () => ({ skills: [], libraries: [] }));

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "..", "electron", "preload.js"),
    },
  });
  // Electron's own development security warnings are not this app's errors and
  // do not appear in a packaged build.
  window.webContents.on("console-message", (event) => {
    const message = event.message || "";
    if (event.level === "error" && !message.includes("Electron Security Warning")) {
      record("error", message);
    }
  });
  window.webContents.on("render-process-gone", (_, details) =>
    record("page-error", `renderer gone: ${details.reason}`)
  );
  window.webContents.on("preload-error", (_, preloadPath, error) =>
    record("page-error", `preload failed: ${error.message}`)
  );

  await window.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const report = { steps: [] };
      const el = (id) => document.getElementById(id);
      report.bridgePresent = Boolean(window.skillManager && window.skillManager.evaluation);
      report.panelHiddenBefore = el("evaluation-panel").hidden;
      el("evaluation-toggle").click();
      await new Promise((r) => setTimeout(r, 2500));
      report.panelHiddenAfter = el("evaluation-panel").hidden;
      report.targetOptions = [...el("evaluation-target").options].map((o) => o.value);
      report.scenarioOptions = [...el("evaluation-scenario").options].map((o) => o.value);
      report.agentOptions = [...el("evaluation-reference-agent").options].map((o) => o.value);
      report.availability = el("evaluation-availability").textContent;
      el("evaluation-propose").click();
      await new Promise((r) => setTimeout(r, 1500));
      report.plan = el("evaluation-plan").textContent;
      report.dimensionInputs = el("evaluation-dimensions").querySelectorAll("textarea").length;
      report.log = el("evaluation-log").textContent.trim().split("\\n").filter(Boolean);
      return report;
    })()
  `);

  console.log("bridge exposed to renderer:", result.bridgePresent);
  console.log("panel hidden before click:", result.panelHiddenBefore, "| after click:", result.panelHiddenAfter);
  console.log("targets in dropdown:", result.targetOptions.join(", ") || "(none)");
  console.log("scenarios in dropdown:", result.scenarioOptions.join(", ") || "(none)");
  console.log("agents in dropdown:", result.agentOptions.join(", ") || "(none)");
  console.log("availability line:", result.availability || "(empty)");
  console.log("proposed plan line:", result.plan || "(empty)");
  console.log("rubric inputs rendered:", result.dimensionInputs);
  console.log("panel log:");
  for (const line of result.log) {
    console.log("   ", line);
  }
  console.log("renderer problems:", problems.length === 0 ? "none" : problems.join(" | "));

  const ok =
    result.bridgePresent &&
    result.panelHiddenBefore === true &&
    result.panelHiddenAfter === false &&
    result.targetOptions.length > 0 &&
    result.scenarioOptions.length > 0 &&
    result.agentOptions.length > 0 &&
    result.dimensionInputs > 0 &&
    problems.length === 0;
  console.log(ok ? "\nUI SMOKE PASSED" : "\nUI SMOKE FAILED");
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.log("UI SMOKE FAILED:", error.message);
    app.exit(1);
  })
);
