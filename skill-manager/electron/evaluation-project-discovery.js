const fs = require("fs");
const path = require("path");

const { listDirectoryNames } = require("./evaluation-fs");

class ProjectDiscoveryError extends Error {}

// Where each agent keeps project guidance. Both skill roots are scanned
// whichever agent is selected: activation re-homes a skill into the running
// agent's own root, so a skill published under the other convention is still a
// real candidate rather than something to hide.
const INSTRUCTION_FILES = {
  claude: [path.join(".claude", "CLAUDE.md"), "CLAUDE.md", "AGENTS.md"],
  codex: ["AGENTS.md", "CLAUDE.md", path.join(".claude", "CLAUDE.md")],
};
const SKILL_ROOTS = [path.join(".claude", "skills"), path.join(".agents", "skills")];
const SKILL_MANIFEST = "SKILL.md";

const IMPORT_PATTERN = /(?:^|\s)@([\w./\\-]+\.md)\b/g;
const BACKTICK_PATTERN = /`([\w./\\-]+\.md)`/g;

function firstExisting(projectPath, candidates, fileSystem) {
  for (const candidate of candidates) {
    const fullPath = path.join(projectPath, candidate);
    if (fileSystem.existsSync(fullPath) && fileSystem.statSync(fullPath).isFile()) {
      return { relativePath: candidate.split(path.sep).join("/"), fullPath };
    }
  }
  return null;
}

function subjectNameFor(relativePath) {
  return path.posix.basename(relativePath.split(path.sep).join("/")).replace(/\.md$/i, "");
}

// A referenced document is one the instruction file actually names and that
// actually exists. Both the Claude @import form and a plain backticked
// filename count, because repositories use both.
function referencedDocuments({ projectPath, instructionFile, fileSystem }) {
  const text = fileSystem.readFileSync(instructionFile.fullPath, "utf8");
  const mentioned = new Set();
  for (const pattern of [IMPORT_PATTERN, BACKTICK_PATTERN]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      mentioned.add(match[1].split("\\").join("/"));
      match = pattern.exec(text);
    }
  }
  const found = [];
  for (const relativePath of [...mentioned].sort()) {
    if (relativePath === instructionFile.relativePath) {
      continue;
    }
    const fullPath = path.join(projectPath, ...relativePath.split("/"));
    if (!fileSystem.existsSync(fullPath) || !fileSystem.statSync(fullPath).isFile()) {
      continue;
    }
    found.push({
      kind: "referenced-document",
      name: subjectNameFor(relativePath),
      sourcePath: fullPath,
      workspacePath: relativePath,
      pointerText: pointerFor(text, relativePath),
    });
  }
  return found;
}

// The pointer is the part of the instruction file that sends the agent to the
// document. Carrying the real sentence keeps activation faithful to how the
// project actually reaches it.
function pointerFor(instructionText, relativePath) {
  const base = path.posix.basename(relativePath);
  const paragraphs = instructionText.split(/\r?\n\s*\r?\n/);
  const mentioning = paragraphs.find((paragraph) => paragraph.includes(base));
  return (mentioning || `Read \`${relativePath}\` before starting.`).trim();
}

function discoveredSkills({ projectPath, fileSystem }) {
  const byName = new Map();
  for (const root of SKILL_ROOTS) {
    const rootPath = path.join(projectPath, root);
    for (const name of listDirectoryNames(rootPath, fileSystem)) {
      if (byName.has(name)) {
        continue;
      }
      const skillPath = path.join(rootPath, name);
      if (!fileSystem.existsSync(path.join(skillPath, SKILL_MANIFEST))) {
        continue;
      }
      byName.set(name, {
        kind: "skill",
        name,
        sourcePath: skillPath,
        discoveredIn: root.split(path.sep).join("/"),
      });
    }
  }
  return [...byName.values()].sort((left, right) => (left.name < right.name ? -1 : 1));
}

// Ordered the way the guidance reaches an agent: the instruction file is always
// in context, the documents it points at are read on demand, and skills load
// only when the agent judges them relevant.
function discoverProjectGuidance({ projectPath, agent, fileSystem = fs } = {}) {
  if (!projectPath) {
    throw new ProjectDiscoveryError("A project folder is required.");
  }
  if (!fileSystem.existsSync(projectPath)) {
    throw new ProjectDiscoveryError(`${projectPath} does not exist.`);
  }
  const candidates = INSTRUCTION_FILES[agent];
  if (!candidates) {
    throw new ProjectDiscoveryError(`No instruction-file convention known for agent ${agent}.`);
  }
  const instructionFile = firstExisting(projectPath, candidates, fileSystem);
  const guidance = [];
  const notes = [];
  if (instructionFile) {
    guidance.push({
      kind: "instruction-file",
      name: subjectNameFor(instructionFile.relativePath),
      sourcePath: instructionFile.fullPath,
      discoveredAs: instructionFile.relativePath,
    });
    guidance.push(...referencedDocuments({ projectPath, instructionFile, fileSystem }));
  } else {
    notes.push(`No ${candidates[0]} found, so no instruction file or referenced documents.`);
  }
  const skills = discoveredSkills({ projectPath, fileSystem });
  guidance.push(...skills);
  if (skills.length === 0) {
    notes.push(`No skills found under ${SKILL_ROOTS.join(" or ")}.`);
  }
  return { projectPath, agent, guidance, notes };
}

module.exports = {
  ProjectDiscoveryError,
  discoverProjectGuidance,
  INSTRUCTION_FILES,
  SKILL_ROOTS,
};
