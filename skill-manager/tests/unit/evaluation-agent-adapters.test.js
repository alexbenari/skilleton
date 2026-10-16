const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("node:events");

const { AgentProcess } = require("../../electron/evaluation-agent-process");
const { CodexAgentAdapter } = require("../../electron/evaluation-agent-codex");
const { ClaudeAgentAdapter } = require("../../electron/evaluation-agent-claude");
const { ArmConfiguration, GuidanceSet, Subject } = require("../../electron/evaluation-definition");
const { AgentHome } = require("../../electron/evaluation-home");

const CODEX_CLI_PATH = "C:\\tools\\codex\\codex.exe";
const CLAUDE_CLI_PATH = "C:\\tools\\claude\\claude.exe";
const WORKSPACE_PATH = "D:\\runs\\evaluation-0001\\workspace";

// Stands in for a spawned CLI. The caller scripts the stdout the fake child
// writes and how it exits; the fake records the argv, environment and stdin the
// adapter handed it. Output arrives on a later tick, as from a real process.
function stubSpawn({ stdout = "", stderr = "", exitCode = 0 } = {}) {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const call = { file, args, options, stdinWrites: [] };
    child.stdin = { end: (text) => call.stdinWrites.push(text) };
    child.kill = () => setImmediate(() => child.emit("close", null));
    calls.push(call);
    setImmediate(() => {
      if (stdout) {
        child.stdout.emit("data", Buffer.from(stdout));
      }
      if (stderr) {
        child.stderr.emit("data", Buffer.from(stderr));
      }
      child.emit("close", exitCode);
    });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

function skillSubject(name) {
  return new Subject({
    kind: "skill",
    name,
    sourcePath: `D:\\library\\skills\\${name}`,
    fingerprint: "sha256:skill",
  });
}

function instructionFileSubject(name) {
  return new Subject({
    kind: "instruction-file",
    name,
    sourcePath: `D:\\library\\instructions\\${name}`,
    fingerprint: "sha256:instruction-file",
  });
}

function armFor(agent, { model, effort = "high", subjects = [] } = {}) {
  return new ArmConfiguration({
    agent,
    model,
    effort,
    guidanceSet: new GuidanceSet(subjects),
  });
}

function agentHome(agent, homePath, envVarName) {
  return new AgentHome({
    agent,
    homePath,
    envVarName,
    isolation: "isolated",
    copiedFilenames: ["auth.json"],
    inheritedFrom: null,
  });
}

function requestFor(arm, overrides = {}) {
  return {
    role: "task",
    arm,
    workspacePath: WORKSPACE_PATH,
    prompt: "Add unit tests for the invoice total calculation.",
    ...overrides,
  };
}

function jsonLines(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-agent-adapters-"));
}

const CODEX_TURN_USAGE = {
  input_tokens: 18187,
  cached_input_tokens: 12416,
  cache_write_input_tokens: 0,
  output_tokens: 258,
  reasoning_output_tokens: 0,
};

function codexStdout({ usage = CODEX_TURN_USAGE, messageText = "Added the unit tests." } = {}) {
  return jsonLines([
    { type: "turn.started" },
    { type: "item.completed", item: { type: "agent_message", text: messageText } },
    { type: "turn.completed", usage },
  ]);
}

function claudeStdout({
  toolUses = [],
  result = {},
  systemModel = "claude-opus-5-20260501",
} = {}) {
  const assistantEvents = toolUses.map((use) => ({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: use.name, input: use.input }] },
  }));
  return jsonLines([
    { type: "system", subtype: "init", model: systemModel },
    ...assistantEvents,
    {
      type: "result",
      subtype: "success",
      result: "Added the unit tests.",
      total_cost_usd: 0.4213,
      usage: {
        input_tokens: 9241,
        cache_read_input_tokens: 7680,
        cache_creation_input_tokens: 1024,
        output_tokens: 612,
        output_tokens_details: { thinking_tokens: 448 },
      },
      modelUsage: { "claude-opus-5-20260501": { inputTokens: 9241 } },
      ...result,
    },
  ]);
}

function codexAdapterWith(spawn) {
  return new CodexAgentAdapter({ cliPath: CODEX_CLI_PATH, process: new AgentProcess({ spawn }) });
}

function claudeAdapterWith(spawn) {
  return new ClaudeAgentAdapter({ cliPath: CLAUDE_CLI_PATH, process: new AgentProcess({ spawn }) });
}

