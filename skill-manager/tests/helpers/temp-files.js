const fs = require("fs");
const os = require("os");
const path = require("path");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-manager-test-"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

module.exports = { makeTempRoot, writeFile };
