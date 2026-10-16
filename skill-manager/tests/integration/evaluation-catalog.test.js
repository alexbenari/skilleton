const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  EvaluationCatalog,
  EvaluationCatalogError,
} = require("../../electron/evaluation-catalog");

const SAMPLE_PROMPT = "Build the thing the requirements describe.";

function createCatalogRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-catalog-"));
}

function writeTargetDirectory(
  catalogRoot,
  directoryName,
  descriptor,
  contentFiles = { "main.py": "def main():\n    return 0\n" }
) {
  const targetRoot = path.join(catalogRoot, "fixtures", directoryName);
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetRoot, "target.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    "utf8"
  );
  for (const [name, contents] of Object.entries(contentFiles)) {
    const filePath = path.join(targetRoot, "content", name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf8");
  }
  return targetRoot;
}

function writeSampleTarget(catalogRoot) {
  return writeTargetDirectory(catalogRoot, "sample-target", {
    id: "sample-target",
    shape: "generative",
    description: "Sample.",
  });
}

function sampleScenarioMetadata(overrides = {}) {
  return {
    id: "sample-scenario",
    targetId: "sample-target",
    pins: { language: "python" },
    requiresRunManifest: true,
    checks: [{ id: "unit", kind: "validator", command: "manifest:test", timeoutSeconds: 300 }],
    review: {
      dimensions: ["correctness", "structure"],
      guidance: "Judge the output on its own terms.",
    },
    ...overrides,
  };
}