test("a codex task run is invoked with the bypassed sandbox and the whole argv the CLI expects", async () => {
  const spawn = stubSpawn({ stdout: codexStdout() });
  const lastMessagePath = "D:\\runs\\evaluation-0001\\reference\\last-message.txt";

  await codexAdapterWith(spawn).run(
    requestFor(armFor("codex", { model: "gpt-5.6-terra", effort: "high" }), { lastMessagePath })
  );

  assert.equal(spawn.calls[0].file, CODEX_CLI_PATH);
  assert.deepEqual(spawn.calls[0].args, [
    "exec",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--json",
    "-C",
    WORKSPACE_PATH,
    "-m",
    "gpt-5.6-terra",
    "-c",
    "model_reasoning_effort=high",
    "--dangerously-bypass-approvals-and-sandbox",
    "-o",
    lastMessagePath,
    "-",
  ]);
});

test("a codex review run keeps the read-only sandbox and never bypasses approvals", async () => {
  const spawn = stubSpawn({ stdout: codexStdout() });

  await codexAdapterWith(spawn).run(
    requestFor(armFor("codex", { model: "gpt-5.6-terra", effort: "medium" }), { role: "review" })
  );

  const args = spawn.calls[0].args;
  assert.deepEqual(args.slice(args.indexOf("-c") + 2), ["--sandbox", "read-only", "-"]);
  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
});

test("a codex run points CODEX_HOME at the isolated home it was given", async () => {
  const spawn = stubSpawn({ stdout: codexStdout() });
  const home = agentHome("codex", "D:\\runs\\evaluation-0001\\home\\codex", "CODEX_HOME");

  await codexAdapterWith(spawn).run(
    requestFor(armFor("codex", { model: "gpt-5.6-terra" }), { home })
  );

  assert.equal(spawn.calls[0].options.env.CODEX_HOME, "D:\\runs\\evaluation-0001\\home\\codex");
});

test("a codex run sends the prompt on stdin", async () => {
  const spawn = stubSpawn({ stdout: codexStdout() });

  await codexAdapterWith(spawn).run(requestFor(armFor("codex", { model: "gpt-5.6-terra" })));

  assert.deepEqual(spawn.calls[0].stdinWrites, [
    "Add unit tests for the invoice total calculation.",
  ]);
});

test("codex usage is taken from the last completed turn and reports no cost", async () => {
  const spawn = stubSpawn({
    stdout:
      jsonLines([{ type: "turn.completed", usage: { input_tokens: 4096, output_tokens: 64 } }]) +
      codexStdout(),
  });

  const record = await codexAdapterWith(spawn).run(
    requestFor(armFor("codex", { model: "gpt-5.6-terra" }))
  );

  assert.deepEqual(record.usage, {
    inputTokens: 18187,
    cachedInputTokens: 12416,
    cacheWriteInputTokens: 0,
    outputTokens: 258,
    reasoningOutputTokens: 0,
    costUsd: null,
  });
});

test("a codex run that exits zero without completing a turn is a failure, not a success", async () => {
  const spawn = stubSpawn({
    stdout: jsonLines([
      { type: "turn.started" },
      { type: "item.completed", item: { type: "agent_message", text: "Added the unit tests." } },
    ]),
    exitCode: 0,
  });

  const record = await codexAdapterWith(spawn).run(
    requestFor(armFor("codex", { model: "gpt-5.6-terra" }))
  );

  assert.equal(record.status, "failed");
  assert.equal(record.failureReason, "no-completed-turn");
  assert.equal(record.exitCode, 0);
});

