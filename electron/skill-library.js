const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CONFIG_FILENAME = "local-skill-library.json";
const LIBRARY_CONFIG_FILENAME = ".skill-library-manager.json";
const SKILL_FILENAME = "SKILL.md";
const SCHEMA_VERSION = 1;
const DEFAULT_LINK_MODE = "junction";
const PACKAGED_SKILL_LOCATIONS = [
  [".agents", "skills"],
  ["plugin", "skills"],
  [".claude", "skills"],
  [".cursor", "skills"],
  [".gemini", "skills"],
  [".github", "skills"],
  [".kiro", "skills"],
  [".opencode", "skills"],
  [".pi", "skills"],
  [".qoder", "skills"],
  [".rovodev", "skills"],
  [".trae", "skills"],
  [".trae-cn", "skills"],
];

class SkillLibraryError extends Error {}

let libraryCache = null;
const repoStatusCache = new Map();

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function configPath() {
  return path.join(codexHome(), CONFIG_FILENAME);
}

function libraryConfigPath(libraryRoot) {
  return path.join(libraryRoot, LIBRARY_CONFIG_FILENAME);
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

function cacheKeyForConfig(config) {
  try {
    const configStat = fs.statSync(config.config_path);
    const rootStat = fs.statSync(config.library_root);
    return [
      config.library_root,
      config.config_path,
      configStat.mtimeMs,
      rootStat.mtimeMs,
      JSON.stringify(config.skill_tags || {}),
    ].join("|");
  } catch {
    return null;
  }
}

function invalidateLibraryCache() {
  libraryCache = null;
  repoStatusCache.clear();
}

function ensureParentDir(targetPath) {
  const parent = path.dirname(targetPath);
  if (parent) {
    fs.mkdirSync(parent, { recursive: true });
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new SkillLibraryError(`Failed to read config ${filePath}: ${error.message}`);
  }
}

function writeJsonFile(filePath, payload) {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    throw new SkillLibraryError(`Failed to write config ${filePath}: ${error.message}`);
  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.rmSync(tmpPath, { force: true });
    }
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
  const meta = frontmatterFromSkillMd(skillMdPath);
  return meta.description || "No description provided.";
}

function frontmatterFromSkillMd(skillMdPath) {
  let raw;
  try {
    raw = fs.readFileSync(skillMdPath, "utf8");
  } catch {
    return {};
  }
  if (!raw.startsWith("---")) {
    return {};
  }
  const lines = raw.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") {
    return {};
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
    return {};
  }
  const meta = {};
  for (const line of frontmatter) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    let value = match[1].trim();
    value = match[2].trim();
    if (value === "|" || value === ">-" || value === ">") {
      const descriptionLines = [];
      const descriptionIndex = frontmatter.indexOf(line);
      for (let index = descriptionIndex + 1; index < frontmatter.length; index += 1) {
        const nextLine = frontmatter[index];
        if (!/^\s+/.test(nextLine)) {
          break;
        }
        descriptionLines.push(nextLine.trim());
      }
      value = descriptionLines.join(" ");
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = key === "description" ? firstSentence(value) : value;
  }
  return meta;
}