function writeScenarioFileContents(catalogRoot, targetDirectory, fileName, contents) {
  const scenarioDirectory = path.join(catalogRoot, "scenarios", targetDirectory);
  fs.mkdirSync(scenarioDirectory, { recursive: true });
  const filePath = path.join(scenarioDirectory, fileName);
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function writeScenarioFile(
  catalogRoot,
  targetDirectory,
  fileName,
  metadata,
  prompt = SAMPLE_PROMPT
) {
  return writeScenarioFileContents(
    catalogRoot,
    targetDirectory,
    fileName,
    `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${prompt}\n`
  );
}

function messageIncludes(...fragments) {
  return (error) => {
    assert.ok(error instanceof EvaluationCatalogError, `expected an EvaluationCatalogError, got ${error}`);
    for (const fragment of fragments) {
      assert.ok(
        error.message.includes(fragment),
        `expected message to mention ${JSON.stringify(fragment)}, got ${JSON.stringify(error.message)}`
      );
    }
    return true;
  };
}

test("listTargets and getScenario read a well-formed target and scenario from disk", () => {
  const catalogRoot = createCatalogRoot();
  try {
    writeSampleTarget(catalogRoot);
    const scenarioPath = writeScenarioFile(
      catalogRoot,
      "sample-target",
      "sample-scenario.md",
      sampleScenarioMetadata()
    );
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    const targets = catalog.listTargets();
    const scenario = catalog.getScenario("sample-scenario");

    assert.equal(targets.length, 1);
    assert.equal(targets[0].id, "sample-target");
    assert.equal(targets[0].shape, "generative");
    assert.equal(targets[0].isGenerative(), true);
    assert.equal(targets[0].contentPath, path.join(catalogRoot, "fixtures", "sample-target", "content"));
    assert.equal(scenario.filePath, scenarioPath);
    assert.equal(scenario.targetId, "sample-target");
    assert.equal(scenario.prompt, SAMPLE_PROMPT);
    assert.deepEqual(scenario.pins, { language: "python" });
    assert.equal(scenario.requiresRunManifest, true);
    assert.deepEqual(scenario.reviewDimensions, ["correctness", "structure"]);
    assert.equal(scenario.reviewGuidance, "Judge the output on its own terms.");
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("listTargets rejects a target.json id that disagrees with its directory name", () => {
  const catalogRoot = createCatalogRoot();
  try {
    writeTargetDirectory(catalogRoot, "renamed-target", {
      id: "sample-target",
      shape: "generative",
      description: "Sample.",
    });
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    assert.throws(
      () => catalog.listTargets(),
      messageIncludes("sample-target", "renamed-target")
    );
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("listTargets rejects a target with no content directory", () => {
  const catalogRoot = createCatalogRoot();
  try {
    writeTargetDirectory(
      catalogRoot,
      "sample-target",
      { id: "sample-target", shape: "generative", description: "Sample." },
      {}
    );
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    assert.throws(
      () => catalog.listTargets(),
      messageIncludes("sample-target", path.join(catalogRoot, "fixtures", "sample-target", "content"))
    );
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("listScenarios rejects front matter that is not valid JSON", () => {
  const catalogRoot = createCatalogRoot();
  try {
    const scenarioPath = writeScenarioFileContents(
      catalogRoot,
      "sample-target",
      "sample-scenario.md",
      `---\n{ "id": "sample-scenario", }\n---\n\n${SAMPLE_PROMPT}\n`
    );
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    assert.throws(() => catalog.listScenarios(), messageIncludes(scenarioPath, "not valid JSON"));
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("listScenarios rejects a targetId that differs from the enclosing directory", () => {
  const catalogRoot = createCatalogRoot();
  try {
    writeScenarioFile(
      catalogRoot,
      "other-target",
      "sample-scenario.md",
      sampleScenarioMetadata({ targetId: "sample-target" })
    );
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    assert.throws(
      () => catalog.listScenarios(),
      messageIncludes("sample-scenario", "sample-target", "other-target")
    );
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("listScenarios rejects a scenario that names no review dimension", () => {
  const catalogRoot = createCatalogRoot();
  try {
    const scenarioPath = writeScenarioFile(
      catalogRoot,
      "sample-target",
      "sample-scenario.md",
      sampleScenarioMetadata({ review: { dimensions: [], guidance: "" } })
    );
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    assert.throws(
      () => catalog.listScenarios(),
      messageIncludes("sample-scenario", scenarioPath, "review dimension")
    );
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("a check with command manifest:test parses as the manifest test step", () => {
  const catalogRoot = createCatalogRoot();
  try {
    writeScenarioFile(
      catalogRoot,
      "sample-target",
      "sample-scenario.md",
      sampleScenarioMetadata()
    );
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    const [check] = catalog.getScenario("sample-scenario").checks;

    assert.equal(check.id, "unit");
    assert.equal(check.kind, "validator");
    assert.equal(check.isManifestCommand(), true);
    assert.equal(check.manifestStep(), "test");
    assert.equal(check.timeoutSeconds, 300);
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("listScenarios rejects a check whose manifest step is not a known step", () => {
  const catalogRoot = createCatalogRoot();
  try {
    writeScenarioFile(
      catalogRoot,
      "sample-target",
      "sample-scenario.md",
      sampleScenarioMetadata({
        checks: [
          { id: "deploy", kind: "validator", command: "manifest:deploy", timeoutSeconds: 300 },
        ],
      })
    );
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    assert.throws(
      () => catalog.listScenarios(),
      messageIncludes("deploy", "install, build, test, run")
    );
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("listScenarios rejects two scenario files that declare the same id", () => {
  const catalogRoot = createCatalogRoot();
  try {
    const firstPath = writeScenarioFile(
      catalogRoot,
      "sample-target",
      "sample-scenario.md",
      sampleScenarioMetadata()
    );
    const secondPath = writeScenarioFile(
      catalogRoot,
      "sample-target",
      "sample-scenario-copy.md",
      sampleScenarioMetadata()
    );
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });

    assert.throws(
      () => catalog.listScenarios(),
      messageIncludes("sample-scenario", firstPath, secondPath)
    );
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});

test("the target fingerprint changes when a file inside content changes", () => {
  const catalogRoot = createCatalogRoot();
  try {
    const targetRoot = writeSampleTarget(catalogRoot);
    const catalog = new EvaluationCatalog({ rootPath: catalogRoot });
    const before = catalog.getTarget("sample-target").fingerprint;

    fs.writeFileSync(
      path.join(targetRoot, "content", "main.py"),
      "def main():\n    return 1\n",
      "utf8"
    );
    const after = catalog.getTarget("sample-target").fingerprint;

    assert.notEqual(after, before);
  } finally {
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});