test("codex model and effort are read from the rollout file, which is the only place they appear", async () => {
  const tempRoot = makeTempRoot();
  try {
    const homePath = path.join(tempRoot, "home", "codex");
    const rolloutPath = path.join(homePath, "sessions", "2026", "09", "20", "rollout-test.jsonl");
    fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
    fs.writeFileSync(
      rolloutPath,
      jsonLines([
        { type: "session_meta", payload: { id: "session-placeholder" } },
        { type: "turn_context", payload: { model: "gpt-5.6-terra", effort: "high" } },
      ]),
      "utf8"
    );
    const spawn = stubSpawn({ stdout: codexStdout() });

    const record = await codexAdapterWith(spawn).run(
      requestFor(armFor("codex", { model: "gpt-5.6-terra", effort: "high" }), {
        home: agentHome("codex", homePath, "CODEX_HOME"),
      })
    );

    assert.equal(record.modelReported, "gpt-5.6-terra");
    assert.equal(record.effortReported, "high");
    assert.equal(record.effortConfirmed(), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a codex run with no rollout file reports no model or effort and does not claim the effort was applied", async () => {
  const tempRoot = makeTempRoot();
  try {
    const homePath = path.join(tempRoot, "home", "codex");
    fs.mkdirSync(homePath, { recursive: true });
    const spawn = stubSpawn({ stdout: codexStdout() });

    const record = await codexAdapterWith(spawn).run(
      requestFor(armFor("codex", { model: "gpt-5.6-terra", effort: "high" }), {
        home: agentHome("codex", homePath, "CODEX_HOME"),
      })
    );

    assert.equal(record.modelReported, null);
    assert.equal(record.effortReported, null);
    assert.equal(record.effortConfirmed(), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a codex skill named in the transcript is reported as activated with the mention as evidence", async () => {
  const spawn = stubSpawn({
    stdout: codexStdout({ messageText: "Followed testing-discipline while writing the tests." }),
  });
  const arm = armFor("codex", {
    model: "gpt-5.6-terra",
    subjects: [skillSubject("testing-discipline")],
  });

  const record = await codexAdapterWith(spawn).run(requestFor(arm));

  const signal = record.signalFor("testing-discipline");
  assert.equal(signal.state, "activated");
  assert.equal(signal.evidence, "Transcript mentions testing-discipline.");
});

test("a codex skill absent from the transcript is undetermined, because codex emits no skill-load event", async () => {
  const spawn = stubSpawn({ stdout: codexStdout({ messageText: "Added the unit tests." }) });
  const arm = armFor("codex", {
    model: "gpt-5.6-terra",
    subjects: [skillSubject("testing-discipline")],
  });

  const record = await codexAdapterWith(spawn).run(requestFor(arm));

  const signal = record.signalFor("testing-discipline");
  assert.equal(signal.state, "undetermined");
  assert.notEqual(signal.state, "not-activated");
  assert.equal(signal.evidence.includes("no skill-load"), true);
  assert.equal(signal.isDetermined(), false);
});

test("a codex instruction-file subject gets no activation signal, because it is always in force", async () => {
  const spawn = stubSpawn({ stdout: codexStdout() });
  const arm = armFor("codex", {
    model: "gpt-5.6-terra",
    subjects: [instructionFileSubject("AGENTS.md"), skillSubject("testing-discipline")],
  });

  const record = await codexAdapterWith(spawn).run(requestFor(arm));

  assert.equal(record.signalFor("AGENTS.md"), null);
  assert.deepEqual(
    record.activationSignals.map((signal) => signal.subjectName),
    ["testing-discipline"]
  );
});

test("a claude task run is invoked with bypassed permissions and the whole argv the CLI expects", async () => {
  const spawn = stubSpawn({ stdout: claudeStdout() });

  await claudeAdapterWith(spawn).run(
    requestFor(armFor("claude", { model: "opus-5", effort: "high" }))
  );

  assert.equal(spawn.calls[0].file, CLAUDE_CLI_PATH);
  assert.deepEqual(spawn.calls[0].args, [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "opus-5",
    "--effort",
    "high",
    "--permission-mode",
    "bypassPermissions",
  ]);
});

test("a claude review run asks for plan mode rather than bypassed permissions", async () => {
  const spawn = stubSpawn({ stdout: claudeStdout() });

  await claudeAdapterWith(spawn).run(
    requestFor(armFor("claude", { model: "opus-5", effort: "medium" }), { role: "review" })
  );

  const args = spawn.calls[0].args;
  assert.deepEqual(args.slice(-2), ["--permission-mode", "plan"]);
  assert.equal(args.includes("bypassPermissions"), false);
});

test("a claude run points CLAUDE_CONFIG_DIR at the isolated home it was given", async () => {
  const spawn = stubSpawn({ stdout: claudeStdout() });
  const home = agentHome("claude", "D:\\runs\\evaluation-0001\\home\\claude", "CLAUDE_CONFIG_DIR");

  await claudeAdapterWith(spawn).run(requestFor(armFor("claude", { model: "opus-5" }), { home }));

  assert.equal(
    spawn.calls[0].options.env.CLAUDE_CONFIG_DIR,
    "D:\\runs\\evaluation-0001\\home\\claude"
  );
});

test("claude usage and cost are taken from the result event", async () => {
  const spawn = stubSpawn({ stdout: claudeStdout() });

  const record = await claudeAdapterWith(spawn).run(
    requestFor(armFor("claude", { model: "opus-5" }))
  );

  assert.deepEqual(record.usage, {
    inputTokens: 9241,
    cachedInputTokens: 7680,
    cacheWriteInputTokens: 1024,
    outputTokens: 612,
    reasoningOutputTokens: 448,
    costUsd: 0.4213,
  });
});

test("claude reports the model named by the result event's model usage", async () => {
  const spawn = stubSpawn({ stdout: claudeStdout() });

  const record = await claudeAdapterWith(spawn).run(
    requestFor(armFor("claude", { model: "opus-5" }))
  );

  assert.equal(record.modelReported, "claude-opus-5-20260501");
});

test("claude falls back to the system event's model when the result reports no model usage", async () => {
  const spawn = stubSpawn({
    stdout: claudeStdout({ result: { modelUsage: {} }, systemModel: "claude-opus-5-20260501" }),
  });

  const record = await claudeAdapterWith(spawn).run(
    requestFor(armFor("claude", { model: "opus-5" }))
  );

  assert.equal(record.modelReported, "claude-opus-5-20260501");
});

test("claude reports no effort, so a requested effort is never claimed as applied", async () => {
  const spawn = stubSpawn({ stdout: claudeStdout() });

  const record = await claudeAdapterWith(spawn).run(
    requestFor(armFor("claude", { model: "opus-5", effort: "high" }))
  );

  assert.equal(record.effortRequested, "high");
  assert.equal(record.effortReported, null);
  assert.equal(record.effortConfirmed(), false);
});

test("a claude run reporting that it is not logged in fails even though the CLI exits zero", async () => {
  const spawn = stubSpawn({
    stdout: "Not logged in. Run the login command to authenticate.\n",
    exitCode: 0,
  });

  const record = await claudeAdapterWith(spawn).run(
    requestFor(armFor("claude", { model: "opus-5" }))
  );

  assert.equal(record.status, "failed");
  assert.equal(record.failureReason, "not-logged-in");
  assert.equal(record.exitCode, 0);
});

test("the last message of a claude run is the result event's text", async () => {
  const spawn = stubSpawn({ stdout: claudeStdout() });

  const record = await claudeAdapterWith(spawn).run(
    requestFor(armFor("claude", { model: "opus-5" }))
  );

  assert.equal(record.lastMessage, "Added the unit tests.");
});

test("a claude skill named by a tool use is reported as activated", async () => {
  const spawn = stubSpawn({
    stdout: claudeStdout({
      toolUses: [{ name: "Skill", input: { skill: "testing-discipline" } }],
    }),
  });
  const arm = armFor("claude", {
    model: "opus-5",
    subjects: [skillSubject("testing-discipline")],
  });

  const record = await claudeAdapterWith(spawn).run(requestFor(arm));

  const signal = record.signalFor("testing-discipline");
  assert.equal(signal.state, "activated");
  assert.equal(signal.evidence, "Skill tool use referenced testing-discipline.");
});

test("a claude skill missing from the recorded tool uses is reported as not activated", async () => {
  const spawn = stubSpawn({
    stdout: claudeStdout({
      toolUses: [
        { name: "Read", input: { file_path: "D:\\runs\\evaluation-0001\\workspace\\invoice.js" } },
        { name: "Write", input: { file_path: "D:\\runs\\evaluation-0001\\workspace\\invoice.test.js" } },
      ],
    }),
  });
  const arm = armFor("claude", {
    model: "opus-5",
    subjects: [skillSubject("testing-discipline")],
  });

  const record = await claudeAdapterWith(spawn).run(requestFor(arm));

  const signal = record.signalFor("testing-discipline");
  assert.equal(signal.state, "not-activated");
  assert.equal(signal.evidence, "2 tool uses recorded, none referencing testing-discipline.");
});

test("a claude transcript with no tool uses at all leaves activation undetermined", async () => {
  const spawn = stubSpawn({ stdout: claudeStdout({ toolUses: [] }) });
  const arm = armFor("claude", {
    model: "opus-5",
    subjects: [skillSubject("testing-discipline")],
  });

  const record = await claudeAdapterWith(spawn).run(requestFor(arm));

  const signal = record.signalFor("testing-discipline");
  assert.equal(signal.state, "undetermined");
  assert.equal(signal.evidence, "The transcript records no tool uses at all.");
});
