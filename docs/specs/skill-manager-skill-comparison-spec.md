# Skill Manager Skill Comparison Spec

Date: 2026-07-02

## Purpose

Add a skill-manager feature that compares skills and surfaces potential
contradictions, overlaps, and ambiguous partial overlaps for user review.

This work matters because skill libraries grow by accretion. Two good skills can
still produce confusing agent behavior when they trigger on the same tasks,
disagree about precedence, or describe the same concept at different levels of
specificity. The app should help the user see those issues and resolve them case
by case, not automatically force skills to conform to one another.

## Goals

- Compare two skills and generate a Markdown report.
- Compare one skill to a selected set of skills by applying pairwise comparison
  and aggregating the findings.
- Surface contradictions, overlaps, vagueness from partial overlaps, trigger
  conflicts, missing precedence/handoff language, and other useful findings.
- Store generated Markdown reports in a dedicated report folder.
- Integrate the feature into the skill-manager app, not as an external one-off
  script.
- Preserve the SQLite catalog as the source of truth for known skills.

## Non-Goals

- No automatic rewriting of skills.
- No automatic decision that a finding is "wrong" or must be fixed.
- No blocking install/enable behavior based on comparison findings.
- No multi-agent or LLM provider matrix in v1.
- No persistent normalized comparison data in SQLite in v1 unless needed for
  report indexing.
- No startup scanning of the library root.

## Product Direction

Skill comparison is a decision-support feature. It should surface issues for
the user and let the user decide which issues matter.

The v1 output is a Markdown report. The app should create reports in a dedicated
folder and make them easy to open from the UI.

Proposed default report root:

`<electron-user-data>/skill-manager-reports/skill-comparisons/`

Tests may override this path with an environment variable or constructor
dependency.

## Current Architecture Context

Relevant current modules:

- `skill-manager/electron/main.js` wires Electron IPC to backend operations.
- `skill-manager/electron/preload.js` exposes renderer bridge methods.
- `skill-manager/electron/active-skill-library.js` orchestrates the selected
  library and app actions.
- `skill-manager/electron/skill-library.js` owns selected-library skill
  behavior.
- `skill-manager/electron/skill-discovery.js` owns `SKILL.md` reading and
  frontmatter parsing.
- `skill-manager/electron/skill-library-db.js` owns SQLite catalog persistence.
- `skill-manager/ui/renderer.js` owns current plain-JS UI state and rendering.

The new feature should not be part of catalog refresh. Comparing skills reads
cataloged skill paths and `SKILL.md` content, analyzes them, and writes a report
artifact.

## Concepts

### Pairwise comparison

A pairwise comparison compares exactly two skills:

- candidate skill,
- comparison skill.

It produces findings about how those two skills might interact.

### Set comparison

A set comparison compares one candidate skill against multiple comparison
skills. The default v1 approach is to run pairwise comparisons for each selected
skill and aggregate the results into one report.

This is a good starting point because it is explainable and debuggable. The
spec should leave room for a future holistic pass that looks across all skills
at once, because some issues may only appear from the combination of several
skills.

### Finding categories

The report should support at least these categories:

- `Trigger overlap`: both skills are likely to activate for the same user task.
- `Normative overlap`: both skills give similar or reinforcing guidance.
- `Contradiction`: skills instruct incompatible behavior.
- `Partial overlap / vagueness`: skills address the same area at different
  levels and the expected precedence is unclear.
- `Precedence gap`: skills may conflict but neither explains which one wins.
- `Missing handoff`: one skill should tell the agent to use another skill first
  or alongside it.
- `Scope mismatch`: one skill makes broad claims that should be limited to a
  narrower domain.
- `Terminology drift`: skills use different terms for the same concept or the
  same term for different concepts.

### Finding severities

Use report severities that support user triage:

- `blocking`: likely to cause wrong or unsafe agent behavior.
- `needs-decision`: requires user/product judgment.
- `needs-wording`: likely fixable by clarifying text.
- `benign`: useful context, no action required.

## V1 Workflow

### Compare two skills

