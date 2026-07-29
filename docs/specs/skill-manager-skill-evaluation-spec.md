# Skill Manager Skill Evaluation Spec

Date: 2026-07-25

## Purpose

Add a skill-manager feature for testing whether a skill improves an agent's
work on a realistic, file-backed task. The evaluation must work across skill
domains, including coding, learning-document writing, and future artifact-
oriented tasks.

This work matters because a skill can read well but still fail to improve
agent behavior in practice. The app should help the user run repeatable A/B
evaluations, inspect the resulting artifacts, and decide whether the skill
improved the overall task outcome.

## Goals

- Evaluate one skill on one evaluation target using paired baseline and
  skill-assisted runs.
- Automatically orchestrate both Codex runs from the app in v1, while keeping
  Codex itself as the execution engine behind an explicit integration boundary.
- Let the user select separate execution and evaluation models for each
  evaluation, with sensible defaults.
- Support multiple task domains without making code repositories, code
  generation, or code-quality review the universal model.
- Store evaluation artifacts in a dedicated folder under skill-manager
  control.
- Support realistic evaluation targets rather than artificial toy tasks.
- Compare outputs through a domain-appropriate blackbox review of the changed
  or produced artifacts.
- Make the proposed evaluation criteria explicit and require user approval
  before the paired runs begin.
- Persist the final evaluation criteria, validation definitions, and baseline
  results so future runs can reuse and compare against them.
- Track task completion, constraint adherence, and scope control so the
  comparison is fair.
- Start with one or two scenarios, including the ability to evaluate a
  learning-document-writing skill, then expand once the loop is proven.
- Make the feature part of the skill-manager app.

## Non-Goals

- No artificial insertion of known defects or writing problems just so the
  skill can fix them.
- No scoring that merely checks whether the output follows the skill's named
  rules.
- No automatic acceptance of feature-suggested validators or review criteria
  without user approval.
- No comparison against a stored baseline when the target, scenario, skill
  configuration, or approved evaluation criteria are incompatible.
- No assumption that every evaluation target is source code or has a test
  suite.
- No general-purpose evaluation of interactive UI, browser, or non-file-backed
  work in v1. The first execution substrate is an isolated file workspace.
- No multi-provider benchmark matrix in v1.
- No skill comparison/compatibility reporting in this spec.

## Product Direction

The feature should evaluate a skill as a black box:

1. prepare the same starting inputs for a baseline run and a skill-assisted
   run,
2. propose an evaluation plan covering validation checks and quality-review
   criteria,
3. let the user review, edit, and approve that evaluation plan,
4. run the same task without the skill,
5. run the same task with the skill explicitly loaded,
6. apply the approved plan to both outputs, and
7. use the selected evaluation model to compare the outputs using the approved
   evidence and rubric, and
8. retain the final evaluation definition and persist the run and comparison
   results.

The scoring should not simply reward the output for visibly following the
evaluated skill's target rules. The point is the overall task outcome: did the
agent complete the requested task correctly, within scope, and at an
appropriate quality level for the target domain?

The shared v1 abstraction is a file-backed evaluation target. A target may be
a source repository, a collection of Markdown learning documents, or another
folder of inputs and expected outputs. The target definition, rather than the
evaluation service, determines which validators and review dimensions apply.

The app must orchestrate the two Codex runs automatically. The runner should
be an explicit integration adapter: it supplies Codex with the scenario prompt,
isolated workspace, skill configuration, and recorded execution settings; it
captures status, output, generated artifacts, and failures; and it supports
bounded execution with cancellation. The evaluation service should depend on
that capability rather than embedding provider-specific process details in the
comparison workflow.

The evaluation plan is intentionally not fully universal or fully automatic.
The feature may suggest a plan using the task, target, scenario, and the
purpose and guidance of the selected skill, but the user must approve it before
the runs are evaluated. The approved plan should explain both what can be
checked mechanically and how quality will be judged.

Each evaluation has two independently selectable model roles:

- The **execution model** performs both the baseline and skill-assisted task
  runs. It must be the same model and configuration for both runs so the
  evaluated skill is the intended experimental difference. The default is
  **Luna (High)**.
- The **evaluation model** performs the evidence-based review and comparison of
  the two outputs. The default is **Eval Sol (High)**. It may differ from the
  execution model and must not modify either run workspace.

