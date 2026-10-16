const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

class AgentProcessError extends Error {}

// Every CLI failure mode this has to survive is a silent one: a hung process, a
// cancelled evaluation, or an exit code of 0 over a run that never produced a
// turn. So the outcome carries the raw streams and lets the adapter judge.
class ProcessOutcome {
  constructor({ exitCode, stdout, stderr, timedOut, canceled, spawnError, durationMs, startedAt, endedAt }) {
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.timedOut = timedOut;
    this.canceled = canceled;
    this.spawnError = spawnError;
    this.durationMs = durationMs;
    this.startedAt = startedAt;
    this.endedAt = endedAt;
    Object.freeze(this);
  }

  status() {
    if (this.canceled) {
      return "canceled";
    }
    if (this.timedOut) {
      return "timed-out";
    }
    if (this.spawnError || this.exitCode !== 0) {
      return "failed";
    }
    return "completed";
  }
}

class AgentProcess {
  constructor({ spawn = childProcess.spawn, fileSystem = fs } = {}) {
    this.spawn = spawn;
    this.fileSystem = fileSystem;
  }

  run({ file, args, cwd, env, stdin = null, timeoutMs, signal = null, transcriptPath = null, onEvent = null }) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let pending = "";
      let settled = false;
      let timedOut = false;
      let canceled = false;
      let child;
      // Declared before the spawn attempt: a synchronous spawn failure reaches
      // finish() first, and a const declared after the try would still be in
      // its dead zone there, turning every wrong CLI path into a rejection.
      let timer = null;

      const finish = (extra) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        if (transcriptPath) {
          this.writeTranscript(transcriptPath, stdout);
        }
        resolve(
          new ProcessOutcome({
            stdout,
            stderr,
            timedOut,
            canceled,
            durationMs: Date.now() - startedMs,
            startedAt,
            endedAt: new Date().toISOString(),
            exitCode: null,
            spawnError: null,
            ...extra,
          })
        );
      };

      const onAbort = () => {
        canceled = true;
        if (child) {
          child.kill("SIGKILL");
        }
      };

      try {
        child = this.spawn(file, args, { cwd, env, windowsHide: true });
      } catch (error) {
        finish({ spawnError: error.message });
        return;
      }

      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      child.stdout?.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (!onEvent) {
          return;
        }
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";
        for (const line of lines) {
          if (line.trim() === "") {
            continue;
          }
          try {
            onEvent(JSON.parse(line));
          } catch {
            onEvent({ type: "raw", line });
          }
        }
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => finish({ spawnError: error.message }));
      child.on("close", (code) => finish({ exitCode: code }));

      if (stdin !== null && child.stdin) {
        child.stdin.end(stdin);
      }
    });
  }

  writeTranscript(transcriptPath, stdout) {
    try {
      this.fileSystem.mkdirSync(path.dirname(transcriptPath), { recursive: true });
      this.fileSystem.writeFileSync(transcriptPath, stdout, "utf8");
    } catch {
      // A transcript we cannot persist must not turn a finished run into a failure.
    }
  }
}

function parseJsonLines(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return events;
}

module.exports = {
  AgentProcessError,
  AgentProcess,
  ProcessOutcome,
  parseJsonLines,
};