1. User selects a skill from the active catalog.
2. User selects one comparison skill.
3. App reads both skills' `SKILL.md` files from cataloged paths.
4. App analyzes frontmatter descriptions and bodies.
5. App writes a Markdown report to the comparison report folder.
6. App shows a success message and offers to open the report.

### Compare skill to set

1. User selects a candidate skill.
2. User selects a set of comparison skills.
3. App runs the pairwise comparison for each pair.
4. App aggregates findings by category, severity, and comparison skill.
5. App writes one Markdown report.
6. App shows a success message and offers to open the report.

## Report Shape

Each report should include:

- report title,
- timestamp,
- active library path,
- candidate skill name and path,
- comparison skill names and paths,
- summary counts by severity and category,
- findings grouped by severity or category,
- pairwise sections for each compared skill,
- suggested user decisions,
- optional suggested wording changes.

A finding should include:

- category,
- severity,
- candidate skill section or excerpt summary,
- comparison skill section or excerpt summary,
- rationale,
- suggested resolution or decision prompt.

Reports should avoid long verbatim copies of entire `SKILL.md` files. They
should quote only short relevant excerpts and otherwise summarize.

## Analysis Engine

V1 may use an LLM-backed analyzer, a deterministic analyzer, or a hybrid.

The preferred v1 shape is a focused backend service with an interface such as:

```txt
SkillComparisonAnalyzer.comparePair(candidate, comparison) -> PairComparison
SkillComparisonAnalyzer.compareSet(candidate, comparisons) -> SetComparison
SkillComparisonReportWriter.write(report) -> report path
```

The app layer should depend on this interface rather than embedding analysis in
IPC or UI code.

If LLM-backed analysis is used, the implementation must:

- pass only the selected skills' content and minimal instructions,
- ask for structured findings before rendering Markdown,
- preserve raw structured output or enough metadata for debugging,
- fail clearly when the analyzer is unavailable.

If deterministic analysis is used first, it should at minimum compare
frontmatter descriptions, headings, explicit precedence language, and repeated
trigger phrases. Deterministic results may be less nuanced but easier to test.

## UI And IPC

Add IPC operations through `main.js` and `preload.js` for:

- comparing two skills,
- comparing one skill to a selected set,
- opening a generated report.

The renderer should expose the feature from a skill-focused action surface. A
simple v1 can use a modal or side panel with checkboxes for comparison skills.

The UI should make clear that findings are advisory and require user judgment.

## Error Handling

Fail clearly when:

- no active library is selected,
- candidate skill does not exist in the catalog,
- a comparison skill does not exist in the catalog,
- `SKILL.md` cannot be read,
- analyzer fails or returns malformed output,
- report directory cannot be created,
- report file cannot be written.

The feature should not mutate skill files.

## Testing Expectations

Automated tests should prove:

- pairwise comparison reads the selected catalog skills and writes a report,
- set comparison runs pairwise comparisons for each selected comparison skill,
- aggregation preserves which skill each finding came from,
- report files are written under the configured report folder,
- missing skill and missing `SKILL.md` errors are clear,
- analyzer failures do not corrupt catalog state,
- UI/IPC result shapes include report path and summary counts.

Use a fake analyzer in unit tests so tests do not depend on LLM output.

## Likely Files

Likely backend additions:

- `skill-manager/electron/skill-comparison-analyzer.js`
- `skill-manager/electron/skill-comparison-report-writer.js`
- `skill-manager/electron/skill-comparison-service.js`

Likely existing files touched:

- `skill-manager/electron/active-skill-library.js`
- `skill-manager/electron/main.js`
- `skill-manager/electron/preload.js`
- `skill-manager/ui/renderer.js`
- `skill-manager/ui/index.html`
- `skill-manager/tests/unit/...`
- `skill-manager/tests/integration/...`

## Open Questions

1. Should v1 use an LLM-backed analyzer, a deterministic analyzer, or a hybrid
   where deterministic extraction feeds an LLM summary?
2. Should reports live only under Electron user data, or should the user choose
   a report folder per library?
3. Should the set comparison include a holistic final pass over all findings, or
   is pairwise aggregation enough for v1?
4. Should the report include suggested wording patches, or only user-facing
   decision prompts?
