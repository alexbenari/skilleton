const fs = require("fs");
const path = require("path");

const { ActivationSignal, RunRecord } = require("../../electron/evaluation-agent-runner");

// Stands in for a real CLI in tests: it records what it was asked to do, writes
// whatever files the script says the run produced, and returns a RunRecord.
class FakeAgentAdapter {
  constructor({ agent, script = {} } = {}) {
    this.agent = agent;
    this.script = script;
    this.requests = [];
    this.versionString = script.version || `${agent}-fake-1.0.0`;
  }

  async version() {
    if (this.script.versionFails) {
      throw new Error(`${this.agent} CLI is not installed.`);
    }
    return this.versionString;
  }

  writeProducedFiles(workspacePath) {
    for (const [relativePath, contents] of Object.entries(this.script.produces || {})) {
      const destination = path.join(workspacePath, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, contents, "utf8");
    }
  }

  buildActivationSignals(request) {
    const declared = this.script.activation || {};
    const subjects = request.arm.guidanceSet.subjects.filter(
      (subject) => subject.kind !== "instruction-file"
    );
    return subjects.map(
      (subject) =>
        new ActivationSignal({
          subjectName: subject.name,
          kind: subject.kind,
          state: declared[subject.name] || "activated",
          evidence: `fake ${this.agent} transcript`,
        })
    );
  }

  async run(request) {
    this.requests.push(request);
    const startedAt = new Date().toISOString();
    if (request.signal && request.signal.aborted) {
      return this.buildRecord(request, { status: "canceled", startedAt });
    }
    if (request.transcriptPath) {
      fs.mkdirSync(path.dirname(request.transcriptPath), { recursive: true });
      fs.writeFileSync(
        request.transcriptPath,
        `${JSON.stringify({ type: "fake", agent: this.agent, role: request.role })}\n`,
        "utf8"
      );
    }
    if (request.onEvent) {
      request.onEvent({ type: "started", agent: this.agent, role: request.role });
    }
    const status = this.script.status || "completed";
    if (status === "completed") {
      this.writeProducedFiles(request.workspacePath);
    }
    if (request.onEvent) {
      request.onEvent({ type: "finished", agent: this.agent, status });
    }
    return this.buildRecord(request, { status, startedAt });
  }

  buildRecord(request, { status, startedAt }) {
    const endedAt = new Date().toISOString();
    return new RunRecord({
      agent: this.agent,
      role: request.role,
      status,
      exitCode: status === "completed" ? 0 : this.script.exitCode ?? 1,
      startedAt,
      endedAt,
      durationMs: this.script.durationMs ?? 1000,
      transcriptPath: request.transcriptPath || null,
      lastMessage: this.script.lastMessage || "done",
      modelRequested: request.arm.model,
      modelReported: this.script.modelReported ?? request.arm.model,
      effortRequested: request.arm.effort,
      effortReported:
        this.script.effortReported === undefined ? request.arm.effort : this.script.effortReported,
      usage: this.script.usage ?? { inputTokens: 1000, outputTokens: 500 },
      activationSignals: this.buildActivationSignals(request),
      agentVersion: this.versionString,
      failureReason: status === "completed" ? null : this.script.failureReason || status,
    });
  }
}

function fakeAdapters(scripts = {}) {
  return Object.fromEntries(
    Object.entries(scripts).map(([agent, script]) => [agent, new FakeAgentAdapter({ agent, script })])
  );
}

module.exports = {
  FakeAgentAdapter,
  fakeAdapters,
};
