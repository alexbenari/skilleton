// Builds the define request for the coding-quality v1 vs v2 evaluation. The
// pointer paragraphs are lifted from the shared instruction file by the same
// rule project discovery uses, so activation finds them already present and
// does not append a second copy.
const fs = require("fs");
const path = require("path");

const catalogRoot = path.resolve(__dirname, "..");
const subjects = "subjects/anchor-word";
// The arms run on Claude, so the shared instruction file is the repository's
// CLAUDE.md, which is what wires the code-quality-review skill into every
// non-trivial change.
const instructionFile = "instruction-file-claude.md";
const instructionText = fs.readFileSync(path.join(catalogRoot, subjects, instructionFile), "utf8");

function pointerFor(baseName) {
  const paragraphs = instructionText.split(/\r?\n\s*\r?\n/);
  const mentioning = paragraphs.find((paragraph) => paragraph.includes(baseName));
  if (!mentioning) {
    throw new Error(`The instruction file never mentions ${baseName}.`);
  }
  return mentioning.trim();
}

function guidance(codingQualitySnapshot) {
  return [
    { kind: "instruction-file", name: "CLAUDE", sourcePath: `${subjects}/${instructionFile}` },
    {
      kind: "referenced-document",
      name: "PLANS",
      sourcePath: `${subjects}/plans.md`,
      workspacePath: "PLANS.md",
      pointerText: pointerFor("PLANS.md"),
    },
    {
      kind: "referenced-document",
      name: "coding-quality",
      sourcePath: `${subjects}/${codingQualitySnapshot}`,
      workspacePath: "coding-quality.md",
      pointerText: pointerFor("coding-quality.md"),
    },
    { kind: "skill", name: "code-quality-review", sourcePath: "../../skills/code-quality-review" },
    // PLANS.md names testing-discipline as an execution gate before writing or
    // repairing tests, so the gate is real in both arms rather than "unavailable".
    { kind: "skill", name: "testing-discipline", sourcePath: "../../skills/97/skills/testing-discipline" },
  ];
}

const arm = (snapshot) => ({ agent: "claude", model: "claude-opus-5-5", effort: "high", guidance: guidance(snapshot) });

const request = {
  id: "coding-quality-v1-vs-v2",
  targetId: "anchor-word-spec",
  scenarioId: "plan-and-implement",
  guidanceDifferenceMode: "prior-version",
  referenceArm: arm("coding-quality-v1.md"),
  candidateArm: arm("coding-quality-v2.md"),
  reviewerRole: "user",
  decisionFraming: "improvement",
  repetitionCount: 1,
  notes:
    "Does the rewritten coding-quality document (v2) produce a better plan and C# implementation of the anchor-word tool than the current one (v1)? " +
    "Both arms share the repository's CLAUDE.md, PLANS.md, and the code-quality-review and testing-discipline skills as fixed guidance; only the document behind the coding-quality pointer differs. " +
    "The skill adds no rules of its own: its fresh-context reviewer checks the change against whichever coding-quality document the arm has, so it amplifies the difference rather than adding one. " +
    "The plan is not frozen: each arm writes its own plan before coding, so the document influences planning as well as code, and a difference may come from either. " +
    "The shared CLAUDE.md names other repository features (docs/agent-docs, doc-update, doc-alignment, plan-review) that are absent from the workspace; both arms meet the same gaps.",
};

const outputPath = path.join(__dirname, "coding-quality-v1-vs-v2.json");
fs.writeFileSync(outputPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${outputPath}\n`);
