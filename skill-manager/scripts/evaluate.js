const fs = require("fs");
const path = require("path");

const os = require("os");

const { EvaluationCatalog } = require("../electron/evaluation-catalog");
const { EvaluationDefinitionBuilder } = require("../electron/evaluation-definition-builder");
const { EvaluationStore } = require("../electron/evaluation-store");
const { createEvaluationService } = require("../electron/evaluation-wiring");
const { resolveCatalogRoot, resolveStoreRoot } = require("../electron/evaluation-paths");

const USAGE = `Usage: node scripts/evaluate.js <command> [options]

Commands:
  list                        List evaluation targets and scenarios.
  define --input <file.json>  Build and save an evaluation definition.
  show <definitionId>         Print a saved definition.
  run <definitionId>          Run both arms and build the blinded review bundle.
  review <comparisonId>       Record a user verdict from --input <file.json>.
  report <comparisonId>       Print the path of a comparison's report.

Options:
  --catalog <dir>   Catalog root (default: skill-manager/evaluations)
  --store <dir>     Store root (default: skill-manager/evaluations-data)
`;

function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        options[name] = true;
      } else {
        options[name] = next;
        index += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, options };
}

function buildCatalog(options) {
  return new EvaluationCatalog({
    rootPath: resolveCatalogRoot({ override: options.catalog || null }),
  });
}

function buildStore(options) {
  return new EvaluationStore({
    rootPath: resolveStoreRoot({ override: options.store || null }),
  });
}

function commandList(options) {
  const catalog = buildCatalog(options);
  const targets = catalog.listTargets();
  const scenarios = catalog.listScenarios();
  process.stdout.write(`Catalog root: ${catalog.rootPath}\n\n`);
  process.stdout.write(`Targets (${targets.length}):\n`);
  for (const target of targets) {
    process.stdout.write(`  ${target.id} [${target.shape}] ${target.description}\n`);
  }
  process.stdout.write(`\nScenarios (${scenarios.length}):\n`);
  for (const scenario of scenarios) {
    const checkSummary = scenario.checks.map((check) => check.id).join(", ") || "none";
    process.stdout.write(`  ${scenario.id} -> target ${scenario.targetId}; checks: ${checkSummary}\n`);
  }
  if (targets.length === 0 && scenarios.length === 0) {
    process.stdout.write("\nThe catalog is empty. Add fixtures and scenarios to populate it.\n");
  }
}

function commandDefine(options) {
  const inputPath = options.input;
  if (!inputPath || inputPath === true) {
    throw new Error("define requires --input <file.json>");
  }
  const request = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
  const catalog = buildCatalog(options);
  const store = buildStore(options);
  const builder = new EvaluationDefinitionBuilder({ catalog });
  const existingVersion = store.latestVersion(request.id);
  const definition = builder.build({
    ...request,
    version: existingVersion === null ? 1 : existingVersion + 1,
  });
  const savedPath = store.saveDefinition(definition);
  process.stdout.write(`Saved ${definition.id} v${definition.version} to ${savedPath}\n`);
  process.stdout.write(`Varied factor: ${definition.variedFactor}\n`);
  if (definition.guidanceDifferenceMode) {
    process.stdout.write(`Guidance difference mode: ${definition.guidanceDifferenceMode}\n`);
  }
  process.stdout.write(`Reference arm: ${definition.referenceArm.describe()}\n`);
  process.stdout.write(`Candidate arm: ${definition.candidateArm.describe()}\n`);
  process.stdout.write(`Comparability key: ${definition.comparabilityKey()}\n`);
}

function commandShow(positional, options) {
  const [, definitionId] = positional;
  if (!definitionId) {
    throw new Error("show requires a definition id");
  }
  const store = buildStore(options);
  const definition = store.loadDefinition(definitionId);
  process.stdout.write(`${JSON.stringify(definition.toJSON(), null, 2)}\n`);
}

function buildService(options) {
  return createEvaluationService({
    tempRootPath: options.temp || os.tmpdir(),
    userDataPath: null,
  });
}

function describeProgress(event) {
  if (event.phase === "run-event") {
    return null;
  }
  if (event.phase === "run-started") {
    return `  ${event.role} run ${event.runIndex} started on ${event.agent}`;
  }
  if (event.phase === "run-finished") {
    const checks = (event.checks || []).map((check) => `${check.id}=${check.status}`).join(", ");
    return `  ${event.role} run ${event.runIndex}: ${event.status}${checks ? ` (${checks})` : ""}`;
  }
  if (event.phase === "arm-started") {
    return `${event.role} arm starting`;
  }
  return `${event.phase}`;
}

async function commandRun(positional, options) {
  const [, definitionId] = positional;
  if (!definitionId) {
    throw new Error("run requires a definition id");
  }
  const service = buildService(options);
  const result = await service.startEvaluation(definitionId, {
    onProgress: (event) => {
      const line = describeProgress(event);
      if (line) {
        process.stdout.write(`${line}\n`);
      }
    },
  });
  process.stdout.write(`\nComparison: ${result.comparisonId}\n`);
  process.stdout.write(`Varied factor: ${result.comparison.variedFactor}\n`);
  for (const note of result.comparison.drift) {
    process.stdout.write(`Drift: ${note}\n`);
  }
  process.stdout.write(`Review bundle: ${result.bundle.rootPath}\n`);
  process.stdout.write(`Blinding: ${result.bundle.blinding}\n`);
  process.stdout.write(
    `Rubric: ${result.bundle.rubric.join(", ")}\n` +
      "Read A/ and B/ in the bundle, then record a verdict with:\n" +
      `  node scripts/evaluate.js review ${result.comparisonId} --input verdict.json\n`
  );
}

async function commandReview(positional, options) {
  const [, comparisonId] = positional;
  if (!comparisonId || !options.input || options.input === true) {
    throw new Error("review requires a comparison id and --input <file.json>");
  }
  const service = buildService(options);
  const input = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
  const result = service.addUserReview(comparisonId, input);
  process.stdout.write(`Report written to ${result.reportPath}\n`);
}

function commandReport(positional, options) {
  const [, comparisonId] = positional;
  if (!comparisonId) {
    throw new Error("report requires a comparison id");
  }
  const service = buildService(options);
  process.stdout.write(`${service.store.reportPath(comparisonId)}\n`);
}

function main(argv) {
  const { positional, options } = parseArguments(argv);
  const [command] = positional;
  switch (command) {
    case "list":
      commandList(options);
      return 0;
    case "define":
      commandDefine(options);
      return 0;
    case "show":
      commandShow(positional, options);
      return 0;
    case "run":
      return commandRun(positional, options);
    case "review":
      return commandReview(positional, options);
    case "report":
      commandReport(positional, options);
      return 0;
    default:
      process.stdout.write(USAGE);
      return command === undefined ? 0 : 1;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
}