function readConfig() {
  const pointerPath = configPath();
  if (!fs.existsSync(pointerPath)) {
    throw new SkillLibraryError(
      `Config file not found: ${pointerPath}. Run set root first.`
    );
  }
  const pointerData = readJsonFile(pointerPath);
  if (!pointerData || typeof pointerData !== "object") {
    throw new SkillLibraryError(`Invalid config format in ${pointerPath}.`);
  }
  const root = pointerData.library_root;
  if (typeof root !== "string" || !root.trim()) {
    throw new SkillLibraryError(`Invalid or missing library_root in ${pointerPath}.`);
  }
  const normalizedRoot = path.resolve(root);
  if (!fs.existsSync(normalizedRoot) || !fs.statSync(normalizedRoot).isDirectory()) {
    throw new SkillLibraryError(
      `Configured library root does not exist: ${normalizedRoot}. Set the root again.`
    );
  }
  const cfgPath = libraryConfigPath(normalizedRoot);
  let data;
  if (fs.existsSync(cfgPath)) {
    data = readJsonFile(cfgPath);
    if (!data || typeof data !== "object") {
      throw new SkillLibraryError(`Invalid config format in ${cfgPath}.`);
    }
    if (!data.skill_tags || typeof data.skill_tags !== "object" || Array.isArray(data.skill_tags)) {
      data.skill_tags = {};
      writeLibraryConfig(normalizedRoot, data);
    }
  } else {
    data = {
      schema_version: SCHEMA_VERSION,
      link_mode: pointerData.link_mode || DEFAULT_LINK_MODE,
    };
    if (pointerData.skill_tags && typeof pointerData.skill_tags === "object") {
      data.skill_tags = pointerData.skill_tags;
    }
    writeLibraryConfig(normalizedRoot, data);
  }
  if (pointerData.link_mode !== undefined || pointerData.skill_tags !== undefined) {
    writeLibraryPointer(normalizedRoot);
  }
  if (data.link_mode !== DEFAULT_LINK_MODE) {
    throw new SkillLibraryError(
      `Invalid or unsupported link_mode in ${cfgPath}. Expected ${DEFAULT_LINK_MODE}.`
    );
  }
  return {
    ...data,
    library_root: normalizedRoot,
    config_path: cfgPath,
    pointer_path: pointerPath,
  };
}

function writeLibraryPointer(rootPath) {
  const pointerPath = configPath();
  const payload = {
    schema_version: SCHEMA_VERSION,
    library_root: rootPath,
  };
  writeJsonFile(pointerPath, payload);
  return pointerPath;
}

function writeLibraryConfig(rootPath, overrides = {}) {
  const cfgPath = libraryConfigPath(rootPath);
  const payload = {
    schema_version: SCHEMA_VERSION,
    link_mode: DEFAULT_LINK_MODE,
    skill_tags: {},
    ...overrides,
  };
  writeJsonFile(cfgPath, payload);
  return cfgPath;
}

function writeConfig(rootPath) {
  let existing = {};
  const cfgPath = libraryConfigPath(rootPath);
  if (fs.existsSync(cfgPath)) {
    existing = readJsonFile(cfgPath);
  }
  writeLibraryPointer(rootPath);
  return writeLibraryConfig(rootPath, existing);
}

function discoverSkills(root) {
  const candidatesByName = new Map();
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
      const skillMdPath = path.join(currentRoot, SKILL_FILENAME);
      const metadata = frontmatterFromSkillMd(skillMdPath);
      const name = metadata.name || path.basename(currentRoot);
      const record = {
        name,
        path: currentRoot,
        description: metadata.description || "No description provided.",
      };
      if (!candidatesByName.has(name)) {
        candidatesByName.set(name, []);
      }
      candidatesByName.get(name).push(record);
    }
    for (let index = dirEntries.length - 1; index >= 0; index -= 1) {
      const entry = dirEntries[index];
      if (entry.isDirectory()) {
        stack.push(path.join(currentRoot, entry.name));
      }
    }
  }
  return resolveSkillCandidates(root, candidatesByName);
}

