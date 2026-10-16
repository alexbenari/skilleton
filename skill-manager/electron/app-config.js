const fs = require("fs");
const path = require("path");

class AppConfigError extends Error {}

function textOrNull(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

class AppConfig {
  constructor({ configPath, fileSystem = fs } = {}) {
    if (!configPath) {
      throw new AppConfigError("configPath is required.");
    }
    this.configPath = configPath;
    this.fileSystem = fileSystem;
  }

  normalize(parsed) {
    const evaluation = parsed && typeof parsed.evaluation === "object" ? parsed.evaluation : {};
    return {
      lastSelectedLibraryId:
        parsed && Number.isInteger(parsed.lastSelectedLibraryId)
          ? parsed.lastSelectedLibraryId
          : null,
      evaluation: {
        codexCliPath: textOrNull(evaluation.codexCliPath),
        claudeCliPath: textOrNull(evaluation.claudeCliPath),
      },
    };
  }

  read() {
    if (!this.fileSystem.existsSync(this.configPath)) {
      return this.normalize(null);
    }
    try {
      const raw = this.fileSystem.readFileSync(this.configPath, "utf8");
      return this.normalize(JSON.parse(raw));
    } catch (error) {
      throw new AppConfigError(
        `Failed to read app config ${this.configPath}: ${error.message}`
      );
    }
  }

  write(config) {
    const payload = this.normalize(config);
    const parentDir = path.dirname(this.configPath);
    this.fileSystem.mkdirSync(parentDir, { recursive: true });
    const tmpPath = `${this.configPath}.tmp`;
    try {
      this.fileSystem.writeFileSync(
        tmpPath,
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8"
      );
      this.fileSystem.renameSync(tmpPath, this.configPath);
    } catch (error) {
      throw new AppConfigError(
        `Failed to write app config ${this.configPath}: ${error.message}`
      );
    } finally {
      if (this.fileSystem.existsSync(tmpPath)) {
        this.fileSystem.rmSync(tmpPath, { force: true });
      }
    }
    return payload;
  }

  setLastSelectedLibraryId(libraryId) {
    return this.write({ ...this.read(), lastSelectedLibraryId: libraryId });
  }

  clearLastSelectedLibraryId() {
    return this.setLastSelectedLibraryId(null);
  }

  setEvaluationCliPaths({ codexCliPath, claudeCliPath }) {
    const current = this.read();
    return this.write({
      ...current,
      evaluation: {
        codexCliPath: codexCliPath === undefined ? current.evaluation.codexCliPath : codexCliPath,
        claudeCliPath:
          claudeCliPath === undefined ? current.evaluation.claudeCliPath : claudeCliPath,
      },
    });
  }
}

module.exports = {
  AppConfig,
  AppConfigError,
};
