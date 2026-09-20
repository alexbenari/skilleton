const fs = require("fs");
const path = require("path");

// readdir reports a symlink as a link, not as what it points at, and skill
// libraries are routinely published as directories of symlinks. Everything that
// enumerates the filesystem here has to follow them or it silently sees nothing.
function entryKind(entryPath, entry, fileSystem) {
  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }
  if (!entry.isSymbolicLink()) {
    return "other";
  }
  try {
    const stats = fileSystem.statSync(entryPath);
    if (stats.isDirectory()) {
      return "directory";
    }
    return stats.isFile() ? "file" : "other";
  } catch {
    return "broken-link";
  }
}

function readEntries(directoryPath, fileSystem = fs) {
  if (!fileSystem.existsSync(directoryPath)) {
    return [];
  }
  return fileSystem.readdirSync(directoryPath, { withFileTypes: true }).map((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    return { name: entry.name, path: entryPath, kind: entryKind(entryPath, entry, fileSystem) };
  });
}

function listDirectoryNames(directoryPath, fileSystem = fs) {
  return readEntries(directoryPath, fileSystem)
    .filter((entry) => entry.kind === "directory")
    .map((entry) => entry.name)
    .sort();
}

function listFileNames(directoryPath, fileSystem = fs) {
  return readEntries(directoryPath, fileSystem)
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.name)
    .sort();
}

module.exports = {
  readEntries,
  listDirectoryNames,
  listFileNames,
  entryKind,
};
