#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const { createDBAdapter } = require("../electron/skill-library-db");
const { normalizeTags } = require("../electron/skill-library");

const LIBRARY_METADATA_FILENAME = ".skill-library-manager.json";
const APP_NAME = "skill-library-manager";
const DATABASE_FILENAME = "skill-manager.sqlite";

function usage() {
  return [
    "Usage:",
    "  node scripts/migrate-json-tags-to-sqlite.js --library-root <path> [--db-path <path>]",
    "",
    "Options:",
    "  --library-root   Absolute or relative path to the library root that still has",
    "                   .skill-library-manager.json.",
    "  --db-path        Optional override for the SQLite database path.",
    "                   Defaults to SKILL_MANAGER_DB_PATH or the Electron userData path.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    if (key === "help") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function defaultDatabasePath() {
  if (process.env.SKILL_MANAGER_DB_PATH) {
    return process.env.SKILL_MANAGER_DB_PATH;
  }

  if (process.platform === "win32") {
    const appDataRoot = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appDataRoot, APP_NAME, DATABASE_FILENAME);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME, DATABASE_FILENAME);
  }

  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configRoot, APP_NAME, DATABASE_FILENAME);
}

function readLegacySkillTags(libraryRoot) {
  const metadataPath = path.join(libraryRoot, LIBRARY_METADATA_FILENAME);
  if (!fs.existsSync(metadataPath) || !fs.statSync(metadataPath).isFile()) {
    throw new Error(`Legacy metadata file not found: ${metadataPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${metadataPath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object in ${metadataPath}`);
  }

  const rawSkillTags = parsed.skill_tags;
  if (rawSkillTags === undefined) {
    return {};
  }
  if (!rawSkillTags || typeof rawSkillTags !== "object" || Array.isArray(rawSkillTags)) {
    throw new Error(`Expected skill_tags to be an object in ${metadataPath}`);
  }

  const normalized = {};
  for (const [skillName, rawTags] of Object.entries(rawSkillTags)) {
    if (!skillName.trim()) {
      continue;
    }
    normalized[skillName] = normalizeTags(rawTags);
  }
  return normalized;
}

function findLibraryByRoot(db, libraryRoot) {
  const normalizedRoot = path.resolve(libraryRoot);
  return db.listLibraries().find((library) => path.resolve(library.localPath) === normalizedRoot) || null;
}

function printResult(result, databasePath, libraryRoot) {
  console.log(`Database: ${databasePath}`);
  console.log(`Library: ${libraryRoot}`);
  console.log(`Updated skills: ${result.updatedSkillNames.length}`);
  console.log(`Imported tags: ${result.uniqueTagsImported.length}`);
  console.log(`Ignored missing skills: ${result.missingSkillNames.length}`);

  if (result.updatedSkillNames.length) {
    console.log(`Updated: ${result.updatedSkillNames.join(", ")}`);
  }
  if (result.uniqueTagsImported.length) {
    console.log(`Tags: ${result.uniqueTagsImported.join(", ")}`);
  }
  if (result.missingSkillNames.length) {
    console.log(`Ignored: ${result.missingSkillNames.join(", ")}`);
  }
}

function main() {
  let db = null;

  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }

    if (!args["library-root"]) {
      throw new Error("--library-root is required.");
    }

    const libraryRoot = path.resolve(args["library-root"]);
    const databasePath = path.resolve(args["db-path"] || defaultDatabasePath());
    const skillTagsByName = readLegacySkillTags(libraryRoot);

    db = createDBAdapter({ databasePath });
    db.initialize();

    const library = findLibraryByRoot(db, libraryRoot);
    if (!library) {
      throw new Error(
        `Skill library ${libraryRoot} is not present in the database. Add or load it in the app first.`
      );
    }

    const result = db.importTagsForExistingSkills(library.id, skillTagsByName);
    printResult(result, databasePath, libraryRoot);
  } catch (error) {
    console.error(error.message || String(error));
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  } finally {
    if (db) {
      db.close();
    }
  }
}

main();
