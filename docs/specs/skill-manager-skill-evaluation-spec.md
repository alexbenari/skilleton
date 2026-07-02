# Skill Manager Skill Evaluation Spec

Date: 2026-07-02

## Purpose

Add a skill-manager feature for testing a skill's effect on a real codebase by
comparing code generation with and without the skill.

This work matters because a skill can read well but still fail to improve agent
behavior in practice. The app should help the user run repeatable A/B
evaluations, inspect changed code, and decide whether the skill improved the
overall quality of the resulting codebase.

## Goals

- Evaluate one skill on one codebase using paired baseline and skill-assisted
  runs.
- Keep v1 compatible with Codex outside the app as the execution engine.
- Store evaluation artifacts in a dedicated folder under skill-manager control.
- Support realistic codebases rather than artificial toy examples.
- Compare outputs through blackbox code-quality review of the changed areas.
- Track task completion and scope control so the comparison is fair.
- Start with one or two scenarios, then expand once the loop is proven.
- Make the feature part of the skill-manager app.

## Non-Goals

- No fully automated in-app Codex runner in v1 unless a separate execution
  integration is approved.
- No artificial insertion of known defects just so the skill can fix them.
- No scoring that merely checks whether the output follows the skill's named
  rules.
- No forced TypeScript-only design; TypeScript is only the first use case.
- No multi-provider benchmark matrix in v1.
- No skill comparison/compatibility reporting in this spec.

## Product Direction

The feature should evaluate a skill as a black box:

1. run the same task without the skill,
2. run the same task with the skill,
3. validate both outputs,
4. review the quality of the changed areas,
5. compare the results.

The scoring should not simply reward the output for visibly following the
skill's target rules. The point is overall codebase quality and task outcome.

For the TypeScript coding skill's first evaluation target, the codebase should
be a realistic simplified version of `D:\tmp\dev\clip-sandbox` and may use real
dependencies such as ffmpeg if they help preserve realism.

The proposed fixture/report root for v1 is under skill-manager:

```txt
skill-manager/evaluations/
  fixtures/
  scenarios/
  runs/
  reports/
```

Generated run artifacts and reports may later move to Electron user data if the
app needs to avoid writing inside the source tree.

## Current Architecture Context

Relevant current modules:

- `skill-manager/electron/main.js` wires Electron IPC to backend operations.
- `skill-manager/electron/preload.js` exposes renderer bridge methods.
- `skill-manager/electron/active-skill-library.js` orchestrates the selected
  library and app actions.
- `skill-manager/electron/skill-library.js` resolves cataloged skills.
- `skill-manager/electron/skill-installer.js` installs skill copies into a
  project or global skill root.
- `skill-manager/ui/renderer.js` owns the current UI.

The new feature should be a separate evaluation capability. It should not be
implemented inside catalog refresh, install, or tag editing.

## Concepts

### Evaluation codebase

A codebase under test. It may be:

- a fixture checked into the repository,
- a user-selected local project,
- a temporary copy of an existing repo.

V1 should start with a checked-in fixture so the loop is repeatable.

### Scenario

A task prompt plus metadata describing:

- target codebase,
- optional setup/reset instructions,
- validation commands,
- changed-area review guidance,
- expected user-visible task behavior.

### Baseline run

Codex performs the scenario without the skill being evaluated.

### Skill-assisted run

Codex performs the same scenario with the skill enabled or explicitly loaded.

### Changed-area review

A code quality review focused only on areas changed by a run. This prevents a
large existing codebase's unrelated quality from dominating the score.

## V1 Workflow

1. User selects a skill from the active skill library.
2. User selects an evaluation codebase fixture and scenario.
3. App creates two isolated workspaces from the same starting state.
4. App produces clear instructions for running the baseline Codex task.
5. User runs Codex outside the app for the baseline workspace and returns or
   points the app at the resulting workspace/diff.
6. App produces clear instructions for running the skill-assisted Codex task.
7. User runs Codex outside the app with the skill enabled or explicitly loaded
   and returns or points the app at the resulting workspace/diff.
8. App runs or records validation commands for both outputs.
9. App generates a blackbox quality comparison report.
10. User reviews the report and decides whether to revise the skill.

This keeps v1 useful before the app can directly drive Codex.

## Evaluation Artifacts

Proposed repository structure:

```txt
skill-manager/evaluations/
  fixtures/
    clip-sandbox-mini/
  scenarios/
    typescript-coding/
      add-video-edit.md
      add-domain-concept.md
  runs/
    .gitkeep
  reports/
    .gitkeep
```

`runs/` should contain isolated run outputs only when intentionally saved. The
app should also support using OS temp directories for scratch runs.

## First Codebase Fixture

The first fixture should be a realistic simplified version of
`D:\tmp\dev\clip-sandbox`.

It should preserve the real app pressures:

- folder-backed clips and collections,
- domain concepts such as `Clip`, `ClipSequence`, `Collection`, and `Pipeline`,
- an app/service layer such as `PipelineSession` and `ClipEditor`,
- adapter boundaries for filesystem/video-edit runtime work,
- Vitest tests,
- real validation commands.