The app must show both selections before the runs start, allow the user to
override either default, and record the exact selected model configurations in
the evaluation definition and report.

## Current Architecture Context

Relevant current modules:

- `skill-manager/electron/main.js` wires Electron IPC to backend operations.
- `skill-manager/electron/preload.js` exposes the renderer bridge.
- `skill-manager/electron/active-skill-library.js` orchestrates the selected
  library and app actions.
- `skill-manager/electron/skill-library.js` resolves cataloged skills.
- `skill-manager/electron/skill-installer.js` installs skill copies into a
  project or global skill root.
- `skill-manager/ui/renderer.js` owns the current UI.

The new feature should be a separate evaluation capability. It should not be
implemented inside catalog refresh, install, or tag editing.

## Concepts

### Evaluation target

A file-backed set of starting inputs and context under test. It may be:

- a fixture checked into the repository,
- a user-selected local project or document workspace, or
- a temporary copy of an existing repository or document set.

The target may contain code, Markdown, configuration, reference material,
assets, or a mixture of these. V1 should start with checked-in fixtures so the
loop is repeatable.

### Scenario

A task prompt plus metadata describing:

- the target and its starting state,
- optional setup/reset instructions,
- task constraints and scope boundaries,
- validators or validation commands,
- changed-artifact review guidance,
- expected user-visible behavior or artifact properties, and
- any domain-specific assumptions the reviewer needs.

A scenario describes the task being evaluated, not the internal rules of the
skill under test. It may provide candidate checks and review guidance, but the
final evaluation criteria live in the approved evaluation plan.

### Evaluation plan

The user-approved definition of what evidence to collect and how to review the
two runs. It should include:

- the task outcome and acceptance behavior to evaluate,
- automated validators or checks,
- quality-review dimensions and reviewer prompts,
- any skill-specific pointers that are relevant to the task, and
- known limitations, assumptions, or evidence that cannot be automated.

The plan should evaluate the skill's practical effect, not reward mechanical
compliance with the skill text. The feature may use broad defaults and the
skill's stated purpose to draft the plan. For example:

- For coding skills, the default may be a broad changed-code quality review
  covering correctness, maintainability, boundaries, tests, regressions, and
  scope, with optional skill-specific pointers added as review prompts.
- For `learning-doc-writing`, the proposed review may derive from the skill's
  purpose: self-containedness, correctness, clarity, structure, terminology,
  useful intuition and examples, audience fit, cross-references, and adherence
  to the document's intended scope.

These are suggestions, not automatic judgments. The user can accept, remove,
or revise any proposed validator or review dimension before starting the
paired evaluation.

### Evaluation definition

The persisted, versioned form of an approved evaluation plan. It includes the
final acceptance criteria, validator definitions, quality-review rubric,
skill-specific pointers, selected skill reference or content fingerprint,
target and scenario references, execution and evaluation model configurations,
and the assumptions needed to interpret results.

Future runs should reuse the same evaluation definition when the user wants a
longitudinal comparison. If the definition changes, the app should create a
new version and make the change visible in the resulting report.

### Baseline reference

The persisted baseline result associated with an evaluation definition and a
specific target snapshot. It includes the baseline workspace or artifacts,
execution settings, validator definitions and results, factual change
description, and the target/scenario fingerprints needed to determine whether
it remains comparable.

Future skill-assisted runs may compare against a stored baseline reference
without rerunning the baseline, provided the app confirms that the target
snapshot, scenario, execution settings, and evaluation definition are
compatible. The user should also be able to rerun and establish a new
baseline when deliberately creating a new reference; this should create a new
baseline identity while preserving the historical one.

### Baseline run

The app starts Codex through the execution integration and performs the
scenario without the skill being evaluated.

### Skill-assisted run

The app starts Codex through the same execution integration and performs the
same scenario with the skill enabled or explicitly loaded.

### Codex execution integration

The app boundary responsible for launching and supervising one Codex run. It
must accept the run workspace, prompt, selected skill configuration, and run
settings; expose progress and completion state; capture the transcript and
process result; and retain any produced artifacts or partial artifacts.

The integration should make baseline and skill-assisted runs equivalent apart
from the evaluated skill. The app should record the execution model, prompt,
relevant environment/configuration, skill configuration, timeout, and
cancellation state so a report can identify meaningful differences or
deviations.

### Evaluation-model review

