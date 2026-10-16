const childProcess = require("child_process");
const path = require("path");

class EvaluationCheckError extends Error {}

const CHECK_STATUSES = ["pass", "fail", "error"];
const DEFAULT_SHELL = process.platform === "win32" ? "cmd" : "sh";

// cmd.exe is spawned verbatim: Node escapes an embedded quote as \" when it
// builds a Windows command line, and cmd.exe does not understand that, so a
// quoted path in a check command would reach the program mangled.
const SHELL_INVOCATIONS = {
  cmd: (command) => ({ file: "cmd.exe", args: ["/d", "/s", "/c", command], verbatim: true }),
  powershell: (command) => ({
    file: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", command],
  }),
  pwsh: (command) => ({
    file: "pwsh",
    args: ["-NoProfile", "-NonInteractive", "-Command", command],
  }),
  bash: (command) => ({ file: "bash", args: ["-lc", command] }),
  sh: (command) => ({ file: "sh", args: ["-c", command] }),
};

class CheckResult {
  constructor({
    checkId,
    kind,
    status,
    summary = "",
    findings = [],
    command = null,
    shell = null,
    exitCode = null,
    durationMs = 0,
    output = "",
    reason = null,
  }) {
    if (!CHECK_STATUSES.includes(status)) {
      throw new EvaluationCheckError(
        `Check status must be one of ${CHECK_STATUSES.join(", ")}, received ${JSON.stringify(status)}.`
      );
    }
    this.checkId = checkId;
    this.kind = kind;
    this.status = status;
    this.summary = summary;
    this.findings = Object.freeze(findings.map((finding) => Object.freeze({ ...finding })));
    this.command = command;
    this.shell = shell;
    this.exitCode = exitCode;
    this.durationMs = durationMs;
    this.output = output;
    this.reason = reason;
    Object.freeze(this);
  }

  passed() {
    return this.status === "pass";
  }

  toJSON() {
    return {
      checkId: this.checkId,
      kind: this.kind,
      status: this.status,
      summary: this.summary,
      findings: this.findings.map((finding) => ({ ...finding })),
      command: this.command,
      shell: this.shell,
      exitCode: this.exitCode,
      durationMs: this.durationMs,
      output: this.output,
      reason: this.reason,
    };
  }
}

function tail(text, limit = 4000) {
  return text.length <= limit ? text : `...${text.slice(text.length - limit)}`;
}

// A check script prints one JSON object; progress chatter before it is tolerated
// so a scenario author is not forced to silence their own tooling.
function parseCheckOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return null;
  }
  const candidates = [trimmed, ...trimmed.split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && CHECK_STATUSES.includes(parsed.status)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

class CheckRunner {
  constructor({ spawn = childProcess.spawn } = {}) {
    this.spawn = spawn;
  }

  resolveShell(name) {
    const invocation = SHELL_INVOCATIONS[name];
    if (!invocation) {
      throw new EvaluationCheckError(
        `Unknown shell ${JSON.stringify(name)}; known shells are ${Object.keys(SHELL_INVOCATIONS).join(", ")}.`
      );
    }
    return invocation;
  }

  substitute(command, context) {
    return command
      .split("{checksDir}")
      .join(context.checksPath || "")
      .split("{workspace}")
      .join(context.workspacePath);
  }

  resolveCommand(check, context) {
    if (!check.isManifestCommand()) {
      return {
        command: this.substitute(check.command, context),
        shell: check.shell || DEFAULT_SHELL,
      };
    }
    const manifest = context.manifest;
    if (!manifest || !manifest.isPresent()) {
      return {
        unavailable: {
          reason: manifest ? `manifest-${manifest.status}` : "manifest-missing",
          detail: manifest ? manifest.reason : "No run manifest was read for this arm.",
        },
      };
    }
    const step = check.manifestStep();
    const command = manifest.commandFor(step);
    if (!command) {
      return {
        unavailable: {
          reason: "manifest-step-missing",
          detail: `The run manifest declares no ${step} command.`,
        },
      };
    }
    return { command: this.substitute(command, context), shell: manifest.shell };
  }

  async runOne(check, context) {
    const resolved = this.resolveCommand(check, context);
    if (resolved.unavailable) {
      return new CheckResult({
        checkId: check.id,
        kind: check.kind,
        status: "error",
        summary: resolved.unavailable.detail,
        reason: resolved.unavailable.reason,
      });
    }
    const invocation = this.resolveShell(resolved.shell)(resolved.command);
    const startedAt = Date.now();
    const outcome = await this.execute(invocation.file, invocation.args, {
      cwd: context.workspacePath,
      timeoutMs: check.timeoutSeconds * 1000,
      verbatim: Boolean(invocation.verbatim),
      env: {
        ...process.env,
        EVALUATION_WORKSPACE: context.workspacePath,
        EVALUATION_CHECKS_DIR: context.checksPath || "",
      },
    });
    const durationMs = Date.now() - startedAt;
    const base = {
      checkId: check.id,
      kind: check.kind,
      command: resolved.command,
      shell: resolved.shell,
      exitCode: outcome.exitCode,
      durationMs,
      output: tail(`${outcome.stdout}${outcome.stderr}`),
    };
    if (outcome.timedOut) {
      return new CheckResult({
        ...base,
        status: "error",
        reason: "timeout",
        summary: `Check ${check.id} exceeded ${check.timeoutSeconds}s and was stopped.`,
      });
    }
    if (outcome.spawnError) {
      return new CheckResult({
        ...base,
        status: "error",
        reason: "spawn-failed",
        summary: `Check ${check.id} could not start: ${outcome.spawnError}`,
      });
    }
    const parsed = parseCheckOutput(outcome.stdout);
    if (!parsed) {
      return new CheckResult({
        ...base,
        status: "error",
        reason: "unparseable-output",
        summary: `Check ${check.id} printed no JSON result object.`,
      });
    }
    return new CheckResult({
      ...base,
      status: parsed.status,
      summary: parsed.summary || "",
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    });
  }

  execute(file, args, { cwd, timeoutMs, env, verbatim = false }) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let child;
      try {
        child = this.spawn(file, args, {
          cwd,
          env,
          windowsHide: true,
          windowsVerbatimArguments: verbatim,
        });
      } catch (error) {
        resolve({ stdout: "", stderr: "", exitCode: null, spawnError: error.message });
        return;
      }
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => finish({ stdout, stderr, exitCode: null, spawnError: error.message }));
      child.on("close", (code) => finish({ stdout, stderr, exitCode: code, timedOut }));
    });
  }

  async runAll(checks, context) {
    const results = [];
    for (const check of checks) {
      results.push(await this.runOne(check, context));
    }
    return results;
  }
}

module.exports = {
  EvaluationCheckError,
  CheckRunner,
  CheckResult,
  CHECK_STATUSES,
  SHELL_INVOCATIONS,
  DEFAULT_SHELL,
  parseCheckOutput,
};
