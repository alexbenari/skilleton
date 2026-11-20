// Acceptance scenario 17.1 of the requirements: the default run yields the 24
// permutations of `mine` exactly once, anchor last, in an 8 x 3 grid on an A4
// page with 18pt margins in Times New Roman 35pt, and delivers one file only.
// Page count is not checked here: it needs a renderer, and the arm's own
// goal-based verification is where that evidence belongs.
const fs = require("fs");
const os = require("os");
const path = require("path");

const { DocxDocument, words } = require("./docx-reader");
const { ToolRunner, workspaceRoot, report, reportError } = require("./tool-runner");

const ANCHOR = "mine";
const POINTS_TO_TWIPS = 20;
const EXPECTED = {
  wordCount: 24,
  rows: 8,
  columns: 3,
  pageWidthTwips: Math.round(595.3 * POINTS_TO_TWIPS),
  pageHeightTwips: Math.round(841.9 * POINTS_TO_TWIPS),
  marginTwips: 18 * POINTS_TO_TWIPS,
  fontFamily: "Times New Roman",
  fontSizeHalfPoints: 70,
};

function isPermutationOfAnchor(word) {
  return word.length === ANCHOR.length && [...word].sort().join("") === [...ANCHOR].sort().join("");
}

function finding(id, message, severity = "high") {
  return { id, message, severity };
}

function checkDocument(filePath, findings) {
  let document;
  try {
    document = new DocxDocument(filePath);
  } catch (error) {
    findings.push(finding("not-a-docx", `The output is not a readable Word document: ${error.message}`));
    return;
  }

  const allWords = document.allWords();
  if (allWords.length !== EXPECTED.wordCount) {
    findings.push(finding("word-count", `Expected ${EXPECTED.wordCount} permutations, found ${allWords.length} words.`));
  }
  const notPermutations = allWords.filter((word) => !isPermutationOfAnchor(word));
  if (notPermutations.length > 0) {
    findings.push(finding("foreign-words", `${notPermutations.length} word(s) are not permutations of ${ANCHOR}: ${notPermutations.slice(0, 5).join(", ")}.`));
  }
  const distinct = new Set(allWords);
  if (distinct.size !== allWords.length) {
    findings.push(finding("duplicates", `${allWords.length - distinct.size} permutation(s) appear more than once.`));
  }
  const anchorCount = allWords.filter((word) => word === ANCHOR).length;
  if (anchorCount !== 1) {
    findings.push(finding("anchor-count", `The anchor ${ANCHOR} appears ${anchorCount} time(s); it must appear exactly once.`));
  } else if (allWords[allWords.length - 1] !== ANCHOR) {
    findings.push(finding("anchor-position", `The anchor must be last (index 24); it is at index ${allWords.indexOf(ANCHOR) + 1}.`));
  }

  const rows = document.textParagraphs();
  if (rows.length !== EXPECTED.rows) {
    findings.push(finding("row-count", `Expected ${EXPECTED.rows} rows of text, found ${rows.length} non-empty paragraphs.`, "medium"));
  }
  const unevenRows = rows.filter((row) => words(row).length !== EXPECTED.columns);
  if (unevenRows.length > 0) {
    findings.push(finding("column-count", `${unevenRows.length} row(s) do not hold exactly ${EXPECTED.columns} words.`, "medium"));
  }
  const doubleSpaced = rows.filter((row) => /\S\s{2,}\S/.test(row));
  if (doubleSpaced.length > 0) {
    findings.push(finding("word-spacing", `${doubleSpaced.length} row(s) separate words by more than one space.`, "low"));
  }

  const pageSize = document.pageSize();
  if (!pageSize) {
    findings.push(finding("page-size", "The document declares no page size.", "medium"));
  } else if (Math.abs(pageSize.width - EXPECTED.pageWidthTwips) > 1 || Math.abs(pageSize.height - EXPECTED.pageHeightTwips) > 1) {
    findings.push(finding("page-size", `Page size is ${pageSize.width} x ${pageSize.height} twips; expected ${EXPECTED.pageWidthTwips} x ${EXPECTED.pageHeightTwips} (595.3 x 841.9 pt).`, "medium"));
  }
  const margins = document.pageMargins();
  if (!margins) {
    findings.push(finding("margins", "The document declares no page margins.", "medium"));
  } else {
    const wrong = Object.entries(margins).filter(([, value]) => Math.abs(value - EXPECTED.marginTwips) > 1);
    if (wrong.length > 0) {
      findings.push(finding("margins", `Margins ${wrong.map(([side, value]) => `${side}=${value}`).join(", ")} twips; expected ${EXPECTED.marginTwips} (18 pt) on every side.`, "medium"));
    }
  }
  const families = document.fontFamilies();
  if (families.length !== 1 || families[0] !== EXPECTED.fontFamily) {
    findings.push(finding("font-family", `Font families in use: ${families.join(", ") || "none declared"}; expected only ${EXPECTED.fontFamily}.`, "medium"));
  }
  const sizes = document.fontSizes();
  if (sizes.length !== 1 || sizes[0] !== EXPECTED.fontSizeHalfPoints) {
    findings.push(finding("font-size", `Font sizes in use (half-points): ${sizes.join(", ") || "none declared"}; expected only ${EXPECTED.fontSizeHalfPoints} (35 pt).`, "medium"));
  }
}

function main() {
  const workspace = workspaceRoot();
  const runner = new ToolRunner(workspace);
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-word-default-"));
  const outputPath = path.join(outputDirectory, "mine-full-page.docx");
  const findings = [];
  try {
    const result = runner.run(["--output", outputPath]);
    if (result.spawnError) {
      throw new Error(`The run command could not be started: ${result.spawnError}`);
    }
    if (result.timedOut) {
      findings.push(finding("timed-out", `The default run did not finish within the time limit. Command: ${result.command}`));
    } else if (result.exitCode !== 0) {
      findings.push(finding("exit-code", `The default run exited with ${result.exitCode}. stderr: ${result.stderr.trim().slice(0, 500)}`));
    }
    const produced = fs.existsSync(outputPath);
    if (!produced) {
      findings.push(finding("no-output", `No document was written to ${outputPath}.`));
    } else {
      checkDocument(outputPath, findings);
    }
    const extraFiles = fs.readdirSync(outputDirectory).filter((name) => name !== path.basename(outputPath));
    if (extraFiles.length > 0) {
      findings.push(finding("extra-files", `Files other than the document were delivered beside it: ${extraFiles.join(", ")}.`, "medium"));
    }
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
  report({
    findings,
    passSummary: "The default composition holds the 24 permutations of mine once each, anchor last, in 8 rows of 3 on the required page and typography.",
    failSummary: (list) => `${list.length} problem(s) with the default composition.`,
  });
}

try {
  main();
} catch (error) {
  reportError(error);
}