A read-only model invocation that compares the baseline and skill-assisted
outputs after the runs complete. It receives the approved evaluation plan,
factual change descriptions, relevant artifacts and nearby context, validation
results, and baseline metadata. It returns a structured, evidence-backed
quality review and conclusion for the report.

The evaluation model must not edit run workspaces, execute the task again, or
replace recorded validation results. Its role is to assess the supplied
evidence, identify uncertainty, and compare the outputs according to the
user-approved criteria.

### Changed-artifact review

An evidence-backed review focused on artifacts changed or produced by a run,
plus the nearby context needed to judge them. It must have two distinct parts:

1. A factual change description that records what changed, such as added,
   modified, renamed, or deleted files; changed document sections; produced
   artifacts; diff/statistics; and other directly observable scope facts.
2. A qualitative review that assesses whether those changes are correct,
   complete, clear, maintainable, useful, and appropriately integrated for the
   evaluation target and approved evaluation plan.

The app derives the factual description directly from the workspace and
validator evidence. The selected evaluation model produces the qualitative
review from that evidence and the user-approved rubric.

For a code target the qualitative review may assess changed-code quality; for a
learning-document target it may assess changed sections, headings, examples,
links, and surrounding document structure.

The review should not let unrelated pre-existing quality dominate the result,
but it must still inspect enough context to detect broken integration or
contradictions.

### Validation result

Evidence produced by an automated command or configured check for one run.
Examples include tests, type checks, builds, Markdown structure checks, link
checks, or document-specific scripts. A scenario may also record reviewer
observations when an important property cannot be automated.

### Evaluation report

A comparison of the baseline and skill-assisted runs. It combines task
outcome, validation evidence, changed-artifact review, and uncertainty rather
than reducing the decision to an unexplained numeric score.

## V1 Workflow

1. User selects a skill from the active skill library.
2. User selects an evaluation target fixture and scenario.
3. App shows the execution-model and evaluation-model selections, defaulting
   to Luna (High) and Eval Sol (High), respectively; the user may override
   either selection.
4. App proposes an evaluation plan from the target, scenario, and selected
   skill's purpose and guidance.
5. User reviews, edits, and approves the evaluation plan.
6. App persists the approved evaluation definition, including both model
   selections.
7. App either selects a compatible stored baseline reference or starts a new
   baseline branch.
8. For a new baseline, App creates an isolated workspace, runs the baseline
   Codex task automatically without the evaluated skill, captures its result,
   applies the approved validators, produces its factual change description,
   and persists the result as a reusable baseline reference.
9. For a reused baseline, App verifies compatibility and loads its stored
   artifacts, validation results, and factual change description without
   silently rerunning or replacing them.
10. App creates an isolated skill-assisted workspace from the same target
   snapshot represented by the baseline.
11. App starts the skill-assisted Codex run automatically with the selected
   skill enabled or explicitly loaded.
12. App captures skill-assisted progress, transcript, status, workspace
   changes, and any execution failure.
13. App runs the approved validators for the skill-assisted output and
    produces its factual change description.
14. App invokes the selected evaluation model with the approved evaluation
    plan and collected evidence to produce the structured comparison.
15. App generates a blackbox quality comparison report using that comparison.
16. App persists the validation results, evaluation-model review, and
    comparison report.
17. User reviews the report and decides whether to revise the skill, scenario,
    or evaluation target.

The user initiates the evaluation from the app, but does not need to manually
run Codex or return completed workspace paths between the two runs. The app
still delegates model execution to Codex and should expose cancellation and
clear recovery behavior if a run cannot complete.

## Evaluation Artifacts

Proposed repository structure:

```txt
skill-manager/evaluations/
  fixtures/
    clip-sandbox-mini/
    learning-docs-mini/
  definitions/
    .gitkeep
  baselines/
    .gitkeep
  scenarios/
    typescript-coding/
      add-video-edit.md
      add-domain-concept.md
    learning-doc-writing/
      improve-learning-document.md
  runs/
    .gitkeep
  reports/
    .gitkeep
```

`runs/` should contain isolated run outputs only when intentionally saved. The
app should also support using OS temp directories for scratch runs. A retained
run should include enough metadata to reproduce or audit the comparison,
including its workspace reference, execution settings, transcript or output
record, exit/status result, and changed or produced artifacts.

