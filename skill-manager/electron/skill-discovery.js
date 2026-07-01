const path = require("path");

const SKILL_FILENAME = "SKILL.md";
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

class SkillDiscovery {
  constructor({ fileSystem }) {
    this.fileSystem = fileSystem;
  }

  firstSentence(text) {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) {
      return "No description provided.";
    }
    const match = cleaned.match(/(.+?[.!?])(?:\s|$)/);
    return match ? match[1].trim() : cleaned;
  }

  parseSkillMetadata(markdown) {
    const raw = String(markdown || "");
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
      let value = match[2].trim();
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
      meta[key] = key === "description" ? this.firstSentence(value) : value;
    }
    return meta;
  }

  readSkillMetadata(skillMdPath) {
    let raw;
    try {
      raw = this.fileSystem.readFileSync(skillMdPath, "utf8");
    } catch {
      return {};
    }
    return this.parseSkillMetadata(raw);
  }

  readSkillMarkdown(skillPath) {
    const skillMdPath = path.join(skillPath, SKILL_FILENAME);
    let content;
    try {
      content = this.fileSystem.readFileSync(skillMdPath, "utf8");
    } catch (error) {
      throw new Error(`Failed to read ${skillMdPath}: ${error.message}`);
    }
    return {
      path: skillMdPath,
      content,
    };
  }

  discoverLibrarySkills(libraryRoot) {
    return this.discoverFromScanRoot(libraryRoot, libraryRoot);
  }

  discoverSkillsUnderPath(libraryRoot, targetPath) {
    return this.discoverFromScanRoot(libraryRoot, targetPath);
  }

  discoverFromScanRoot(libraryRoot, scanRoot) {
    const candidatesByName = new Map();
    const stack = [scanRoot];

    while (stack.length) {
      const currentRoot = stack.pop();
      let dirEntries;
      try {
        dirEntries = this.fileSystem.readdirSync(currentRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      dirEntries.sort((left, right) => left.name.localeCompare(right.name));
      const files = dirEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
      if (files.includes(SKILL_FILENAME)) {
        const skillMdPath = path.join(currentRoot, SKILL_FILENAME);
        const metadata = this.readSkillMetadata(skillMdPath);
        const name = metadata.name || path.basename(currentRoot);
        const record = {
          name,
          path: currentRoot,
          localPath: currentRoot,
          description: metadata.description || "No description provided.",
          source: this.skillSourceFromPath(libraryRoot, currentRoot, name),
          gitSourceUrl: null,
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

    return this.resolveSkillCandidates(libraryRoot, candidatesByName);
  }

  packagedSkillInfo(root, skillPath, skillName) {
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

  collapsePackagedVariants(root, name, candidates) {
    const variants = candidates.map((candidate) => ({
      candidate,
      info: this.packagedSkillInfo(root, candidate.path, name),
    }));
    if (variants.some((variant) => !variant.info)) {
      return null;
    }
    const sourceRoots = new Set(
      variants.map((variant) => this.normalizePath(variant.info.sourceRoot))
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

  collapseSameContentVariants(candidates) {
    const signatures = new Set();
    for (const candidate of candidates) {
      try {
        signatures.add(
          this.fileSystem.readFileSync(path.join(candidate.path, SKILL_FILENAME), "utf8")
        );
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

  resolveSkillCandidates(root, candidatesByName) {
    const found = new Map();
    const collisions = new Map();
    for (const [name, candidates] of candidatesByName.entries()) {
      if (candidates.length === 1) {
        found.set(name, candidates[0]);
        continue;
      }
      const collapsed = this.collapsePackagedVariants(root, name, candidates);
      if (collapsed) {
        found.set(name, collapsed);
        continue;
      }
      const sameContent = this.collapseSameContentVariants(candidates);
      if (sameContent) {
        found.set(name, sameContent);
      } else {
        collisions.set(name, candidates.map((candidate) => candidate.path));
      }
    }
    return { found, collisions };
  }

  skillSourceFromPath(libraryRoot, skillPath, skillName) {
    const relativePath = path.relative(libraryRoot, skillPath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return skillName;
    }
    const parts = relativePath.split(path.sep).filter(Boolean);
    return parts.length > 1 ? parts[0] : skillName;
  }

  formatCollisionError(collisions) {
    const lines = ["Duplicate skill names found in library:"];
    for (const name of Array.from(collisions.keys()).sort()) {
      lines.push(`- ${name}`);
      for (const collisionPath of collisions.get(name).sort()) {
        lines.push(`  ${collisionPath}`);
      }
    }
    return lines.join("\n");
  }

  failOnCollisions(collisions, ErrorClass = Error) {
    if (!collisions.size) {
      return;
    }
    throw new ErrorClass(this.formatCollisionError(collisions));
  }

  normalizePath(targetPath) {
    return path.normalize(this.fileSystem.realpathSync.native(targetPath)).toLowerCase();
  }
}

module.exports = {
  PACKAGED_SKILL_LOCATIONS,
  SKILL_FILENAME,
  SkillDiscovery,
};
