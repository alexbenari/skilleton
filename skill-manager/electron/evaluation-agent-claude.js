const fs = require("fs");

const { AgentProcess, parseJsonLines } = require("./evaluation-agent-process");
const { ActivationSignal, AgentRunnerError, RunRecord } = require("./evaluation-agent-runner");

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const NOT_LOGGED_IN = "Not logged in";

class ClaudeAgentAdapter {
  constructor({ cliPath, process: agentProcess = new AgentProcess(), fileSystem = fs } = {}) {
    if (!cliPath) {
      throw new AgentRunnerError("ClaudeAgentAdapter needs a cliPath.");
    }
    this.agent = "claude";
    this.cliPath = cliPath;
    this.process = agentProcess;
    this.fileSystem = fileSystem;
  }

  permissionArgs(role) {
    return role === "review"
      ? ["--permission-mode", "plan"]
      : ["--permission-mode", "bypassPermissions"];
  }

  buildArgs(request) {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      request.arm.model,
      "--effort",
      request.arm.effort,
      ...this.permissionArgs(request.role),
    ];
    if (request.maxTurns) {
      args.push("--max-turns", String(request.maxTurns));
    }
    if (request.maxBudgetUsd) {
      args.push("--max-budget-usd", String(request.maxBudgetUsd));
    }
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
        `Claude CLI at ${this.cliPath} did not report a version: ${outcome.stderr.trim() || outcome.spawnError || outcome.status()}`
      );
    }
    return outcome.stdout.trim();
  }

  resultEvent(events) {
    return [...events].reverse().find((event) => event.type === "result") || null;
  }

  extractUsage(events) {
    const result = this.resultEvent(events);
    if (!result) {
      return null;
    }
    const usage = result.usage || {};
    return {
      inputTokens: usage.input_tokens ?? null,
      cachedInputTokens: usage.cache_read_input_tokens ?? null,
      cacheWriteInputTokens: usage.cache_creation_input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      reasoningOutputTokens: usage.output_tokens_details?.thinking_tokens ?? null,
      costUsd: result.total_cost_usd ?? null,
    };
  }

  extractModel(events) {
    const result = this.resultEvent(events);
    const modelUsage = result && result.modelUsage ? Object.keys(result.modelUsage) : [];
    if (modelUsage.length > 0) {
      return modelUsage[0];
    }
    const system = events.find((event) => event.type === "system" && event.model);
    return system ? system.model : null;
  }

  toolUses(events) {
    const uses = [];
    for (const event of events) {
      const content = event.message?.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const block of content) {
        if (block && block.type === "tool_use") {
          uses.push({ name: block.name, input: JSON.stringify(block.input || {}) });
        }
      }
    }
    return uses;
  }

  // Claude names the tool it used, so absence of a matching tool_use among other
  // tool uses is real evidence the guidance never fired, unlike on Codex.
  activationSignals(request, events) {
    const uses = this.toolUses(events);
    return request.arm.guidanceSet.subjects
      .filter((subject) => subject.kind !== "instruction-file")
      .map((subject) => {
        const matching = uses.find(
          (use) => use.input.includes(subject.name) || (subject.workspacePath && use.input.includes(subject.workspacePath))
        );
        if (matching) {
          return new ActivationSignal({
            subjectName: subject.name,
            kind: subject.kind,
            state: "activated",
            evidence: `${matching.name} tool use referenced ${subject.name}.`,
          });
        }
        if (uses.length === 0) {
          return new ActivationSignal({
            subjectName: subject.name,
            kind: subject.kind,
            state: "undetermined",
            evidence: "The transcript records no tool uses at all.",
          });
        }
        return new ActivationSignal({
          subjectName: subject.name,
          kind: subject.kind,
          state: "not-activated",
          evidence: `${uses.length} tool uses recorded, none referencing ${subject.name}.`,
        });
      });
  }

  lastMessage(events) {
    const result = this.resultEvent(events);
    return result && typeof result.result === "string" ? result.result : "";
  }

  async run(request) {
    const home = request.home;
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
    const processStatus = outcome.status();
    const notLoggedIn = `${outcome.stdout}${outcome.stderr}`.includes(NOT_LOGGED_IN);
    const status = notLoggedIn ? "failed" : processStatus;
    const failureReason = notLoggedIn
      ? "not-logged-in"
      : status === "completed"
        ? null
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
      lastMessage: this.lastMessage(events),
      modelRequested: request.arm.model,
      modelReported: this.extractModel(events),
      effortRequested: request.arm.effort,
      effortReported: null,
      usage: this.extractUsage(events),
      activationSignals: this.activationSignals(request, events),
      agentVersion: request.agentVersion || null,
      failureReason,
    });
  }
}

module.exports = {
  ClaudeAgentAdapter,
  DEFAULT_TIMEOUT_MS,
  NOT_LOGGED_IN,
};
