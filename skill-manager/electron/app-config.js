const fs = require("fs");
const path = require("path");

class AppConfigError extends Error {}

class AppConfig {
  constructor({ configPath, fileSystem = fs } = {}) {
    if (!configPath) {
      throw new AppConfigError("configPath is required.");
    }
    this.configPath = configPath;
    this.fileSystem = fileSystem;
  }

  read() {
    if (!this.fileSystem.existsSync(this.configPath)) {
      return { lastSelectedLibraryId: null };
    }
    try {
      const raw = this.fileSystem.readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        lastSelectedLibraryId:
          Number.isInteger(parsed.lastSelectedLibraryId) ? parsed.lastSelectedLibraryId : null,
      };
    } catch (error) {
      throw new AppConfigError(
        `Failed to read app config ${this.configPath}: ${error.message}`
      );
    }
  }

  write(config) {
    const payload = {
      lastSelectedLibraryId:
        Number.isInteger(config.lastSelectedLibraryId) ? config.lastSelectedLibraryId : null,
    };
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
    return this.write({ lastSelectedLibraryId: libraryId });
  }

  clearLastSelectedLibraryId() {
    return this.write({ lastSelectedLibraryId: null });
  }
}

module.exports = {
  AppConfig,
  AppConfigError,
};