function packagedSkillInfo(root, skillPath, skillName) {
  const relativePath = path.relative(root, skillPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  const parts = relativePath.split(path.sep);
  if (parts[parts.length - 1] !== skillName) {
    return null;
  }
  for (let priority = 0; priority < PACKAGED_SKILL_LOCATIONS.length; priority += 1) {
    const location = PACKAGED_SKILL_LOCATIONS[priority];
    const locationStart = parts.length - location.length - 1;
    if (locationStart < 0) {
      continue;
    }
    const matches = location.every((part, index) => parts[locationStart + index] === part);
    if (!matches) {
      continue;
    }
    return {
      priority,
      sourceRoot: path.resolve(root, ...parts.slice(0, locationStart)),
    };
  }
  return null;
}

function collapsePackagedVariants(root, name, candidates) {
  const variants = candidates.map((candidate) => ({
    candidate,
    info: packagedSkillInfo(root, candidate.path, name),
  }));
  if (variants.some((variant) => !variant.info)) {
    return null;
  }
  const sourceRoots = new Set(
    variants.map((variant) => normalizePath(variant.info.sourceRoot))
  );
  if (sourceRoots.size !== 1) {
    return null;
  }
  variants.sort((left, right) => {
    if (left.info.priority !== right.info.priority) {
      return left.info.priority - right.info.priority;
    }
    return left.candidate.path.localeCompare(right.candidate.path);
  });
  return variants[0].candidate;
}

function collapseSameContentVariants(candidates) {
  const signatures = new Set();
  for (const candidate of candidates) {
    try {
      signatures.add(fs.readFileSync(path.join(candidate.path, SKILL_FILENAME), "utf8"));
    } catch {
      return null;
    }
  }
  if (signatures.size !== 1) {
    return null;
  }
  return candidates
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))[0];
}

function resolveSkillCandidates(root, candidatesByName) {
  const found = new Map();
  const collisions = new Map();
  for (const [name, candidates] of candidatesByName.entries()) {
    if (candidates.length === 1) {
      found.set(name, candidates[0]);
      continue;
    }
    const collapsed = collapsePackagedVariants(root, name, candidates);
    if (collapsed) {
      found.set(name, collapsed);
      continue;
    }
    const sameContent = collapseSameContentVariants(candidates);
    if (sameContent) {
      found.set(name, sameContent);
    } else {
      collisions.set(name, candidates.map((candidate) => candidate.path));
    }
  }
  return { found, collisions };
}

function normalizeTags(tags) {
  const source = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return Array.from(
    new Set(
      source
        .map((tag) => String(tag).trim().toLowerCase())
        .filter((tag) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag))
    )
  ).sort((left, right) => left.localeCompare(right));
}

function skillTagsFromConfig(config, skillName) {
  if (!config.skill_tags || typeof config.skill_tags !== "object") {
    return [];
  }
  return normalizeTags(config.skill_tags[skillName] || []);
}

function allTagsFromRows(rows) {
  const tags = new Set();
  for (const row of rows) {
    for (const tag of row.tags || []) {
      tags.add(tag);
    }
  }
  return Array.from(tags).sort((left, right) => left.localeCompare(right));
}