The retained evaluation should also record the proposed and approved
evaluation plan, including any user edits made before the runs began.

It must persist the final evaluation definition and baseline reference, not
only the generated report. A future run should be able to load the exact
approved criteria and validation checks, inspect the baseline results, and
produce a new comparison without relying on prose copied from an old report.

The app should make evaluation-definition versions and baseline identities
stable and visible. A report must state whether it reused a stored baseline or
created a new one.

It must also record the execution and evaluation model configurations used for
each historical run and comparison, including their quality/tier selection.

Generated run artifacts and reports may later move to Electron user data if
the app needs to avoid writing inside the source tree.

## Initial Evaluation Targets

The first targets should demonstrate that the model is not coding-specific.
The exact first scenario set remains open, but the design should support both
of the following shapes.

### Coding target

The existing proposed first fixture is a realistic simplified version of
`D:\tmp\dev\clip-sandbox`. It should preserve real application pressures:

- folder-backed clips and collections,
- domain concepts such as `Clip`, `ClipSequence`, `Collection`, and `Pipeline`,
- an app/service layer such as `PipelineSession` and `ClipEditor`,
- adapter boundaries for filesystem/video-edit runtime work,
- Vitest tests, and
- real validation commands.

It may include actual ffmpeg dependency wiring if useful, representative
filesystem behavior, realistic media-edit command construction, and enough
Electron-like boundary shape to preserve the domain/service split.

It should avoid massive binary fixtures, unrelated UI complexity, or planted
defects. Any weaknesses should come from normal simplification or existing
application shape, not from attempts to manufacture a win for a coding skill.

### Learning-document target

Add a checked-in fixture containing one or more Markdown learning documents and
the minimum supporting context needed to revise them realistically. It should
exercise document-writing concerns such as:

- understanding the existing document's intent, reader, and structure,
- improving or extending an explanation rather than merely adding volume,
- preserving or updating the table of contents and heading hierarchy,
- keeping terminology, examples, links, and cross-references coherent, and
- producing a self-contained document at an appropriate level of depth.

A candidate scenario is to ask Codex to improve a specified learning document
or add a bounded conceptual section while preserving the document's existing
scope and voice. The fixture should use good-faith source material and should
not contain deliberately broken prose or planted omissions solely to make the
learning-document skill look useful.

The evaluation review for this target should consider document correctness,
clarity, structure, self-containedness, useful intuition/examples, and
consistency with the supplied source material. It should not score the result
by checking whether it mechanically repeats the skill's wording.

## Initial Scenarios

Start with one or two scenarios. At least one initial scenario should be
chosen from a non-coding domain before the evaluation model is treated as
validated for general use.

### Scenario: Add a new video edit

Prompt asks Codex to add a new video edit capability, such as generating a
thumbnail or preview asset.

The task should require:

- understanding existing edit catalog/service boundaries,
- adding domain or application behavior,
- updating tests, and
- preserving validation behavior.

### Scenario: Improve a learning document

Prompt asks Codex to improve a bounded section of an existing learning
document, or add a new section that fits its intended audience and scope.

The task should require:

- reading the existing document before editing,
- preserving the author's conceptual intent and terminology,
- updating structural elements such as the table of contents when needed,
- adding useful explanation or examples rather than filler, and
- validating the result against document-specific checks and review guidance.

### Scenario: Add a new domain concept

Prompt asks Codex to add a new meaningful domain concept to the clip sandbox
fixture.

Candidate concepts to discuss:

- `ClipRating`
- `ClipTag`
- `PlaybackRange`
- `ExportPreset`
- `CollectionRule`

The scenario should require a real modeling decision rather than merely adding
a field. It should be realistic for the clip-sandbox domain and should have
observable behavior in tests or app code.

### Deferred scenario ideas

These may be revisited later:

- collection persistence adapter,
- clip identity tightening,
- save/load workflow changes,
- ffmpeg runtime error classification, and
- more learning-document tasks with different source-material or restructuring
  constraints.

## Evaluation Plan And Validation

Each evaluation target or scenario may provide candidate validators and review
guidance. The feature may add suggestions based on the selected skill's purpose
and the target domain. The user must approve the combined evaluation plan
before the paired runs start.

The approved plan defines the validators that make sense for the evaluation.
Validators are evidence, not a universal cross-domain rubric.

