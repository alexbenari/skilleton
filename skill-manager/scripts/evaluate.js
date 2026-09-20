const fs = require("fs");
const path = require("path");

const { EvaluationCatalog } = require("../electron/evaluation-catalog");
const { EvaluationDefinitionBuilder } = require("../electron/evaluation-definition-builder");
const { EvaluationStore } = require("../electron/evaluation-store");
const { resolveCatalogRoot, resolveStoreRoot } = require("../electron/evaluation-paths");

const USAGE = `Usage: node scripts/evaluate.js <command> [options]

Commands:
  list                        List evaluation targets and scenarios.
  define --input <file.json>  Build and save an evaluation definition.
  show <definitionId>         Print a saved definition.

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
