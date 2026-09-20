class AgentRunnerError extends Error {}

const RUN_ROLES = ["task", "review"];
const RUN_STATUSES = ["completed", "failed", "timed-out", "canceled"];
const ACTIVATION_STATES = ["activated", "not-activated", "undetermined"];

class ActivationSignal {
  constructor({ subjectName, kind, state, evidence = "" }) {
    if (!ACTIVATION_STATES.includes(state)) {
      throw new AgentRunnerError(
        `Activation state must be one of ${ACTIVATION_STATES.join(", ")}, received ${JSON.stringify(state)}.`
      );
    }
    this.subjectName = subjectName;
    this.kind = kind;
    this.state = state;
    this.evidence = evidence;
    Object.freeze(this);
  }

  isDetermined() {
    return this.state !== "undetermined";
  }

  toJSON() {
    return {
      subjectName: this.subjectName,
      kind: this.kind,
      state: this.state,
      evidence: this.evidence,
    };
  }
}

class RunRecord {
  constructor({
    agent,
    role,
    status,
    exitCode = null,
    startedAt,
    endedAt,
    durationMs,
    transcriptPath = null,
    lastMessage = "",
    modelRequested,
    modelReported = null,
    effortRequested,
    effortReported = null,
    usage = null,
    activationSignals = [],
    agentVersion = null,
    failureReason = null,
  }) {
    if (!RUN_STATUSES.includes(status)) {
      throw new AgentRunnerError(
        `Run status must be one of ${RUN_STATUSES.join(", ")}, received ${JSON.stringify(status)}.`
      );
    }
    this.agent = agent;
    this.role = role;
    this.status = status;
    this.exitCode = exitCode;
    this.startedAt = startedAt;
    this.endedAt = endedAt;
    this.durationMs = durationMs;
    this.transcriptPath = transcriptPath;
    this.lastMessage = lastMessage;
    this.modelRequested = modelRequested;
    this.modelReported = modelReported;
    this.effortRequested = effortRequested;
    this.effortReported = effortReported;
    this.usage = usage;
    this.activationSignals = Object.freeze([...activationSignals]);
    this.agentVersion = agentVersion;
    this.failureReason = failureReason;
    Object.freeze(this);
  }

  succeeded() {
    return this.status === "completed";
  }

  // An effort the CLI never confirms is an effort we cannot claim was applied,
  // which matters most when reasoning effort is the varied factor.
  effortConfirmed() {
    return this.effortReported !== null && this.effortReported === this.effortRequested;
  }

  signalFor(subjectName) {
    return this.activationSignals.find((signal) => signal.subjectName === subjectName) || null;
  }

  toJSON() {
    return {
      agent: this.agent,
      role: this.role,
      status: this.status,
      exitCode: this.exitCode,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: this.durationMs,
      transcriptPath: this.transcriptPath,
      lastMessage: this.lastMessage,
      modelRequested: this.modelRequested,
      modelReported: this.modelReported,
      effortRequested: this.effortRequested,
      effortReported: this.effortReported,
      effortConfirmed: this.effortConfirmed(),
      usage: this.usage,
      activationSignals: this.activationSignals.map((signal) => signal.toJSON()),
      agentVersion: this.agentVersion,
      failureReason: this.failureReason,
    };
  }
}

class AgentRunner {
  constructor({ adapters = {} } = {}) {
    this.adapters = adapters;
  }

  supportedAgents() {
    return Object.keys(this.adapters).sort();
  }

  adapterFor(agent) {
    const adapter = this.adapters[agent];
    if (!adapter) {
      throw new AgentRunnerError(
        `No adapter for agent ${JSON.stringify(agent)}; available agents are ` +
          `${this.supportedAgents().join(", ") || "none"}.`
      );
    }
    return adapter;
  }

  validateRequest(request) {
    if (!RUN_ROLES.includes(request.role)) {
      throw new AgentRunnerError(
        `Run role must be one of ${RUN_ROLES.join(", ")}, received ${JSON.stringify(request.role)}.`
      );
    }
    if (!request.workspacePath) {
      throw new AgentRunnerError("A run needs a workspacePath.");
    }
    if (!request.prompt) {
      throw new AgentRunnerError("A run needs a prompt.");
    }
    if (!request.arm) {
      throw new AgentRunnerError("A run needs an arm configuration.");
    }
  }

  async run(request) {
    this.validateRequest(request);
    const adapter = this.adapterFor(request.arm.agent);
    return adapter.run(request);
  }

  async version(agent) {
    return this.adapterFor(agent).version();
  }

  // The resolved path travels with the verdict, because "unavailable" is almost
  // always a path problem and the path is the first thing worth seeing.
  async availability() {
    const entries = await Promise.all(
      this.supportedAgents().map(async (agent) => {
        const cliPath = this.adapters[agent].cliPath || null;
        try {
          return [agent, { available: true, version: await this.version(agent), cliPath }];
        } catch (error) {
          return [agent, { available: false, reason: error.message, cliPath }];
        }
      })
    );
    return Object.fromEntries(entries);
  }
}

module.exports = {
  AgentRunnerError,
  AgentRunner,
  RunRecord,
  ActivationSignal,
  RUN_ROLES,
  RUN_STATUSES,
  ACTIVATION_STATES,
};
