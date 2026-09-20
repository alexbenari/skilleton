const fs = require("fs");
const path = require("path");

const REQUIRED_SPEC_HEADINGS = ["## Purpose", "## Goals", "## Non-Goals"];
const REQUIRED_PLAN_SECTIONS = [
  "## Progress",
  "## Skill Gates",
  "## Surprises & Discoveries",
  "## Decision Log",
  "## Outcomes & Retrospective",
];

const workspace = process.env.EVALUATION_WORKSPACE || process.cwd();

function markdownFilesUnder(relativeDirectory) {
  const directory = path.join(workspace, relativeDirectory);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(directory, entry.name));
}

// Headings are matched case-insensitively. "## Non-goals" and "## Non-Goals"
// are the same section, and failing an output over the capital G would report a
// cosmetic difference as a structural defect.
function missingHeadings(filePath, headings) {
  const text = fs.readFileSync(filePath, "utf8").toLowerCase();
  return headings.filter((heading) => !text.includes(heading.toLowerCase()));
}

const findings = [];
const specs = markdownFilesUnder(path.join("docs", "specs"));
const plans = markdownFilesUnder(path.join("docs", "plans"));

if (specs.length === 0) {
  findings.push({ id: "spec-missing", message: "No Markdown file under docs/specs.", severity: "high" });
}
if (plans.length === 0) {
  findings.push({ id: "plan-missing", message: "No Markdown file under docs/plans.", severity: "high" });
}

for (const specPath of specs) {
  for (const heading of missingHeadings(specPath, REQUIRED_SPEC_HEADINGS)) {
    findings.push({
      id: "spec-heading",
      message: `${path.basename(specPath)} has no ${heading} section.`,
      severity: "medium",
    });
  }
}

for (const planPath of plans) {
  for (const heading of missingHeadings(planPath, REQUIRED_PLAN_SECTIONS)) {
    findings.push({
      id: "plan-section",
      message: `${path.basename(planPath)} has no ${heading} section, which PLANS.md requires.`,
      severity: "medium",
    });
  }
}

const status = findings.length === 0 ? "pass" : "fail";
process.stdout.write(
  `${JSON.stringify({
    status,
    summary:
      status === "pass"
        ? `${specs.length} spec and ${plans.length} plan file(s) carry every required section.`
        : `${findings.length} structural problem(s) across ${specs.length} spec and ${plans.length} plan file(s).`,
    findings,
  })}\n`
);
process.exitCode = status === "pass" ? 0 : 1;
