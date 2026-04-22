const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG_FILENAME = "local-skill-library.json";
const SKILL_FILENAME = "SKILL.md";
const SCHEMA_VERSION = 1;
const DEFAULT_LINK_MODE = "junction";

class SkillLibraryError extends Error {}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function configPath() {
  return path.join(codexHome(), CONFIG_FILENAME);
}

function globalSkillsRoot() {
  return path.join(codexHome(), "skills");
}

function globalSkillPath(skillName) {
  return path.join(globalSkillsRoot(), skillName);
}

function normalizePath(targetPath) {
  return path.normalize(fs.realpathSync.native(targetPath)).toLowerCase();
}

function ensureParentDir(targetPath) {
  const parent = path.dirname(targetPath);
  if (parent) {
    fs.mkdirSync(parent, { recursive: true });
  }
}

function firstSentence(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "No description provided.";
  }
  const match = cleaned.match(/(.+?[.!?])(?:\s|$)/);
  return match ? match[1].trim() : cleaned;
}

function descriptionFromSkillMd(skillMdPath) {
  let raw;
  try {
    raw = fs.readFileSync(skillMdPath, "utf8");
  } catch {
    return "No description provided.";
  }
  if (!raw.startsWith("---")) {
    return "No description provided.";
  }
  const lines = raw.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") {
    return "No description provided.";
  }
  const frontmatter = [];
  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      endIndex = index;
      break;
    }
    frontmatter.push(lines[index]);
  }
  if (endIndex === -1) {
    return "No description provided.";
  }
  for (const line of frontmatter) {
    const match = line.match(/^\s*description\s*:\s*(.+?)\s*$/);
    if (!match) {
      continue;
    }
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return firstSentence(value);
  }
  return "No description provided.";
}

