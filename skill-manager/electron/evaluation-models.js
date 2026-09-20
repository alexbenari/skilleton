const fs = require("fs");
const os = require("os");
const path = require("path");

const { listFileNames } = require("./evaluation-fs");

// Both CLIs cache the model list their account can actually use. Reading those
// caches keeps the app's dropdowns current without shipping a list that goes
// stale; the fallbacks only cover a machine where a CLI has never run.
const FALLBACK_MODELS = {
  codex: [
    { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
    { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
  ],
  claude: [
    { id: "claude-opus-5", name: "Opus 5", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "claude-fable-5-1", name: "Fable 5.1", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "claude-sonnet-5", name: "Sonnet 5", efforts: ["low", "medium", "high", "xhigh", "max"] },
  ],
};

const DEFAULT_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function readJson(filePath, fileSystem) {
  try {
    return JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function codexCatalogPath(env) {
  return path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "models_cache.json");
}

function readCodexModels(fileSystem, env) {
  const parsed = readJson(codexCatalogPath(env), fileSystem);
  if (!parsed || !Array.isArray(parsed.models)) {
    return null;
  }
  const models = parsed.models
    .filter((model) => model.slug)
    .map((model) => ({
      id: model.slug,
      name: model.display_name || model.slug,
      defaultEffort: model.default_reasoning_level || null,
      efforts: Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels.map((level) => level.effort).filter(Boolean)
        : DEFAULT_EFFORTS,
    }));
  return models.length > 0 ? models : null;
}

function claudeCatalogDirectory() {
  return path.join(os.homedir(), ".claude", "cache", "model-catalog");
}

function newestClaudeCatalog(fileSystem) {
  const directory = claudeCatalogDirectory();
  const names = listFileNames(directory, fileSystem).filter((name) => name.endsWith(".json"));
  if (names.length === 0) {
    return null;
  }
  const newest = names
    .map((name) => {
      const filePath = path.join(directory, name);
      return { filePath, modifiedMs: fileSystem.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.modifiedMs - left.modifiedMs)[0];
  return readJson(newest.filePath, fileSystem);
}

function readClaudeModels(fileSystem) {
  const parsed = newestClaudeCatalog(fileSystem);
  const entries = parsed && parsed.catalog && parsed.catalog.config
    ? parsed.catalog.config.models
    : null;
  if (!Array.isArray(entries)) {
    return null;
  }
  const models = entries
    .filter((model) => model && model.id)
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      defaultEffort: null,
      efforts:
        model.thinking && Array.isArray(model.thinking.effort_options)
          ? model.thinking.effort_options.map((option) => option.id).filter(Boolean)
          : DEFAULT_EFFORTS,
    }));
  return models.length > 0 ? models : null;
}

const READERS = {
  codex: (fileSystem, env) => readCodexModels(fileSystem, env),
  claude: (fileSystem) => readClaudeModels(fileSystem),
};

function listModels({ agent, fileSystem = fs, env = process.env } = {}) {
  const read = READERS[agent];
  if (!read) {
    return [];
  }
  const models = read(fileSystem, env) || FALLBACK_MODELS[agent] || [];
  return models.map((model) => ({
    ...model,
    efforts: model.efforts && model.efforts.length > 0 ? model.efforts : DEFAULT_EFFORTS,
  }));
}

function listModelsByAgent({ agents, fileSystem = fs, env = process.env } = {}) {
  return Object.fromEntries(
    agents.map((agent) => [agent, listModels({ agent, fileSystem, env })])
  );
}

module.exports = {
  listModels,
  listModelsByAgent,
  FALLBACK_MODELS,
  DEFAULT_EFFORTS,
};