The app must persist both the validator definitions and each validator's
result for the baseline and skill-assisted runs. A result should include at
least the validator identity/version, command or check description, outcome,
captured output or finding, and execution context needed to interpret it.

Examples include:

- tests, type checks, lint, or builds for code targets;
- Markdown structure, link, or heading/TOC checks for document targets; and
- small target-specific scripts for configuration, data, or other artifacts.

For the initial TypeScript fixture, likely commands are:

```txt
npm install
npm run typecheck
npm run unit
```

Additional commands such as lint, build, or integration tests should be
included only if the fixture already supports them realistically. A learning-
document fixture should similarly define only checks that are meaningful for
its documents; human review remains necessary for qualities such as clarity,
intuition, and usefulness.

## Blackbox Quality Comparison

The quality comparison should evaluate the resulting changed or produced
artifacts and the task outcome according to the approved evaluation plan, not
merely whether the output follows the evaluated skill's checklist.

The selected evaluation model performs this comparison from the captured
evidence. Its conclusion is an assessment, not a hidden validator: the report
must preserve the factual change description, validation results, review
reasoning, and uncertainty that support it.

The report should include a common core of evidence:

- task completion and expected user-visible outcome,
- validation results,
- adherence to task constraints and scope control,
- behavioral or content correctness risks,
- integration with the existing target and conventions,
- regressions, contradictions, or unrelated churn,
- quality of tests or other supporting evidence when relevant, and
- an explicit account of uncertainty or missing evidence.

The approved evaluation plan may add domain-specific review dimensions. For
example, a code scenario may review maintainability, names, boundaries, and
test quality, while a learning-document scenario may review clarity, structure,
terminology, self-containedness, examples, and cross-references.

The report may include scores, but it should emphasize evidence and judgment
over false precision. The overall recommendation should be one of:

- baseline better,
- skill-assisted better,
- mixed,
- equivalent within the available evidence, or
- inconclusive.

Reviewers should compare only the areas that actually changed or were
produced, plus nearby context needed to judge those artifacts.

## Report Shape

Generated Markdown reports should include:

- skill under evaluation,
- scenario and evaluation target,
- execution model and evaluation model configurations,
- proposed and approved evaluation plan, including user edits,
- evaluation-definition version,
- baseline reference and whether it was reused or newly created,
- baseline workspace or artifact reference,
- skill-assisted workspace or artifact reference,
- validation check definitions and results for both runs,
- factual change description and artifact inventory for each run,
- changed or produced artifacts for each run,
- domain-specific review dimensions used,
- quality comparison with supporting evidence,
- conclusion, and
- follow-up recommendations for the skill, scenario, or target.

Reports should live in a dedicated report folder:

`skill-manager/evaluations/reports/`

or a configured Electron-user-data equivalent for app-generated reports.

## UI And IPC

V1 app UI can be simple:

- select skill,
- select evaluation target/scenario,
- select execution and evaluation models, with Luna (High) and Eval Sol (High)
  as the defaults,
- review and approve the proposed evaluation plan,
- load or create an evaluation-definition version,
- select a compatible stored baseline or request a new baseline run,
- create/reset baseline and skill-assisted workspaces,
- start the paired evaluation automatically,
- show live baseline and skill-assisted run status and output,
- cancel or retry an incomplete run,
- run configured validators,
- generate/open Markdown report, and
- show validation and run-state errors separately from evaluation findings.

IPC operations should cover:

- listing available evaluation targets and scenarios,
- listing supported execution and evaluation models and their defaults,
- selecting and recording execution and evaluation model configurations,
- proposing and recording an evaluation plan,
- recording user approval or edits to the evaluation plan,
- loading, versioning, and reusing evaluation definitions,
- listing and selecting compatible baseline references,
- preparing paired workspaces,
- starting, monitoring, canceling, and recording Codex runs,
- running configured validators,
- generating a report, and
- opening a report.

## Error Handling

Fail clearly when:

- no active library is selected,
- selected skill does not exist,
- evaluation target does not exist,
- scenario does not exist or is malformed,
- the evaluation plan cannot be proposed or is not approved,
- a requested evaluation definition or baseline reference is missing,
- a stored baseline is incompatible with the current target, scenario,
  execution settings, or evaluation definition,
- workspace preparation fails,
- the Codex execution integration is unavailable or cannot launch a run,
- the selected execution or evaluation model is unavailable or unsupported for
  its assigned role,