function readConfig() {
  const cfgPath = configPath();
  if (!fs.existsSync(cfgPath)) {
    throw new SkillLibraryError(
      `Config file not found: ${cfgPath}. Run set root first.`
    );
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (error) {
    throw new SkillLibraryError(`Failed to read config ${cfgPath}: ${error.message}`);
  }
  if (!data || typeof data !== "object") {
    throw new SkillLibraryError(`Invalid config format in ${cfgPath}.`);
  }
  const root = data.library_root;
  if (typeof root !== "string" || !root.trim()) {
    throw new SkillLibraryError(`Invalid or missing library_root in ${cfgPath}.`);
  }
  if (data.link_mode !== DEFAULT_LINK_MODE) {
    throw new SkillLibraryError(
      `Invalid or unsupported link_mode in ${cfgPath}. Expected ${DEFAULT_LINK_MODE}.`
    );
  }
  const normalizedRoot = path.resolve(root);
  if (!fs.existsSync(normalizedRoot) || !fs.statSync(normalizedRoot).isDirectory()) {
    throw new SkillLibraryError(
      `Configured library root does not exist: ${normalizedRoot}. Set the root again.`
    );
  }
  return {
    ...data,
    library_root: normalizedRoot,
  };
}

function writeConfig(rootPath) {
  const cfgPath = configPath();
  const payload = {
    schema_version: SCHEMA_VERSION,
    library_root: rootPath,
    link_mode: DEFAULT_LINK_MODE,
  };
  ensureParentDir(cfgPath);
  const tmpPath = `${cfgPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, cfgPath);
  } catch (error) {
    throw new SkillLibraryError(`Failed to write config ${cfgPath}: ${error.message}`);
  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.rmSync(tmpPath, { force: true });
    }
  }
  return cfgPath;
}

function discoverSkills(root) {
  const found = new Map();
  const collisions = new Map();
  const stack = [root];
  while (stack.length) {
    const currentRoot = stack.pop();
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(currentRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    dirEntries.sort((a, b) => a.name.localeCompare(b.name));
    const files = dirEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    if (files.includes(SKILL_FILENAME)) {
      const name = path.basename(currentRoot);
      const skillMdPath = path.join(currentRoot, SKILL_FILENAME);
      const record = {
        name,
        path: currentRoot,
        description: descriptionFromSkillMd(skillMdPath),
      };
      if (found.has(name)) {
        if (!collisions.has(name)) {
          collisions.set(name, [found.get(name).path]);
        }
        collisions.get(name).push(currentRoot);
      } else {
        found.set(name, record);
      }
    }
    for (let index = dirEntries.length - 1; index >= 0; index -= 1) {
      const entry = dirEntries[index];
      if (entry.isDirectory()) {
        stack.push(path.join(currentRoot, entry.name));
      }
    }
  }
  return { found, collisions };
}

function failOnCollisions(collisions) {
  if (!collisions.size) {
    return;
  }
  const lines = ["Duplicate skill names found in library:"];
  for (const name of Array.from(collisions.keys()).sort()) {
    lines.push(`- ${name}`);
    for (const collisionPath of collisions.get(name).sort()) {
      lines.push(`  ${collisionPath}`);
    }
  }
  throw new SkillLibraryError(lines.join("\n"));
}

function loadSkillsFromConfig() {
  const cfg = readConfig();
  const { found, collisions } = discoverSkills(cfg.library_root);
  failOnCollisions(collisions);
  return { skills: found, libraryRoot: cfg.library_root };
}

function resolveProjectRoot(project) {
  let start = project ? path.resolve(project) : process.cwd();
  if (fs.existsSync(start) && fs.statSync(start).isFile()) {
    start = path.dirname(start);
  }
  let current = start;
  while (true) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

function projectSkillPath(projectRoot, skillName) {
  return path.join(projectRoot, ".agents", "skills", skillName);
}

function entryState(entryPath, skillPath) {
  if (!fs.existsSync(entryPath)) {
    return { installed: false, conflict: false };
  }
  let equivalent = false;
  try {
    equivalent = normalizePath(entryPath) === normalizePath(skillPath);
  } catch {
    equivalent = false;
  }
  return equivalent
    ? { installed: true, conflict: false }
    : { installed: false, conflict: true };
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  let stats;
  try {
    stats = fs.lstatSync(targetPath);
  } catch (error) {
    throw new SkillLibraryError(`Failed to inspect ${targetPath}: ${error.message}`);
  }
  try {
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
      return;
    }
    if (stats.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    }
    fs.rmSync(targetPath, { force: true });
  } catch (error) {
    throw new SkillLibraryError(`Failed to remove ${targetPath}: ${error.message}`);
  }
}

function createJunction(linkPath, targetPath) {
  ensureParentDir(linkPath);
  try {
    if (process.platform === "win32") {
      fs.symlinkSync(path.resolve(targetPath), linkPath, "junction");
    } else {
      fs.symlinkSync(targetPath, linkPath, "dir");
    }
  } catch (error) {
    throw new SkillLibraryError(`Failed to create link ${linkPath}: ${error.message}`);
  }
}

function getSkillOrThrow(skillName, skills) {
  if (skills.has(skillName)) {
    return skills.get(skillName);
  }
  throw new SkillLibraryError(`Skill ${skillName} not found.`);
}

function applyScopeState(row, entryPath, skillPath, installedKey, conflictKey, entryKey, targetKey) {
  const { installed, conflict } = entryState(entryPath, skillPath);
  row[installedKey] = installed;
  if (conflict) {
    row[conflictKey] = true;
    row[entryKey] = entryPath;
    try {
      row[targetKey] = fs.realpathSync.native(entryPath);
    } catch {
      // ignore
    }
  }
}

function enumerateRows(projectRoot, skills) {
  return Array.from(skills.keys())
    .sort()
    .map((name) => {
      const skill = skills.get(name);
      const row = {
        name,
        path: skill.path,
        description: skill.description,
      };
      applyScopeState(
        row,
        projectSkillPath(projectRoot, name),
        skill.path,
        "installed",
        "conflict",
        "project_entry",
        "project_entry_target"
      );
      applyScopeState(
        row,
        globalSkillPath(name),
        skill.path,
        "global_installed",
        "global_conflict",
        "global_entry",
        "global_entry_target"
      );
      return row;
    });
}

function readRoot() {
  return readConfig().library_root;
}

function setRoot(rootPath) {
  const normalizedRoot = path.resolve(rootPath);
  if (!path.isAbsolute(normalizedRoot)) {
    throw new SkillLibraryError("Path must be absolute.");
  }
  if (!fs.existsSync(normalizedRoot) || !fs.statSync(normalizedRoot).isDirectory()) {
    throw new SkillLibraryError(
      `Library root does not exist or is not a directory: ${normalizedRoot}`
    );
  }
  const savedConfigPath = writeConfig(normalizedRoot);
  return { rootPath: normalizedRoot, configPath: savedConfigPath };
}

function enumerateSkills(project = null) {
  const { skills, libraryRoot } = loadSkillsFromConfig();
  const projectRoot = resolveProjectRoot(project);
  const rows = enumerateRows(projectRoot, skills);
  const enabled = rows.filter((row) => row.installed);
  const conflicts = rows.filter((row) => row.conflict);
  const globalEnabled = rows.filter((row) => row.global_installed);
  const globalConflicts = rows.filter((row) => row.global_conflict);
  return {
    configPath: configPath(),
    codexHome: codexHome(),
    globalRoot: globalSkillsRoot(),
    libraryRoot,
    projectRoot,
    skills: rows,
    enabled,
    conflicts,
    globalEnabled,
    globalConflicts,
  };
}

function enableSkill(skillName, project = null, force = false) {
  const { skills } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const projectRoot = resolveProjectRoot(project);
  const entry = projectSkillPath(projectRoot, skill.name);
  const { installed, conflict } = entryState(entry, skill.path);
  if (installed) {
    return {
      skill: skill.name,
      projectRoot,
      entry,
      path: skill.path,
      status: "already-enabled",
    };
  }
  if ((conflict || fs.existsSync(entry)) && !force) {
    throw new SkillLibraryError(`Conflicting entry exists at ${entry}. Use force to replace it.`);
  }
  if (conflict || fs.existsSync(entry)) {
    removePath(entry);
  }
  createJunction(entry, skill.path);
  return {
    skill: skill.name,
    projectRoot,
    entry,
    path: skill.path,
    status: "enabled",
  };
}

function disableSkill(skillName, project = null) {
  loadSkillsFromConfig();
  const projectRoot = resolveProjectRoot(project);
  const entry = projectSkillPath(projectRoot, skillName);
  if (!fs.existsSync(entry)) {
    return { skill: skillName, projectRoot, entry, status: "not-enabled" };
  }
  removePath(entry);
  return { skill: skillName, projectRoot, entry, status: "disabled" };
}

function installGlobalSkill(skillName, force = false) {
  const { skills } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const entry = globalSkillPath(skill.name);
  const { installed, conflict } = entryState(entry, skill.path);
  if (installed) {
    return {
      skill: skill.name,
      entry,
      path: skill.path,
      globalRoot: globalSkillsRoot(),
      status: "already-installed",
    };
  }
  if ((conflict || fs.existsSync(entry)) && !force) {
    throw new SkillLibraryError(
      `Conflicting global entry exists at ${entry}. Use force to replace it.`
    );
  }
  if (conflict || fs.existsSync(entry)) {
    removePath(entry);
  }
  createJunction(entry, skill.path);
  return {
    skill: skill.name,
    entry,
    path: skill.path,
    globalRoot: globalSkillsRoot(),
    status: "installed",
  };
}

function uninstallGlobalSkill(skillName) {
  loadSkillsFromConfig();
  const entry = globalSkillPath(skillName);
  if (!fs.existsSync(entry)) {
    return {
      skill: skillName,
      entry,
      globalRoot: globalSkillsRoot(),
      status: "not-installed",
    };
  }
  removePath(entry);
  return {
    skill: skillName,
    entry,
    globalRoot: globalSkillsRoot(),
    status: "uninstalled",
  };
}

function deleteLibrarySkill(skillName, project = null) {
  const { skills, libraryRoot } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const projectRoot = resolveProjectRoot(project);
  const repoEntry = projectSkillPath(projectRoot, skill.name);
  const globalEntry = globalSkillPath(skill.name);
  if (entryState(repoEntry, skill.path).installed) {
    throw new SkillLibraryError(
      `Skill ${skill.name} is enabled in the current project. Disable it before deleting it from the library.`
    );
  }
  if (entryState(globalEntry, skill.path).installed) {
    throw new SkillLibraryError(
      `Skill ${skill.name} is installed globally. Uninstall it before deleting it from the library.`
    );
  }
  let insideLibrary = false;
  try {
    insideLibrary =
      path
        .relative(normalizePath(libraryRoot), normalizePath(skill.path))
        .startsWith("..") === false;
  } catch {
    insideLibrary = false;
  }
  if (!insideLibrary) {
    throw new SkillLibraryError(
      `Refusing to delete skill outside the configured library root: ${skill.path}`
    );
  }
  removePath(skill.path);
  return {
    skill: skill.name,
    path: skill.path,
    projectRoot,
    libraryRoot,
    status: "deleted",
  };
}

function readSkillMarkdown(skillName) {
  const { skills } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const skillMdPath = path.join(skill.path, SKILL_FILENAME);
  let content;
  try {
    content = fs.readFileSync(skillMdPath, "utf8");
  } catch (error) {
    throw new SkillLibraryError(`Failed to read ${skillMdPath}: ${error.message}`);
  }
  return {
    skill: skill.name,
    path: skillMdPath,
    content,
  };
}

function listEnabledSkills(project = null) {
  const overview = enumerateSkills(project);
  return {
    configPath: overview.configPath,
    libraryRoot: overview.libraryRoot,
    projectRoot: overview.projectRoot,
    skills: overview.enabled,
  };
}

function listGlobalSkills() {
  const overview = enumerateSkills();
  return {
    configPath: overview.configPath,
    libraryRoot: overview.libraryRoot,
    globalRoot: overview.globalRoot,
    skills: overview.globalEnabled,
  };
}

function statusSnapshot(project = null) {
  const projectRoot = resolveProjectRoot(project);
  const snapshot = {
    configured: false,
    configPath: configPath(),
    codexHome: codexHome(),
    globalRoot: globalSkillsRoot(),
    projectRoot,
  };
  try {
    const overview = enumerateSkills(projectRoot);
    return {
      ...snapshot,
      configured: true,
      libraryRoot: overview.libraryRoot,
      skills: overview.skills,
      enabled: overview.enabled,
      conflicts: overview.conflicts,
      globalEnabled: overview.globalEnabled,
      globalConflicts: overview.globalConflicts,
      skillCount: overview.skills.length,
      enabledCount: overview.enabled.length,
      conflictCount: overview.conflicts.length,
      globalEnabledCount: overview.globalEnabled.length,
      globalConflictCount: overview.globalConflicts.length,
    };
  } catch (error) {
    if (error instanceof SkillLibraryError) {
      return {
        ...snapshot,
        error: error.message,
      };
    }
    throw error;
  }
}

function listDirectories(targetPath = null) {
  if (process.platform === "win32" && !targetPath) {
    const entries = [];
    for (let index = 0; index < 26; index += 1) {
      const letter = String.fromCharCode("A".charCodeAt(0) + index);
      const drivePath = `${letter}:\\`;
      if (fs.existsSync(drivePath)) {
        entries.push({ name: drivePath, path: drivePath });
      }
    }
    return { currentPath: "", parentPath: null, entries };
  }
  const currentPath = path.resolve(targetPath || process.cwd());
  if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isDirectory()) {
    throw new SkillLibraryError(`Folder does not exist: ${currentPath}`);
  }
  const entries = fs
    .readdirSync(currentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  let parentPath = path.dirname(currentPath.replace(/[\\\/]+$/, ""));
  if (!parentPath || parentPath === currentPath) {
    parentPath = process.platform === "win32" ? "" : null;
  }
  return {
    currentPath,
    parentPath,
    entries,
  };
}

module.exports = {
  SkillLibraryError,
  configPath,
  codexHome,
  deleteLibrarySkill,
  disableSkill,
  enableSkill,
  enumerateSkills,
  globalSkillsRoot,
  installGlobalSkill,
  listDirectories,
  listEnabledSkills,
  listGlobalSkills,
  readRoot,
  readSkillMarkdown,
  resolveProjectRoot,
  setRoot,
  statusSnapshot,
  uninstallGlobalSkill,
};
