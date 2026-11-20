const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { discoverCliPath } = require("../../electron/evaluation-paths");
const { makeTempRoot, writeFile } = require("../helpers/temp-files");

// A machine as discovery sees it, with no CLI installed until a test adds one.
function machineUnder(tempRoot) {
  const homeDirectory = path.join(tempRoot, "home");
  const env = {
    LOCALAPPDATA: path.join(tempRoot, "local"),
    APPDATA: path.join(tempRoot, "roaming"),
  };
  return { homeDirectory, env };
}

function bundledClaudePath(localAppData, version, build) {
  return path.join(
    localAppData,
    "Claude-Data",
    "claude_pzs8sxrjxfjjc",
    "claude-code",
    version,
    build,
    "claude.exe"
  );
}

function installBundledClaude(machine, { version, build, writtenAt = null }) {
  const cliPath = writeFile(bundledClaudePath(machine.env.LOCALAPPDATA, version, build), "bundled");
  if (writtenAt) {
    fs.utimesSync(cliPath, writtenAt, writtenAt);
  }
  return cliPath;
}

function installStandaloneClaude(machine) {
  return writeFile(path.join(machine.homeDirectory, ".local", "bin", "claude.exe"), "standalone");
}

test("the Claude CLI the desktop app bundles is found under its package, version and build folders", () => {
  const tempRoot = makeTempRoot();
  try {
    const machine = machineUnder(tempRoot);
    const bundled = installBundledClaude(machine, { version: "2.1.326", build: "d31a4581af92" });

    assert.equal(discoverCliPath("claude", machine), bundled);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the bundled Claude CLI is chosen over a standalone one, even one written more recently", () => {
  const tempRoot = makeTempRoot();
  try {
    const machine = machineUnder(tempRoot);
    const bundled = installBundledClaude(machine, {
      version: "2.1.326",
      build: "d31a4581af92",
      writtenAt: new Date("2026-01-05T10:00:00Z"),
    });
    installStandaloneClaude(machine);

    assert.equal(discoverCliPath("claude", machine), bundled);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("of two bundled Claude versions the one written most recently is chosen", () => {
  const tempRoot = makeTempRoot();
  try {
    const machine = machineUnder(tempRoot);
    const newer = installBundledClaude(machine, {
      version: "2.1.326",
      build: "d31a4581af92",
      writtenAt: new Date("2026-11-18T10:00:00Z"),
    });
    installBundledClaude(machine, {
      version: "2.1.325",
      build: "0c9e77b1a2f4",
      writtenAt: new Date("2026-11-11T10:00:00Z"),
    });

    assert.equal(discoverCliPath("claude", machine), newer);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a standalone Claude CLI is found when the desktop app is not installed", () => {
  const tempRoot = makeTempRoot();
  try {
    const machine = machineUnder(tempRoot);
    const standalone = installStandaloneClaude(machine);

    assert.equal(discoverCliPath("claude", machine), standalone);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the Codex CLI is found under its build folder in the local app-data folder", () => {
  const tempRoot = makeTempRoot();
  try {
    const machine = machineUnder(tempRoot);
    const codex = writeFile(
      path.join(machine.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "c38161ad8494f88c", "codex.exe"),
      "codex"
    );

    assert.equal(discoverCliPath("codex", machine), codex);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("without LOCALAPPDATA in the environment the local app-data folder is taken to be under the home folder", () => {
  const tempRoot = makeTempRoot();
  try {
    const homeDirectory = path.join(tempRoot, "home");
    const bundled = writeFile(
      bundledClaudePath(path.join(homeDirectory, "AppData", "Local"), "2.1.326", "d31a4581af92"),
      "bundled"
    );

    assert.equal(discoverCliPath("claude", { homeDirectory, env: {} }), bundled);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
