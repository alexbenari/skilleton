const fs = require("fs");
const path = require("path");

class EvaluationActivationError extends Error {}

const KIBIBYTE = 1024;

const AGENT_GUIDANCE_PROFILES = {
  claude: {
    instructionFilename: "CLAUDE.md",
    skillRootSegments: [".claude", "skills"],
    instructionBudgetBytes: 4 * KIBIBYTE * KIBIBYTE,
  },
  codex: {
    instructionFilename: "AGENTS.md",
    skillRootSegments: [".agents", "skills"],
    instructionBudgetBytes: 32 * KIBIBYTE,
  },
};

class ActivationRecord {
  constructor({
    agent,
    artifacts,
    instructionFilename,
    deliveredInstructionBytes,
    instructionBudgetBytes,
    documentPaths,
    skillPaths,
  }) {
    this.agent = agent;
    this.artifacts = Object.freeze([...artifacts]);
    this.instructionFilename = instructionFilename;
    this.deliveredInstructionBytes = deliveredInstructionBytes;
    this.instructionBudgetBytes = instructionBudgetBytes;
    this.truncated = deliveredInstructionBytes > instructionBudgetBytes;
    this.documentPaths = Object.freeze({ ...documentPaths });
    this.skillPaths = Object.freeze({ ...skillPaths });
    Object.freeze(this);
  }

  toJSON() {
    return {
      agent: this.agent,
      artifacts: [...this.artifacts],
      instructionFilename: this.instructionFilename,
      deliveredInstructionBytes: this.deliveredInstructionBytes,
      instructionBudgetBytes: this.instructionBudgetBytes,
      truncated: this.truncated,
      documentPaths: { ...this.documentPaths },
      skillPaths: { ...this.skillPaths },
    };
  }
}

class SubjectActivation {
  constructor({ agent, fileSystem = fs } = {}) {
    const profile = AGENT_GUIDANCE_PROFILES[agent];
    if (!profile) {
      throw new EvaluationActivationError(
        `No guidance profile for agent ${JSON.stringify(agent)}; known agents are ${Object.keys(
          AGENT_GUIDANCE_PROFILES
        ).join(", ")}.`
      );
    }
    this.agent = agent;
    this.profile = profile;
    this.fileSystem = fileSystem;
  }

  instructionFilename() {
    return this.profile.instructionFilename;
  }

  instructionBudgetBytes() {
    return this.profile.instructionBudgetBytes;
  }

  skillRelativePath(skillName) {
    return [...this.profile.skillRootSegments, skillName].join("/");
  }

  installSkill(workspacePath, subject) {
    const relativePath = this.skillRelativePath(subject.name);
    const destination = path.join(workspacePath, ...relativePath.split("/"));
    this.fileSystem.mkdirSync(path.dirname(destination), { recursive: true });
    this.fileSystem.cpSync(subject.sourcePath, destination, {
      recursive: true,
      dereference: true,
    });
    return relativePath;
  }

  writeDocument(workspacePath, subject) {
    const relativePath = subject.workspacePath.split(/[\\/]/).join("/");
    const destination = path.join(workspacePath, ...relativePath.split("/"));
    this.fileSystem.mkdirSync(path.dirname(destination), { recursive: true });
    this.fileSystem.copyFileSync(subject.sourcePath, destination);
    return relativePath;
  }

  // A referenced document only reaches the run through a pointer, so the
  // pointer text joins whatever instruction-file subject is also in force.
  composeInstructionText(guidanceSet) {
    const sections = [];
    for (const subject of guidanceSet.ofKind("instruction-file")) {
      sections.push(this.fileSystem.readFileSync(subject.sourcePath, "utf8").trimEnd());
    }
    for (const subject of guidanceSet.ofKind("referenced-document")) {
      sections.push(subject.pointerText.trimEnd());
    }
    return sections.length === 0 ? null : `${sections.join("\n\n")}\n`;
  }

  activate(workspacePath, guidanceSet) {
    const artifacts = [];
    const skillPaths = {};
    const documentPaths = {};
    for (const subject of guidanceSet.ofKind("skill")) {
      const relativePath = this.installSkill(workspacePath, subject);
      skillPaths[subject.name] = relativePath;
      artifacts.push(relativePath);
    }
    for (const subject of guidanceSet.ofKind("referenced-document")) {
      const relativePath = this.writeDocument(workspacePath, subject);
      documentPaths[subject.name] = relativePath;
      artifacts.push(relativePath);
    }
    const instructionText = this.composeInstructionText(guidanceSet);
    let deliveredInstructionBytes = 0;
    if (instructionText !== null) {
      const filename = this.instructionFilename();
      this.fileSystem.writeFileSync(path.join(workspacePath, filename), instructionText, "utf8");
      deliveredInstructionBytes = Buffer.byteLength(instructionText, "utf8");
      artifacts.push(filename);
    }
    return new ActivationRecord({
      agent: this.agent,
      artifacts,
      instructionFilename: this.instructionFilename(),
      deliveredInstructionBytes,
      instructionBudgetBytes: this.instructionBudgetBytes(),
      documentPaths,
      skillPaths,
    });
  }
}

module.exports = {
  EvaluationActivationError,
  SubjectActivation,
  ActivationRecord,
  AGENT_GUIDANCE_PROFILES,
};
