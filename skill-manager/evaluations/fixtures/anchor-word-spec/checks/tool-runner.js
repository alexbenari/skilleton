// Starts the produced tool through the run manifest the arm left behind, the
// same way the evaluation app resolves `manifest:run`, with the tool's own
// options appended. The checks must not know how the tool is built or started.
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const RUN_MANIFEST_FILENAME = "run-manifest.json";

const SHELL_INVOCATIONS = {
  cmd: (command) => ({ file: "cmd.exe", args: ["/d", "/s", "/c", command], verbatim: true }),
  powershell: (command) => ({ file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", command] }),
  pwsh: (command) => ({ file: "pwsh", args: ["-NoProfile", "-NonInteractive", "-Command", command] }),
  bash: (command) => ({ file: "bash", args: ["-lc", command] }),
  sh: (command) => ({ file: "sh", args: ["-c", command] }),
};

class ToolRunner {
  constructor(workspace) {
    this.workspace = workspace;
    const manifestPath = path.join(workspace, RUN_MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`${RUN_MANIFEST_FILENAME} is missing from the workspace root.`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof manifest.run !== "string" || manifest.run.trim() === "") {
      throw new Error(`${RUN_MANIFEST_FILENAME} declares no run command.`);
    }
    if (!SHELL_INVOCATIONS[manifest.shell]) {
      throw new Error(`${RUN_MANIFEST_FILENAME} shell ${JSON.stringify(manifest.shell)} is not one of ${Object.keys(SHELL_INVOCATIONS).join(", ")}.`);
    }
    this.runCommand = manifest.run.trim();
    this.shell = manifest.shell;
  }

  // Options are quoted for the manifest's shell: paths may hold spaces.
  quote(option) {
    if (/^[\w./:\\=,-]+$/.test(option)) {
      return option;
    }
    if (this.shell === "bash" || this.shell === "sh") {
      return `'${option.replace(/'/g, String.raw`'\''`)}'`;
    }
    if (this.shell === "powershell" || this.shell === "pwsh") {
      return `'${option.replace(/'/g, "''")}'`;
    }
    return `"${option}"`;
  }

  run(options, { timeoutMs = 180000 } = {}) {
    const command = [this.runCommand, ...options.map((option) => this.quote(option))].join(" ");
    const invocation = SHELL_INVOCATIONS[this.shell](command);
    const result = childProcess.spawnSync(invocation.file, invocation.args, {
      cwd: this.workspace,
      timeout: timeoutMs,
      windowsVerbatimArguments: Boolean(invocation.verbatim),
      encoding: "utf8",
      env: process.env,
    });
    return {
      command,
      exitCode: result.status,
      timedOut: result.error && result.error.code === "ETIMEDOUT",
      spawnError: result.error && result.error.code !== "ETIMEDOUT" ? result.error.message : null,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }
}

function workspaceRoot() {
  return process.env.EVALUATION_WORKSPACE || process.cwd();
}

function report({ findings, passSummary, failSummary }) {
  const status = findings.length === 0 ? "pass" : "fail";
  process.stdout.write(`${JSON.stringify({ status, summary: status === "pass" ? passSummary : failSummary(findings), findings })}\n`);
  process.exitCode = status === "pass" ? 0 : 1;
}

function reportError(error) {
  process.stdout.write(`${JSON.stringify({ status: "error", summary: error.message, findings: [] })}\n`);
  process.exitCode = 2;
}

module.exports = { ToolRunner, workspaceRoot, report, reportError };