- the evaluation-model review cannot complete or return a structured result,
- a Codex run times out or is canceled,
- a validator cannot start,
- a run workspace is missing,
- changed-artifact or diff computation cannot be completed, or
- a report cannot be written.

Validation failures are not app errors. They are evaluation results. A
reviewer finding that an artifact is unclear, incomplete, or otherwise weak is
also an evaluation result, not an infrastructure failure.

A Codex launch failure, timeout, cancellation, or non-success process result is
run-status evidence and must be visible in the report. It must not be silently
converted into a successful run or treated as an ordinary validator failure.
If partial artifacts exist, the app may retain them for diagnosis while
marking the run incomplete.

## Testing Expectations

Automated tests should prove:

- evaluation targets and scenarios can be listed,
- an evaluation plan is proposed from target, scenario, and skill context,
- the user can edit and approve the plan before execution,
- Luna (High) and Eval Sol (High) are offered as the respective defaults,
- the user can override either model role independently,
- the final evaluation definition is versioned and retained,
- compatible baseline references can be listed and reused,
- incompatible baselines are rejected with a clear reason,
- paired workspaces are created from the same source state,
- workspace reset does not mutate the fixture,
- baseline and skill-assisted runs receive equivalent settings apart from the
  evaluated skill,
- baseline and skill-assisted runs use the same selected execution model,
- the selected evaluation model receives the approved plan and captured
  evidence but cannot mutate either run workspace,
- the Codex runner can be replaced by a fake runner in automated tests,
- run progress, transcripts/output, status, failures, and produced artifacts
  are captured as data,
- evaluation definitions, validator definitions, baseline results, and review
  findings can be persisted and loaded for future runs,
- future runs reuse a compatible baseline without losing its original results,
- changing the evaluation definition creates a new version rather than
  mutating historical results,
- cancellation and timeout states are represented clearly,
- validators' results are captured as data,
- report generation includes both baseline and skill-assisted run metadata,
- domain-specific review guidance is represented in the report,
- missing target/scenario/run paths produce clear errors, and
- generated reports are written under the configured evaluation report folder.

Use fake completed run workspaces in tests. Do not require real Codex runs in
automated tests.

## Likely Files

Likely backend additions:

- `skill-manager/electron/skill-evaluation-service.js`
- `skill-manager/electron/skill-evaluation-fixtures.js`
- `skill-manager/electron/skill-evaluation-codex-runner.js`
- `skill-manager/electron/skill-evaluation-model-reviewer.js`
- `skill-manager/electron/skill-evaluation-definition-store.js`
- `skill-manager/electron/skill-evaluation-report-writer.js`

Likely existing files touched:

- `skill-manager/electron/active-skill-library.js`
- `skill-manager/electron/main.js`
- `skill-manager/electron/preload.js`
- `skill-manager/ui/renderer.js`
- `skill-manager/ui/index.html`
- `skill-manager/tests/unit/...`
- `skill-manager/tests/integration/...`

Likely fixture/report folders:

- `skill-manager/evaluations/fixtures/clip-sandbox-mini/`
- `skill-manager/evaluations/fixtures/learning-docs-mini/`
- `skill-manager/evaluations/scenarios/typescript-coding/`
- `skill-manager/evaluations/scenarios/learning-doc-writing/`
- `skill-manager/evaluations/runs/`
- `skill-manager/evaluations/reports/`

## Open Questions

1. Should app-generated runs/reports live inside the repo under
   `skill-manager/evaluations/`, or under Electron user data with only fixtures
   and scenario definitions in the repo?
2. Which Codex execution integration should v1 use, and how should the app
   authenticate, configure, and supervise it while keeping the runner boundary
   replaceable for tests?
3. Should evaluation-plan suggestions come from target/scenario templates,
   skill metadata and content, a separate reviewer run, or a combination?
4. Which two initial scenarios should prove the loop: one coding scenario and
   one learning-document scenario, or two scenarios in one domain first?
5. Should the learning-document fixture use one standalone Markdown file, a
   small linked document set, or a document plus source/reference files?
6. Should v1 validators be limited to executable commands, or should the
   scenario format also support structured manual review prompts and recorded
   answers?
7. How should the app represent targets whose meaningful output is not a
   conventional source diff, such as a newly generated document or a changed
   set of linked Markdown files?
