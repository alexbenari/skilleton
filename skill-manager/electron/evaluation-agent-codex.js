const fs = require("fs");
const path = require("path");

const { AgentProcess, parseJsonLines } = require("./evaluation-agent-process");
const { ActivationSignal, AgentRunnerError, RunRecord } = require("./evaluation-agent-runner");

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const SANDBOX_BYPASS = "--dangerously-bypass-approvals-and-sandbox";

class CodexAgentAdapter {
  constructor({
    cliPath,
    process: agentProcess = new AgentProcess(),
    fileSystem = fs,
    reviewSandbox = "read-only",
  } = {}) {
    if (!cliPath) {
      throw new AgentRunnerError("CodexAgentAdapter needs a cliPath.");
    }
    this.agent = "codex";
    this.cliPath = cliPath;
    this.process = agentProcess;
    this.fileSystem = fileSystem;
    this.reviewSandbox = reviewSandbox;
  }

  // The Windows sandbox fails on this machine with CreateProcessWithLogonW 1385
  // even under the user's own CODEX_HOME, so a task run has to bypass it. A
  // review keeps the read-only sandbox where that works; where it does not, the
  // reviewer cannot read the bundle at all, and ModelReviewer verifies instead
  // that the bundle was left unchanged.
  sandboxArgs(role) {
    if (role !== "review") {
      return [SANDBOX_BYPASS];
    }
    return this.reviewSandbox === "bypass" ? [SANDBOX_BYPASS] : ["--sandbox", "read-only"];
  }

  buildArgs(request) {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--json",
      "-C",
      request.workspacePath,
      "-m",
      request.arm.model,
      "-c",
      `model_reasoning_effort=${request.arm.effort}`,
      ...this.sandboxArgs(request.role),
    ];
    if (request.lastMessagePath) {
      args.push("-o", request.lastMessagePath);
    }
    args.push("-");
    return args;
  }

  async version() {
    const outcome = await this.process.run({
      file: this.cliPath,
      args: ["--version"],
      timeoutMs: 30000,
    });
    if (outcome.status() !== "completed") {
      throw new AgentRunnerError(
        `Codex CLI at ${this.cliPath} did not report a version: ${outcome.stderr.trim() || outcome.spawnError || outcome.status()}`
      );
    }
    return outcome.stdout.trim();
  }

  sessionsRoot(home) {
    return path.join(home.homePath, "sessions");
  }

  // Codex puts model and reasoning effort only in the rollout file, never on
  // stdout, so the isolated CODEX_HOME is what makes them readable at all.
  readRolloutContext(home, startedAtMs) {
    const root = this.sessionsRoot(home);
    if (!home || !this.fileSystem.existsSync(root)) {
      return {};
    }
    const rollouts = [];
    const walk = (directory) => {
      for (const entry of this.fileSystem.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
          const stats = this.fileSystem.statSync(entryPath);
          if (stats.mtimeMs >= startedAtMs - 1000) {
            rollouts.push({ path: entryPath, mtimeMs: stats.mtimeMs });
          }
        }
      }
    };
    try {
      walk(root);
    } catch {
      return {};
    }
    if (rollouts.length === 0) {
      return {};
    }
    rollouts.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const events = parseJsonLines(this.fileSystem.readFileSync(rollouts[0].path, "utf8"));
    const context = events.find((event) => event.type === "turn_context");
    if (!context || !context.payload) {
      return { rolloutPath: rollouts[0].path };
    }
    return {
      rolloutPath: rollouts[0].path,
      model: context.payload.model || null,
      effort: context.payload.effort || null,
    };
  }

  extractUsage(events) {
    const completed = [...events].reverse().find((event) => event.type === "turn.completed");
    if (!completed || !completed.usage) {
      return null;
    }
    const usage = completed.usage;
    return {
      inputTokens: usage.input_tokens ?? null,
      cachedInputTokens: usage.cached_input_tokens ?? null,
      cacheWriteInputTokens: usage.cache_write_input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      reasoningOutputTokens: usage.reasoning_output_tokens ?? null,
      costUsd: null,
    };
  }

  // Codex exits 0 even when its tooling failed and the model answered anyway,
  // so a completed turn is the only trustworthy success signal.
  completedATurn(events) {
    return events.some((event) => event.type === "turn.completed");
  }

  activationSignals(request, transcriptText) {
    return request.arm.guidanceSet.subjects
      .filter((subject) => subject.kind !== "instruction-file")
      .map((subject) => {
        const needles = [subject.name, subject.workspacePath].filter(Boolean);
        const hit = needles.find((needle) => transcriptText.includes(needle));
        if (hit) {
          return new ActivationSignal({
            subjectName: subject.name,
            kind: subject.kind,
            state: "activated",
            evidence: `Transcript mentions ${hit}.`,
          });
        }
        return new ActivationSignal({
          subjectName: subject.name,
          kind: subject.kind,
          state: "undetermined",
          evidence:
            "Codex emits no skill-load or file-read event identifying guidance, " +
            "so absence from the transcript does not prove it was unused.",
        });
      });
  }

  // The -o file is only written when the caller asks for one, so the event
  // stream is the fallback: the final answer arrives as an agent_message item.
  readLastMessage(request, events) {
    if (request.lastMessagePath && this.fileSystem.existsSync(request.lastMessagePath)) {
      return this.fileSystem.readFileSync(request.lastMessagePath, "utf8");
    }
    const message = [...events]
      .reverse()
      .find(
        (event) =>
          event.type === "item.completed" &&
          event.item &&
          event.item.type === "agent_message" &&
          typeof event.item.text === "string"
      );
    return message ? message.item.text : "";
  }

  async run(request) {
    const home = request.home;
    const startedAtMs = Date.now();
    const outcome = await this.process.run({
      file: this.cliPath,
      args: this.buildArgs(request),
      cwd: request.workspacePath,
      env: { ...process.env, ...(home ? home.environment() : {}) },
      stdin: request.prompt,
      timeoutMs: request.timeoutMs || DEFAULT_TIMEOUT_MS,
      signal: request.signal || null,
      transcriptPath: request.transcriptPath || null,
      onEvent: request.onEvent || null,
    });
    const events = parseJsonLines(outcome.stdout);
    const rollout = home ? this.readRolloutContext(home, startedAtMs) : {};
    const processStatus = outcome.status();
    const completedTurn = this.completedATurn(events);
    const status = processStatus === "completed" && !completedTurn ? "failed" : processStatus;
    const failureReason =
      status === "completed"
        ? null
        : processStatus === "completed"
          ? "no-completed-turn"
          : outcome.spawnError || processStatus;
    return new RunRecord({
      agent: this.agent,
      role: request.role,
      status,
      exitCode: outcome.exitCode,
      startedAt: outcome.startedAt,
      endedAt: outcome.endedAt,
      durationMs: outcome.durationMs,
      transcriptPath: request.transcriptPath || null,
      lastMessage: this.readLastMessage(request, events),
      modelRequested: request.arm.model,
      modelReported: rollout.model || null,
      effortRequested: request.arm.effort,
      effortReported: rollout.effort || null,
      usage: this.extractUsage(events),
      activationSignals: this.activationSignals(request, outcome.stdout),
      agentVersion: request.agentVersion || null,
      failureReason,
    });
  }
}

module.exports = {
  CodexAgentAdapter,
  DEFAULT_TIMEOUT_MS,
};
