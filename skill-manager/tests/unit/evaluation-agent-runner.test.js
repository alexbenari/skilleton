const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ActivationSignal,
  AgentRunner,
  AgentRunnerError,
  RunRecord,
} = require("../../electron/evaluation-agent-runner");
const {
  ArmConfiguration,
  GuidanceSet,
  Subject,
} = require("../../electron/evaluation-definition");
const { FakeAgentAdapter, fakeAdapters } = require("../helpers/fake-agent-runner");

function armFor(agent, { model = "luna", effort = "high", subjects = [] } = {}) {
  return new ArmConfiguration({
    agent,
    model,
    effort,
    guidanceSet: new GuidanceSet(subjects),
  });
}

function skillSubject(name) {
  return new Subject({
    kind: "skill",
    name,
    sourcePath: `D:\\library\\${name}`,
    fingerprint: "sha256:skill",
  });
}

function requestFor(arm, overrides = {}) {
  return {
    role: "task",
    arm,
    workspacePath: "D:\\runs\\workspace",
    prompt: "Build the thing the requirements describe.",
    ...overrides,
  };
}

test("run dispatches to the adapter named by the arm's agent", async () => {
  const adapters = fakeAdapters({ codex: {}, claude: {} });
  const runner = new AgentRunner({ adapters });

  const record = await runner.run(requestFor(armFor("claude", { model: "opus-5" })));

  assert.equal(record.agent, "claude");
  assert.equal(adapters.claude.requests.length, 1);
  assert.equal(adapters.codex.requests.length, 0);
});

test("run refuses an agent with no adapter before any process is started", async () => {
  const adapters = fakeAdapters({ codex: {} });
  const runner = new AgentRunner({ adapters });

  await assert.rejects(
    () => runner.run(requestFor(armFor("claude"))),
    (error) =>
      error instanceof AgentRunnerError &&
      error.message.includes("claude") &&
      error.message.includes("codex")
  );
  assert.equal(adapters.codex.requests.length, 0);
});

test("run refuses a request that names an unknown role", async () => {
  const runner = new AgentRunner({ adapters: fakeAdapters({ codex: {} }) });

  await assert.rejects(
    () => runner.run(requestFor(armFor("codex"), { role: "audit" })),
    (error) => error instanceof AgentRunnerError && error.message.includes("audit")
  );
});

test("run refuses a request with no prompt", async () => {
  const runner = new AgentRunner({ adapters: fakeAdapters({ codex: {} }) });

  await assert.rejects(
    () => runner.run(requestFor(armFor("codex"), { prompt: "" })),
    (error) => error instanceof AgentRunnerError && error.message.includes("prompt")
  );
});

test("run forwards progress events to the caller", async () => {
  const runner = new AgentRunner({ adapters: fakeAdapters({ codex: {} }) });
  const events = [];

  await runner.run(requestFor(armFor("codex"), { onEvent: (event) => events.push(event.type) }));

  assert.deepEqual(events, ["started", "finished"]);
});

test("an already-aborted request produces a canceled record rather than a completed one", async () => {
  const runner = new AgentRunner({ adapters: fakeAdapters({ codex: {} }) });
  const controller = new AbortController();
  controller.abort();

  const record = await runner.run(requestFor(armFor("codex"), { signal: controller.signal }));

  assert.equal(record.status, "canceled");
  assert.equal(record.succeeded(), false);
  assert.equal(record.failureReason, "canceled");
});

test("a failing run keeps its exit code and reason as evidence", async () => {
  const runner = new AgentRunner({
    adapters: fakeAdapters({ codex: { status: "failed", exitCode: 2, failureReason: "auth expired" } }),
  });

  const record = await runner.run(requestFor(armFor("codex")));

  assert.equal(record.status, "failed");
  assert.equal(record.exitCode, 2);
  assert.equal(record.failureReason, "auth expired");
});

// The resolved path travels with the verdict either way: "unavailable" is
// almost always a path problem, and the path is the first thing worth seeing.
test("availability reports which adapters can be reached, why one cannot, and the path each used", async () => {
  const codexAdapter = new FakeAgentAdapter({ agent: "codex", script: { version: "codex 1.2.3" } });
  codexAdapter.cliPath = "D:\\tools\\codex.exe";
  const claudeAdapter = new FakeAgentAdapter({ agent: "claude", script: { versionFails: true } });
  claudeAdapter.cliPath = "D:\\tools\\claude.exe";
  const runner = new AgentRunner({ adapters: { codex: codexAdapter, claude: claudeAdapter } });

  const availability = await runner.availability();

  assert.deepEqual(availability.codex, {
    available: true,
    version: "codex 1.2.3",
    cliPath: "D:\\tools\\codex.exe",
  });
  assert.equal(availability.claude.available, false);
  assert.equal(availability.claude.reason.includes("not installed"), true);
  assert.equal(availability.claude.cliPath, "D:\\tools\\claude.exe");
});

test("a run reports an activation signal for every trigger-gated subject in force", async () => {
  const arm = armFor("codex", {
    subjects: [skillSubject("writing-clean-code"), skillSubject("testing-discipline")],
  });
  const runner = new AgentRunner({
    adapters: fakeAdapters({ codex: { activation: { "testing-discipline": "not-activated" } } }),
  });

  const record = await runner.run(requestFor(arm));

  assert.equal(record.signalFor("writing-clean-code").state, "activated");
  assert.equal(record.signalFor("testing-discipline").state, "not-activated");
});

test("an activation signal may be undetermined when the transcript does not settle it", () => {
  const signal = new ActivationSignal({
    subjectName: "coding-quality",
    kind: "referenced-document",
    state: "undetermined",
    evidence: "no file-read events in transcript",
  });

  assert.equal(signal.isDetermined(), false);
  assert.throws(
    () =>
      new ActivationSignal({
        subjectName: "coding-quality",
        kind: "referenced-document",
        state: "probably",
      }),
    (error) => error instanceof AgentRunnerError && error.message.includes("probably")
  );
});

test("an effort the CLI did not confirm is not reported as applied", () => {
  const confirmed = new RunRecord({
    agent: "claude",
    role: "task",
    status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z",
    endedAt: "2026-09-20T10:01:00.000Z",
    durationMs: 60000,
    modelRequested: "opus-5",
    effortRequested: "high",
    effortReported: "high",
  });
  const unconfirmed = new RunRecord({
    agent: "codex",
    role: "task",
    status: "completed",
    startedAt: "2026-09-20T10:00:00.000Z",
    endedAt: "2026-09-20T10:01:00.000Z",
    durationMs: 60000,
    modelRequested: "luna",
    effortRequested: "high",
    effortReported: null,
  });

  assert.equal(confirmed.effortConfirmed(), true);
  assert.equal(unconfirmed.effortConfirmed(), false);
  assert.equal(unconfirmed.toJSON().effortConfirmed, false);
});

test("a run record rejects a status outside the known set", () => {
  assert.throws(
    () =>
      new RunRecord({
        agent: "codex",
        role: "task",
        status: "mostly-done",
        startedAt: "2026-09-20T10:00:00.000Z",
        endedAt: "2026-09-20T10:01:00.000Z",
        durationMs: 1,
        modelRequested: "luna",
        effortRequested: "high",
      }),
    (error) => error instanceof AgentRunnerError && error.message.includes("mostly-done")
  );
});
