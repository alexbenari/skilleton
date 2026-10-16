const fs = require("fs");
const path = require("path");

const REQUIREMENT_PATTERN = /^R(\d+)\./gm;

const workspace = process.env.EVALUATION_WORKSPACE || process.cwd();

function readAll(relativeDirectory) {
  const directory = path.join(workspace, relativeDirectory);
  if (!fs.existsSync(directory)) {
    return "";
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => fs.readFileSync(path.join(directory, entry.name), "utf8"))
    .join("\n");
}

const requirementsPath = path.join(workspace, "requirements.md");
if (!fs.existsSync(requirementsPath)) {
  process.stdout.write(
    `${JSON.stringify({
      status: "error",
      summary: "requirements.md is not in the workspace, so nothing can be traced.",
      findings: [],
    })}\n`
  );
  process.exitCode = 1;
  return;
}

const requirementIds = [
  ...new Set(
    [...fs.readFileSync(requirementsPath, "utf8").matchAll(REQUIREMENT_PATTERN)].map(
      (match) => `R${match[1]}`
    )
  ),
];

// A requirement is traced when its identifier appears anywhere in the produced
// spec or plan. This is deliberately shallow: it catches a requirement that was
// never mentioned, not one that was mentioned and mishandled.
const produced = `${readAll(path.join("docs", "specs"))}\n${readAll(path.join("docs", "plans"))}`;
const untraced = requirementIds.filter(
  (id) => !new RegExp(`\\b${id}\\b`).test(produced)
);

const status = requirementIds.length === 0 ? "error" : untraced.length === 0 ? "pass" : "fail";
process.stdout.write(
  `${JSON.stringify({
    status,
    summary:
      status === "error"
        ? "requirements.md declares no R<n>. identifiers, so traceability cannot be checked."
        : `${requirementIds.length - untraced.length} of ${requirementIds.length} requirements are mentioned in the produced documents.`,
    findings: untraced.map((id) => ({
      id: "untraced-requirement",
      message: `${id} is not mentioned in any produced spec or plan.`,
      severity: "high",
    })),
  })}\n`
);
process.exitCode = status === "pass" ? 0 : 1;
