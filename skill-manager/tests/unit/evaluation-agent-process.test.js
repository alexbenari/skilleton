const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("node:events");

const { AgentProcess, parseJsonLines } = require("../../electron/evaluation-agent-process");

// Stands in for a spawned CLI. The caller scripts the chunks the fake child
// writes and how it ends; the fake records the argv, options, stdin and kill
// signals it saw. Data and close arrive on a later tick, as they would from a
// real child process, so nothing resolves before the listeners are attached.
function stubSpawn({
  stdoutChunks = [],
  stderrChunks = [],
  exitCode = 0,
  closesOnItsOwn = true,
} = {}) {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const call = { file, args, options, stdinWrites: [], killSignals: [] };
    child.stdin = { end: (text) => call.stdinWrites.push(text) };
    child.kill = (signal) => {
      call.killSignals.push(signal);
      setImmediate(() => child.emit("close", null));
    };
    calls.push(call);
    setImmediate(() => {
      for (const chunk of stdoutChunks) {
        child.stdout.emit("data", Buffer.from(chunk));
      }
      for (const chunk of stderrChunks) {
        child.stderr.emit("data", Buffer.from(chunk));
      }
      if (closesOnItsOwn) {
        child.emit("close", exitCode);
      }
    });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-agent-process-"));
}

test("a process that writes output and exits zero is completed with its streams captured", async () => {
  const spawn = stubSpawn({
    stdoutChunks: ['{"type":"turn.completed"}\n'],
    stderrChunks: ["warning: workspace is not a git repository\n"],
    exitCode: 0,
  });

  const outcome = await new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    cwd: "D:\\runs\\workspace",
    timeoutMs: 5000,
  });

  assert.equal(outcome.status(), "completed");
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.stdout, '{"type":"turn.completed"}\n');
  assert.equal(outcome.stderr, "warning: workspace is not a git repository\n");
});

test("a non-zero exit code is a failed process", async () => {
  const spawn = stubSpawn({ stderrChunks: ["error: model is not available\n"], exitCode: 2 });

  const outcome = await new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    timeoutMs: 5000,
  });

  assert.equal(outcome.status(), "failed");
  assert.equal(outcome.exitCode, 2);
});

test("a spawn that throws reports the spawn error instead of rejecting", async () => {
  const spawn = () => {
    throw new Error("spawn C:\\tools\\codex.exe ENOENT");
  };

  const outcome = await new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    timeoutMs: 5000,
  });

  assert.equal(outcome.status(), "failed");
  assert.equal(outcome.spawnError, "spawn C:\\tools\\codex.exe ENOENT");
  assert.equal(outcome.exitCode, null);
});

test("a process still running at the timeout is killed and reported as timed out", async () => {
  const spawn = stubSpawn({ stdoutChunks: ['{"type":"turn.started"}\n'], closesOnItsOwn: false });

  const outcome = await new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    timeoutMs: 50,
  });

  assert.equal(outcome.status(), "timed-out");
  assert.equal(outcome.timedOut, true);
  assert.deepEqual(spawn.calls[0].killSignals, ["SIGKILL"]);
});

test("an already aborted signal kills the process and reports it as canceled", async () => {
  const spawn = stubSpawn({ closesOnItsOwn: false });
  const controller = new AbortController();
  controller.abort();

  const outcome = await new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    timeoutMs: 5000,
    signal: controller.signal,
  });

  assert.equal(outcome.status(), "canceled");
  assert.equal(outcome.canceled, true);
  assert.deepEqual(spawn.calls[0].killSignals, ["SIGKILL"]);
});

test("a signal aborted while the process runs kills it and reports it as canceled", async () => {
  const spawn = stubSpawn({ stdoutChunks: ['{"type":"turn.started"}\n'], closesOnItsOwn: false });
  const controller = new AbortController();

  const running = new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    timeoutMs: 5000,
    signal: controller.signal,
  });
  setImmediate(() => controller.abort());
  const outcome = await running;

  assert.equal(outcome.status(), "canceled");
  assert.deepEqual(spawn.calls[0].killSignals, ["SIGKILL"]);
});

test("onEvent receives one parsed event per JSONL line and raw text for a line that is not JSON", async () => {
  const spawn = stubSpawn({
    stdoutChunks: [
      '{"type":"turn.started"}\n' +
        "preparing workspace\n" +
        '{"type":"turn.completed","usage":{"output_tokens":258}}\n',
    ],
  });
  const events = [];

  await new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    timeoutMs: 5000,
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(events, [
    { type: "turn.started" },
    { type: "raw", line: "preparing workspace" },
    { type: "turn.completed", usage: { output_tokens: 258 } },
  ]);
});

test("a JSONL line split across two chunks reaches onEvent once and whole", async () => {
  const spawn = stubSpawn({
    stdoutChunks: ['{"type":"item.completed","it', 'emId":"item_7"}\n'],
  });
  const events = [];

  await new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    timeoutMs: 5000,
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(events, [{ type: "item.completed", itemId: "item_7" }]);
});

test("the transcript file records the raw stdout of the run", async () => {
  const tempRoot = makeTempRoot();
  try {
    const transcriptPath = path.join(tempRoot, "runs", "reference", "transcript.jsonl");
    const stdout = '{"type":"turn.started"}\n{"type":"turn.completed"}\n';
    const spawn = stubSpawn({ stdoutChunks: [stdout] });

    await new AgentProcess({ spawn }).run({
      file: "C:\\tools\\codex.exe",
      args: ["exec", "-"],
      timeoutMs: 5000,
      transcriptPath,
    });

    assert.equal(fs.readFileSync(transcriptPath, "utf8"), stdout);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the prompt given as stdin is written to the child and the child is closed", async () => {
  const spawn = stubSpawn();

  await new AgentProcess({ spawn }).run({
    file: "C:\\tools\\codex.exe",
    args: ["exec", "-"],
    timeoutMs: 5000,
    stdin: "Summarize the invoice module.",
  });

  assert.deepEqual(spawn.calls[0].stdinWrites, ["Summarize the invoice module."]);
});

test("parseJsonLines keeps the JSON lines in order and skips blank and non-JSON lines", () => {
  const text =
    '{"type":"turn.started"}\n' +
    "\n" +
    "preparing workspace\n" +
    '{"type":"item.completed","itemId":"item_7"}\n' +
    "{not json at all}\n" +
    '{"type":"turn.completed"}\n';

  assert.deepEqual(parseJsonLines(text), [
    { type: "turn.started" },
    { type: "item.completed", itemId: "item_7" },
    { type: "turn.completed" },
  ]);
});