function skillSourceFromPath(libraryRoot, skillPath, skillName) {
  const relativePath = path.relative(libraryRoot, skillPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return skillName;
  }
  const parts = relativePath.split(path.sep).filter(Boolean);
  return parts.length > 1 ? parts[0] : skillName;
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

function loadSkillsFromConfig(options = {}) {
  const cfg = readConfig();
  const cacheKey = cacheKeyForConfig(cfg);
  if (
    !options.force &&
    libraryCache &&
    cacheKey &&
    libraryCache.cacheKey === cacheKey
  ) {
    return libraryCache.value;
  }
  const { found, collisions } = discoverSkills(cfg.library_root);
  failOnCollisions(collisions);
  const value = {
    skills: found,
    libraryRoot: cfg.library_root,
    configPath: cfg.config_path,
    pointerPath: cfg.pointer_path,
    config: cfg,
  };
  if (cacheKey) {
    libraryCache = { cacheKey, value };
  }
  return value;
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

function listRelativeEntries(rootPath) {
  const entries = [];
  const stack = [""];
  while (stack.length) {
    const relativePath = stack.pop();
    const absolutePath = relativePath ? path.join(rootPath, relativePath) : rootPath;
    const dirEntries = fs.readdirSync(absolutePath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (let index = dirEntries.length - 1; index >= 0; index -= 1) {
      const entry = dirEntries[index];
      const entryRelativePath = relativePath
        ? path.join(relativePath, entry.name)
        : entry.name;
      if (entry.isDirectory()) {
        entries.push({ relativePath: entryRelativePath, kind: "directory" });
        stack.push(entryRelativePath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        entries.push({
          relativePath: entryRelativePath,
          kind: "symlink",
          target: fs.readlinkSync(path.join(rootPath, entryRelativePath)),
        });
        continue;
      }
      entries.push({ relativePath: entryRelativePath, kind: "file" });
    }
  }
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function compareDirectoryTrees(sourcePath, targetPath) {
  const sourceEntries = listRelativeEntries(sourcePath);
  const targetEntries = listRelativeEntries(targetPath);
  if (sourceEntries.length !== targetEntries.length) {
    return false;
  }
  for (let index = 0; index < sourceEntries.length; index += 1) {
    const sourceEntry = sourceEntries[index];
    const targetEntry = targetEntries[index];
    if (sourceEntry.relativePath !== targetEntry.relativePath) {
      return false;
    }
    if (sourceEntry.kind !== targetEntry.kind) {
      return false;
    }
    if (sourceEntry.kind === "file") {
      const sourceBuffer = fs.readFileSync(path.join(sourcePath, sourceEntry.relativePath));
      const targetBuffer = fs.readFileSync(path.join(targetPath, targetEntry.relativePath));
      if (!sourceBuffer.equals(targetBuffer)) {
        return false;
      }
    }
    if (sourceEntry.kind === "symlink" && sourceEntry.target !== targetEntry.target) {
      return false;
    }
  }
  return true;
}

function isInstalledState(state) {
  return state === "copied-match" || state === "copied-modified" || state === "linked-match";
}

function isConflictState(state) {
  return state === "foreign-conflict";
}

function copyDirectory(sourcePath, targetPath) {
  if (fs.existsSync(targetPath)) {
    removePath(targetPath);
  }
  ensureParentDir(targetPath);
  try {
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: false,
      force: true,
      preserveTimestamps: false,
    });
  } catch (error) {
    throw new SkillLibraryError(
      `Failed to copy ${sourcePath} to ${targetPath}: ${error.message}`
    );
  }
}

function installState(entryPath, skillPath) {
  if (!fs.existsSync(entryPath)) {
    return { state: "missing" };
  }
  try {
    const stats = fs.lstatSync(entryPath);
    if (stats.isSymbolicLink()) {
      let equivalent = false;
      try {
        equivalent = normalizePath(entryPath) === normalizePath(skillPath);
      } catch {
        equivalent = false;
      }
      return equivalent
        ? { state: "linked-match" }
        : { state: "foreign-conflict" };
    }
    if (!stats.isDirectory()) {
      return { state: "foreign-conflict" };
    }
    if (!fs.existsSync(path.join(entryPath, SKILL_FILENAME))) {
      return { state: "foreign-conflict" };
    }
    return compareDirectoryTrees(skillPath, entryPath)
      ? { state: "copied-match" }
      : { state: "copied-modified" };
  } catch (error) {
    throw new SkillLibraryError(`Failed to inspect ${entryPath}: ${error.message}`);
  }
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

function getSkillOrThrow(skillName, skills) {
  if (skills.has(skillName)) {
    return skills.get(skillName);
  }
  throw new SkillLibraryError(`Skill ${skillName} not found.`);
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function findGitRoot(startPath) {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isFile()
    ? path.dirname(startPath)
    : startPath;
  while (current && path.dirname(current) !== current) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      return path.resolve(current);
    }
    current = path.dirname(current);
  }
  return null;
}

function remoteToWebUrl(remoteUrl) {
  if (!remoteUrl) {
    return null;
  }
  const trimmed = remoteUrl.trim();
  let match = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (match) {
    return `https://github.com/${match[1]}/${match[2]}`;
  }
  match = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (match) {
    return `https://github.com/${match[1]}/${match[2]}`;
  }
  return null;
}

function normalizeRepoUrl(repoUrl) {
  const trimmed = String(repoUrl || "").trim();
  if (!trimmed) {
    throw new SkillLibraryError("Repo URL is required.");
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (parsed.hostname.toLowerCase() !== "github.com") {
    return trimmed;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return trimmed;
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  return `https://github.com/${owner}/${repo}.git`;
}

function repoNameFromUrl(repoUrl) {
  const trimmed = String(repoUrl || "").trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length) {
      const name = parts[parts.length - 1].replace(/\.git$/i, "");
      if (name) {
        return name;
      }
    }
  }
  if (/^git@/i.test(trimmed)) {
    const sshParts = trimmed.split(":");
    const sshTail = sshParts[sshParts.length - 1].replace(/\\/g, "/");
    const sshName = (sshTail.split("/").pop() || "").replace(/\.git$/i, "");
    if (sshName) {
      return sshName;
    }
  }
  const slashNormalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  let name = slashNormalized.split("/").pop() || "";
  name = name.replace(/\.git$/i, "");
  if (!name) {
    throw new SkillLibraryError(`Could not derive a folder name from repo URL: ${trimmed}`);
  }
  return name;
}

function gitRepoStatusForPath(skillPath, cache) {
  try {
    const repoRoot = findGitRoot(skillPath);
    if (!repoRoot) {
      throw new Error("not in repo");
    }
    if (cache.has(repoRoot)) {
      return cache.get(repoRoot);
    }
    let originUrl = null;
    let repoWebUrl = null;
    try {
      originUrl = runGit(["-C", repoRoot, "remote", "get-url", "origin"], repoRoot);
      repoWebUrl = remoteToWebUrl(originUrl);
    } catch {
      originUrl = null;
      repoWebUrl = null;
    }
    let status = {
      repoStatus: "up_to_date",
      repoStatusReason: "Git repo is up to date with its configured upstream.",
      repoRoot,
      repoOriginUrl: originUrl,
      repoWebUrl,
      repoAheadCount: 0,
      repoBehindCount: 0,
    };
    try {
      runGit(["-C", repoRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot);
      const counts = runGit(
        ["-C", repoRoot, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        repoRoot
      )
        .split(/\s+/)
        .map((value) => Number.parseInt(value, 10) || 0);
      const ahead = counts.length > 0 ? counts[0] : 0;
      const behind = counts.length > 1 ? counts[1] : 0;
      if (behind > 0) {
        status = {
          repoStatus: "needs_update",
          repoStatusReason:
            ahead > 0
              ? `Git repo has diverged: ${ahead} local commit${ahead === 1 ? "" : "s"} and ${behind} upstream commit${behind === 1 ? "" : "s"} to integrate.`
              : `Git repo is behind its upstream by ${behind} commit${behind === 1 ? "" : "s"}.`,
          repoRoot,
          repoOriginUrl: originUrl,
          repoWebUrl,
          repoAheadCount: ahead,
          repoBehindCount: behind,
        };
      } else {
        status = {
          repoStatus: "up_to_date",
          repoStatusReason:
            ahead > 0
              ? `Git repo is ahead of its upstream by ${ahead} commit${ahead === 1 ? "" : "s"}.`
              : "Git repo is up to date with its configured upstream.",
          repoRoot,
          repoOriginUrl: originUrl,
          repoWebUrl,
          repoAheadCount: ahead,
          repoBehindCount: behind,
        };
      }
    } catch {
      status = {
        repoStatus: "up_to_date",
        repoStatusReason: "Git repo has no upstream configured, so no update check was needed.",
        repoRoot,
        repoOriginUrl: originUrl,
        repoWebUrl,
        repoAheadCount: 0,
        repoBehindCount: 0,
      };
    }
    cache.set(repoRoot, status);
    return status;
  } catch {
    return {
      repoStatus: "not_repo",
      repoStatusReason: "Skill folder is not inside a Git repository.",
      repoRoot: null,
      repoOriginUrl: null,
      repoWebUrl: null,
      repoAheadCount: 0,
      repoBehindCount: 0,
    };
  }
}

function pendingRepoStatus(skillPath) {
  const repoRoot = findGitRoot(skillPath);
  const cached = repoRoot ? repoStatusCache.get(repoRoot) : null;
  if (cached) {
    return cached;
  }
  return {
    repoStatus: "pending",
    repoStatusReason: repoRoot
      ? "Git status check is pending."
      : "Skill folder is not inside a Git repository.",
    repoRoot,
    repoOriginUrl: null,
    repoWebUrl: null,
    repoAheadCount: 0,
    repoBehindCount: 0,
  };
}

function repoStatusesForSkills(skills) {
  const localCache = new Map(repoStatusCache);
  const patches = [];
  for (const name of Array.from(skills.keys()).sort()) {
    const skill = skills.get(name);
    const status = gitRepoStatusForPath(skill.path, localCache);
    if (status.repoRoot) {
      repoStatusCache.set(status.repoRoot, status);
    }
    patches.push({
      name,
      path: skill.path,
      ...status,
    });
  }
  return patches;
}

function applyScopeState(
  row,
  entryPath,
  skillPath,
  installedKey,
  conflictKey,
  entryKey,
  targetKey,
  stateKey
) {
  const current = installState(entryPath, skillPath);
  row[stateKey] = current.state;
  row[installedKey] = isInstalledState(current.state);
  row[conflictKey] = isConflictState(current.state);
  if (row[conflictKey]) {
    row[entryKey] = entryPath;
    try {
      row[targetKey] = fs.realpathSync.native(entryPath);
    } catch {
      row[targetKey] = entryPath;
    }
  }
}

function enumerateRows(projectRoot, skills, config = {}, options = {}) {
  const localRepoStatusCache = new Map(repoStatusCache);
  const rows = Array.from(skills.keys())
    .sort()
    .map((name) => {
      const skill = skills.get(name);
      const row = {
        name,
        path: skill.path,
        source: skillSourceFromPath(config.library_root || "", skill.path, name),
        description: skill.description,
        tags: skillTagsFromConfig(config, name),
      };
      Object.assign(
        row,
        options.includeGit
          ? gitRepoStatusForPath(skill.path, localRepoStatusCache)
          : pendingRepoStatus(skill.path)
      );
      if (row.repoRoot && row.repoStatus !== "pending") {
        repoStatusCache.set(row.repoRoot, {
          repoStatus: row.repoStatus,
          repoStatusReason: row.repoStatusReason,
          repoRoot: row.repoRoot,
          repoOriginUrl: row.repoOriginUrl,
          repoWebUrl: row.repoWebUrl,
          repoAheadCount: row.repoAheadCount,
          repoBehindCount: row.repoBehindCount,
        });
      }
      applyScopeState(
        row,
        projectSkillPath(projectRoot, name),
        skill.path,
        "installed",
        "conflict",
        "project_entry",
        "project_entry_target",
        "project_install_state"
      );
      applyScopeState(
        row,
        globalSkillPath(name),
        skill.path,
        "global_installed",
        "global_conflict",
        "global_entry",
        "global_entry_target",
        "global_install_state"
      );
      return row;
    });
  rows.sort((left, right) => {
    const leftScore = (left.installed ? 4 : 0) + (left.global_installed ? 2 : 0);
    const rightScore = (right.installed ? 4 : 0) + (right.global_installed ? 2 : 0);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.name.localeCompare(right.name);
  });
  return rows;
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
  invalidateLibraryCache();
  return { rootPath: normalizedRoot, configPath: savedConfigPath };
}

function setSkillTags(skillName, tags) {
  const { skills, libraryRoot, configPath: cfgPath, config } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const nextTags = normalizeTags(tags);
  const nextConfig = {
    ...config,
    skill_tags: {
      ...(config.skill_tags && typeof config.skill_tags === "object" ? config.skill_tags : {}),
    },
  };
  delete nextConfig.library_root;
  delete nextConfig.config_path;
  delete nextConfig.pointer_path;
  if (nextTags.length) {
    nextConfig.skill_tags[skill.name] = nextTags;
  } else {
    delete nextConfig.skill_tags[skill.name];
  }
  writeLibraryConfig(libraryRoot, nextConfig);
  const allTags = Array.from(
    new Set(
      Object.values(nextConfig.skill_tags)
        .flatMap((value) => normalizeTags(value))
    )
  ).sort((left, right) => left.localeCompare(right));
  return {
    skill: skill.name,
    tags: nextTags,
    allTags,
    configPath: cfgPath,
    status: "updated",
  };
}

function cloneSkillsRepo(repoUrl) {
  const cfg = readConfig();
  const trimmedUrl = normalizeRepoUrl(repoUrl);
  if (!trimmedUrl) {
    throw new SkillLibraryError("Repo URL is required.");
  }
  const repoName = repoNameFromUrl(trimmedUrl);
  const destination = path.join(cfg.library_root, repoName);
  if (fs.existsSync(destination)) {
    throw new SkillLibraryError(
      `Destination already exists in the library root: ${destination}`
    );
  }
  try {
    runGit(["clone", trimmedUrl, destination], cfg.library_root);
  } catch (error) {
    throw new SkillLibraryError(`Failed to clone ${trimmedUrl}: ${error.message}`);
  }
  invalidateLibraryCache();
  return {
    repoUrl: trimmedUrl,
    destination,
    libraryRoot: cfg.library_root,
    repoName,
  };
}

function enumerateSkills(project = null, options = {}) {
  const {
    skills,
    libraryRoot,
    configPath: cfgPath,
    pointerPath,
    config,
  } = loadSkillsFromConfig({ force: Boolean(options.forceDiscovery) });
  const projectRoot = resolveProjectRoot(project);
  const rows = enumerateRows(projectRoot, skills, config, {
    includeGit: Boolean(options.includeGit),
  });
  const enabled = rows.filter((row) => row.installed);
  const conflicts = rows.filter((row) => row.conflict);
  const globalEnabled = rows.filter((row) => row.global_installed);
  const globalConflicts = rows.filter((row) => row.global_conflict);
  return {
    configPath: cfgPath,
    pointerPath,
    codexHome: codexHome(),
    globalRoot: globalSkillsRoot(),
    libraryRoot,
    projectRoot,
    skills: rows,
    enabled,
    conflicts,
    globalEnabled,
    globalConflicts,
    allTags: allTagsFromRows(rows),
  };
}

function refreshRepoStatuses(project = null, options = {}) {
  if (options.force) {
    repoStatusCache.clear();
  }
  const { skills } = loadSkillsFromConfig();
  return {
    projectRoot: resolveProjectRoot(project),
    repoStatuses: repoStatusesForSkills(skills),
  };
}

function enableSkill(skillName, project = null, force = false) {
  const { skills } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const projectRoot = resolveProjectRoot(project);
  const entry = projectSkillPath(projectRoot, skill.name);
  const current = installState(entry, skill.path).state;
  if (current === "missing") {
    copyDirectory(skill.path, entry);
    return {
      skill: skill.name,
      projectRoot,
      entry,
      path: skill.path,
      status: "enabled",
    };
  }
  if (current === "linked-match") {
    copyDirectory(skill.path, entry);
    return {
      skill: skill.name,
      projectRoot,
      entry,
      path: skill.path,
      status: "migrated-link",
    };
  }
  if (current === "copied-match") {
    copyDirectory(skill.path, entry);
    return {
      skill: skill.name,
      projectRoot,
      entry,
      path: skill.path,
      status: "refreshed",
    };
  }
  if ((current === "copied-modified" || current === "foreign-conflict") && !force) {
    return {
      skill: skill.name,
      projectRoot,
      entry,
      path: skill.path,
      status: "blocked-modified",
    };
  }
  copyDirectory(skill.path, entry);
  return {
    skill: skill.name,
    projectRoot,
    entry,
    path: skill.path,
    status: "replaced",
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
  const current = installState(entry, skill.path).state;
  if (current === "missing") {
    copyDirectory(skill.path, entry);
    return {
      skill: skill.name,
      entry,
      path: skill.path,
      globalRoot: globalSkillsRoot(),
      status: "installed",
    };
  }
  if (current === "linked-match") {
    copyDirectory(skill.path, entry);
    return {
      skill: skill.name,
      entry,
      path: skill.path,
      globalRoot: globalSkillsRoot(),
      status: "migrated-link",
    };
  }
  if (current === "copied-match") {
    copyDirectory(skill.path, entry);
    return {
      skill: skill.name,
      entry,
      path: skill.path,
      globalRoot: globalSkillsRoot(),
      status: "refreshed",
    };
  }
  if ((current === "copied-modified" || current === "foreign-conflict") && !force) {
    return {
      skill: skill.name,
      entry,
      path: skill.path,
      globalRoot: globalSkillsRoot(),
      status: "blocked-modified",
    };
  }
  copyDirectory(skill.path, entry);
  return {
    skill: skill.name,
    entry,
    path: skill.path,
    globalRoot: globalSkillsRoot(),
    status: "replaced",
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

function updateSkillRepo(skillName, project = null) {
  const { skills } = loadSkillsFromConfig();
  const skill = getSkillOrThrow(skillName, skills);
  const repoInfo = gitRepoStatusForPath(skill.path, new Map());
  if (!repoInfo.repoRoot) {
    throw new SkillLibraryError(`Skill ${skill.name} is not inside a Git repository.`);
  }
  if (repoInfo.repoStatus !== "needs_update") {
    return {
      skill: skill.name,
      repoRoot: repoInfo.repoRoot,
      status: "already-up-to-date",
    };
  }
  const dirty = runGit(["-C", repoInfo.repoRoot, "status", "--porcelain"], repoInfo.repoRoot);
  if (dirty) {
    throw new SkillLibraryError(
      `Repo ${repoInfo.repoRoot} has local changes. Commit or stash them before updating.`
    );
  }
  try {
    if ((repoInfo.repoAheadCount || 0) > 0) {
      runGit(["-C", repoInfo.repoRoot, "pull", "--rebase"], repoInfo.repoRoot);
    } else {
      runGit(["-C", repoInfo.repoRoot, "pull", "--ff-only"], repoInfo.repoRoot);
    }
  } catch (error) {
    throw new SkillLibraryError(
      `Failed to update repo ${repoInfo.repoRoot}: ${error.message}`
    );
  }
  if (repoInfo.repoRoot) {
    repoStatusCache.delete(repoInfo.repoRoot);
  }
  return {
    skill: skill.name,
    repoRoot: repoInfo.repoRoot,
    projectRoot: resolveProjectRoot(project),
    status: "updated",
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
  const cfg = readConfig();
  if (cfg.skill_tags && typeof cfg.skill_tags === "object" && cfg.skill_tags[skill.name]) {
    const nextConfig = { ...cfg, skill_tags: { ...cfg.skill_tags } };
    delete nextConfig.library_root;
    delete nextConfig.config_path;
    delete nextConfig.pointer_path;
    delete nextConfig.skill_tags[skill.name];
    writeLibraryConfig(libraryRoot, nextConfig);
  }
  invalidateLibraryCache();
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

function statusSnapshot(project = null, options = {}) {
  const projectRoot = resolveProjectRoot(project);
  const snapshot = {
    configured: false,
    configPath: configPath(),
    codexHome: codexHome(),
    globalRoot: globalSkillsRoot(),
    projectRoot,
  };
  try {
    const overview = enumerateSkills(projectRoot, options);
    return {
      ...snapshot,
      configured: true,
      configPath: overview.configPath,
      pointerPath: overview.pointerPath,
      libraryRoot: overview.libraryRoot,
      skills: overview.skills,
      enabled: overview.enabled,
      conflicts: overview.conflicts,
      globalEnabled: overview.globalEnabled,
      globalConflicts: overview.globalConflicts,
      allTags: overview.allTags,
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
  cloneSkillsRepo,
  refreshRepoStatuses,
  resolveProjectRoot,
  setRoot,
  setSkillTags,
  statusSnapshot,
  updateSkillRepo,
  uninstallGlobalSkill,
};
