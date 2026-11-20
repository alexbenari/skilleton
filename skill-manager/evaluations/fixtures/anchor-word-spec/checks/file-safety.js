// Sections 13.2 and 13.3 of the requirements: an existing destination is not
// replaced without explicit permission and is left byte-for-byte intact; a
// destination that does not end in .docx is rejected and nothing is written;
// missing destination directories are created; explicit overwrite replaces.
const fs = require("fs");
const os = require("os");
const path = require("path");

const { DocxDocument } = require("./docx-reader");
const { ToolRunner, workspaceRoot, report, reportError } = require("./tool-runner");

function finding(id, message, severity = "high") {
  return { id, message, severity };
}

function failureDetail(result) {
  return `exit ${result.exitCode}; stderr: ${result.stderr.trim().slice(0, 300)}; stdout: ${result.stdout.trim().slice(0, 300)}`;
}

function listFiles(directory) {
  const found = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relative);
      } else {
        found.push(relative);
      }
    }
  };
  walk(directory, "");
  return found.sort();
}

function main() {
  const runner = new ToolRunner(workspaceRoot());
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-word-safety-"));
  const findings = [];
  try {
    const existingPath = path.join(directory, "existing.docx");
    const sentinel = Buffer.from("not a real document; must survive untouched");
    fs.writeFileSync(existingPath, sentinel);

    const refused = runner.run(["--output", existingPath]);
    if (refused.spawnError) {
      throw new Error(`The run command could not be started: ${refused.spawnError}`);
    }
    if (refused.exitCode === 0) {
      findings.push(finding("overwrite-without-permission", "Writing to an existing destination without overwrite permission succeeded; it must be rejected."));
    }
    if (!fs.readFileSync(existingPath).equals(sentinel)) {
      findings.push(finding("existing-altered", "The existing destination was altered although overwrite was not permitted."));
    }
    const refusedMentionsPath = `${refused.stderr}${refused.stdout}`.includes("existing.docx");
    if (!refusedMentionsPath) {
      findings.push(finding("refusal-names-destination", "The refusal does not name the destination it refused to replace.", "medium"));
    }

    const textPath = path.join(directory, "poem.txt");
    const wrongExtension = runner.run(["--output", textPath]);
    if (wrongExtension.exitCode === 0) {
      findings.push(finding("extension-accepted", "A destination not ending in .docx was accepted; it must be rejected."));
    }
    const afterRefusals = listFiles(directory);
    if (afterRefusals.join(",") !== "existing.docx") {
      findings.push(finding("files-after-refusal", `After two rejected requests the directory holds ${afterRefusals.join(", ")}; only existing.docx should be there.`));
    }

    const nestedPath = path.join(directory, "poems", "deeper", "mine.docx");
    const nested = runner.run(["--output", nestedPath]);
    if (nested.exitCode !== 0) {
      findings.push(finding("missing-directories", `Writing into a missing directory failed; it must be created. ${failureDetail(nested)}`));
    } else if (!fs.existsSync(nestedPath)) {
      findings.push(finding("missing-directories", "The run reported success but no document exists at the nested destination."));
    }

    const overwrite = runner.run(["--output", existingPath, "--overwrite"]);
    if (overwrite.exitCode !== 0) {
      findings.push(finding("overwrite-refused", `Overwriting with explicit permission failed. ${failureDetail(overwrite)}`));
    } else if (fs.readFileSync(existingPath).equals(sentinel)) {
      findings.push(finding("overwrite-ineffective", "Overwrite was permitted and reported success, but the destination still holds the old bytes."));
    } else {
      try {
        const replaced = new DocxDocument(existingPath);
        if (replaced.allWords().length === 0) {
          findings.push(finding("overwrite-empty", "The replaced document holds no text.", "medium"));
        }
      } catch (error) {
        findings.push(finding("overwrite-not-docx", `The replaced destination is not a readable Word document: ${error.message}`));
      }
    }

    const finalFiles = listFiles(directory);
    const expectedFiles = ["existing.docx", "poems/deeper/mine.docx"];
    if (finalFiles.join(",") !== expectedFiles.join(",")) {
      findings.push(finding("stray-files", `Expected only ${expectedFiles.join(" and ")}; found ${finalFiles.join(", ")}.`, "medium"));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  report({
    findings,
    passSummary: "Existing destinations survive without permission, wrong extensions are refused, missing directories are created, and explicit overwrite replaces.",
    failSummary: (list) => `${list.length} file-safety problem(s).`,
  });
}

try {
  main();
} catch (error) {
  reportError(error);
}