It may include:

- actual ffmpeg dependency wiring if useful,
- representative filesystem behavior,
- realistic media-edit command construction,
- enough Electron-like boundary shape to preserve the domain/service split.

It should avoid:

- adding intentionally bad code only to make the skill look useful,
- massive binary fixtures unless they are necessary,
- unrelated UI complexity that makes evaluation noisy.

The fixture should be good-faith realistic code. Any weaknesses should come
from normal simplification or existing application shape, not planted defects.

## Initial Scenarios

Start with one or two scenarios. Final scenario choice will be decided after
reviewing this spec.

### Scenario: Add a new video edit

Prompt asks Codex to add a new video edit capability, such as generating a
thumbnail or preview asset.

The task should require:

- understanding existing edit catalog/service boundaries,
- adding domain or application behavior,
- updating tests,
- preserving validation behavior.

### Scenario: Add a new domain concept

Prompt asks Codex to add a new meaningful domain concept to the clip sandbox
fixture.

Candidate concepts to discuss:

- `ClipRating`
- `ClipTag`
- `PlaybackRange`
- `ExportPreset`
- `CollectionRule`

The scenario should require a real modeling decision rather than merely adding a
field. It should be realistic for the clip-sandbox domain and should have
observable behavior in tests or app code.

### Deferred scenario ideas

These may be revisited later:

- collection persistence adapter,
- clip identity tightening,
- save/load workflow changes,
- ffmpeg runtime error classification.

## Validation Commands

Each evaluation fixture should define its own validation commands.

For the initial TypeScript fixture, likely commands are:

```txt
npm install
npm run typecheck
npm run unit
```

Additional commands such as lint, build, or integration tests should be included
only if the fixture already supports them realistically.

## Blackbox Quality Comparison

The quality comparison should evaluate the resulting changed areas as code,
not merely whether the output follows the evaluated skill's checklist.

The report should include:

- task completion,
- validation results,
- scope control,
- behavioral correctness risks,
- maintainability of changed code,
- clarity of names and boundaries,
- test quality for the changed behavior,
- integration with existing architecture,
- regressions or unrelated churn,
- overall recommendation: baseline better, skill-assisted better, mixed, or
  inconclusive.

Reviewers should compare only the areas that actually changed, plus nearby
context needed to judge those changes.

The report may include scores, but it should emphasize evidence and judgment
over false precision.

## Report Shape

Generated Markdown reports should include:

- skill under evaluation,
- scenario,
- codebase fixture,
- baseline workspace or diff reference,
- skill-assisted workspace or diff reference,
- validation commands and results,
- changed files for each run,
- quality comparison,
- conclusion,
- follow-up recommendations for the skill or scenario.

Reports should live in a dedicated report folder:

`skill-manager/evaluations/reports/`

or a configured Electron-user-data equivalent for app-generated reports.

## UI And IPC

V1 app UI can be simple:

- select skill,
- select fixture/scenario,
- create/reset baseline and skill-assisted workspaces,
- show copyable Codex instructions for each run,
- accept paths to completed run workspaces,
- run configured validation commands,
- generate/open Markdown report.

IPC operations should cover:

- listing available evaluation fixtures and scenarios,
- preparing paired workspaces,
- recording completed run paths,
- running validation commands,
- generating a report,
- opening a report.

## Error Handling

Fail clearly when:

- no active library is selected,
- selected skill does not exist,
- fixture does not exist,
- scenario does not exist or is malformed,
- workspace preparation fails,
- validation command fails to start,
- run workspace is missing,
- diff cannot be computed,
- report cannot be written.

Validation failures are not app errors. They are evaluation results.

## Testing Expectations

Automated tests should prove:

- fixtures and scenarios can be listed,
- paired workspaces are created from the same source state,
- workspace reset does not mutate the fixture,
- validation command results are captured as data,
- report generation includes both baseline and skill-assisted run metadata,
- missing fixture/scenario/run paths produce clear errors,
- generated reports are written under the configured evaluation report folder.

Use fake completed run workspaces in tests. Do not require real Codex runs in
automated tests.

## Likely Files

Likely backend additions:

- `skill-manager/electron/skill-evaluation-service.js`
- `skill-manager/electron/skill-evaluation-fixtures.js`
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
- `skill-manager/evaluations/scenarios/typescript-coding/`
- `skill-manager/evaluations/runs/`
- `skill-manager/evaluations/reports/`

## Open Questions

1. Should app-generated runs/reports live inside the repo under
   `skill-manager/evaluations/`, or under Electron user data with only fixtures
   and scenario definitions in the repo?
2. Which new domain concept should the first domain-modeling scenario use?
3. Should the first codebase fixture include Electron shell code, or only the
   domain/app/adapters layers needed for realistic TypeScript evaluation?
4. Should validation commands run inside the app, or should v1 only record
   command output supplied by the user after running commands manually?
