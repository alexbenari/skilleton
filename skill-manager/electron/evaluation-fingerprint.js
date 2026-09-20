const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { readEntries } = require("./evaluation-fs");

class EvaluationFingerprintError extends Error {}

const BYTE_ORDER_MARK = "﻿";

function looksBinary(buffer) {
  const sampleLength = Math.min(buffer.length, 8000);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

// Fingerprints must survive a CRLF checkout and a BOM-prefixed file, otherwise
// the same guidance text compares unequal across machines.
function normalizeText(text) {
  const withoutMark = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  return withoutMark.replace(/\r\n/g, "\n");
}

function normalizedBytes(buffer) {
  if (looksBinary(buffer)) {
    return buffer;
  }
  return Buffer.from(normalizeText(buffer.toString("utf8")), "utf8");
}

function digest(hash) {
  return `sha256:${hash.digest("hex")}`;
}

function fingerprintText(text) {
  return digest(crypto.createHash("sha256").update(normalizeText(text), "utf8"));
}

function fingerprintFile(filePath, fileSystem = fs) {
  if (!fileSystem.existsSync(filePath)) {
    throw new EvaluationFingerprintError(`Cannot fingerprint missing file ${filePath}.`);
  }
  const hash = crypto.createHash("sha256");
  hash.update(normalizedBytes(fileSystem.readFileSync(filePath)));
  return digest(hash);
}

function listFilesRecursively(rootPath, fileSystem) {
  const found = [];
  const walk = (currentPath, relativePrefix) => {
    for (const entry of readEntries(currentPath, fileSystem)) {
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        walk(entry.path, relativePath);
      } else if (entry.kind === "file") {
        found.push({ relativePath, absolutePath: entry.path });
      }
    }
  };
  walk(rootPath, "");
  found.sort((left, right) => (left.relativePath < right.relativePath ? -1 : 1));
  return found;
}

function fingerprintDirectory(directoryPath, fileSystem = fs) {
  if (!fileSystem.existsSync(directoryPath)) {
    throw new EvaluationFingerprintError(
      `Cannot fingerprint missing directory ${directoryPath}.`
    );
  }
  const hash = crypto.createHash("sha256");
  for (const file of listFilesRecursively(directoryPath, fileSystem)) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(normalizedBytes(fileSystem.readFileSync(file.absolutePath)));
    hash.update("\0");
  }
  return digest(hash);
}

function fingerprintValues(values) {
  const hash = crypto.createHash("sha256");
  for (const value of values) {
    hash.update(String(value), "utf8");
    hash.update("\0");
  }
  return digest(hash);
}

module.exports = {
  EvaluationFingerprintError,
  fingerprintText,
  fingerprintFile,
  fingerprintDirectory,
  fingerprintValues,
  listFilesRecursively,
};
