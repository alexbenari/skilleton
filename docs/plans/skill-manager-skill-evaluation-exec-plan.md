# Implement Guidance Evaluation In Skill Manager

## Why this matters

The user maintains coding guidance for agents in three forms: skills under the
active skill library, project instruction files (`CLAUDE.md`, `AGENTS.md`), and
referenced design documents such as `coding-quality.md`. Today there is no way
to know whether any of it improves the code an agent produces. This feature
adds an evaluation capability to the Electron skill manager: it runs the same
task twice under two configurations that differ in exactly one factor — a
piece of guidance, an agent CLI, a model, or a reasoning effort — collects
evidence from both runs, and lets the user or an evaluation model compare the
outputs blind. The user's near-term goal is to decide between two versions of
`coding-quality.md`, then which coding skills earn their place, then whether
one consolidated guidelines document can replace them, and on which model and
effort the result is best.

The governing spec is `docs/specs/skill-manager-skill-evaluation-spec.md`
(signed off 2026-09-20). This plan turns it into milestones. Where the spec
leaves an implementation choice open, this plan records the choice in the
Decision Log.

## Progress

- [x] (2026-09-20 00:00Z) Spec signed off in
  `docs/specs/skill-manager-skill-evaluation-spec.md`.
- [x] (2026-09-20) Milestone 1 - catalog, definition model, and store. 38 new
  tests pass; a four-mutation check confirms they fail for the right reason.
- [x] (2026-09-20) Milestone 3 - workspace preparation, isolation checks, and
  subject activation. 27 tests pass; four mutations confirmed the guards.
- [x] (2026-09-20) Milestone 2 - Agent CLI spike. Findings in
  `docs/plans/spike-findings.md`; the load-bearing ones re-verified directly
  and recorded below.
- [x] (2026-09-20) Milestone 5 - evidence, check runner, cost, arm results.
- [ ] Milestone 4 - adapters written; tests pending.

- [ ] Milestone 6 - Comparison: compatibility, blinding, reviewers, report.
- [ ] Milestone 7 - IPC and UI evaluation panel.
- [ ] Milestone 8 - First fixtures and scenarios, end-to-end run, docs update.

## Skill Gates

Planning-time gates:

- `docs/agent-docs/agent-architecture-map.md`: required repository entrypoint;
  read before drafting. It fixes the layering this plan extends: `main.js`
  wires IPC, `active-skill-library.js` orchestrates, domain modules own one
  concern each, `tests/unit` versus `tests/integration` by scope.
- `coding-quality.md`: repository source of truth for boundaries, naming,
  cohesion, and comment rules. Applied to the module split and interface
  shapes recorded below.
- `domain-modeling` (`.agents/skills/domain-modeling/SKILL.md`): applied when
  naming the new concepts (arm configuration, guidance set, subject, scenario,
  target, arm result, comparison, verdict) and deciding where their state lives.
- `api-and-interface-design` (`.agents/skills/api-and-interface-design/SKILL.md`):
  applied to the agent runner boundary, the check-script result contract, the
  run-manifest contract, and the new IPC channel shapes.
- `testing-discipline` (`.agents/skills/testing-discipline/SKILL.md`): applied
  to the unit/integration split and the fake-runner strategy.
- `build-deploy-and-tooling` (`.agents/skills/build-deploy-and-tooling/SKILL.md`):
  applied to the decisions not to add dependencies, to configure CLI paths
  through the environment and app config, and to add a headless script.

Execution-time gates:

- `writing-clean-code` (`.agents/skills/writing-clean-code/SKILL.md`): before
  implementing each module in Milestones 1, 3, 4, 5, 6.
- `domain-modeling`: before writing `evaluation-definition.js` and
  `evaluation-catalog.js` types in Milestone 1.
- `api-and-interface-design`: before finalizing the runner interface
  (Milestone 4), check contract (Milestone 5), IPC channels (Milestone 7).
- `error-and-correctness-traps` (`.agents/skills/error-and-correctness-traps/SKILL.md`):
  before process spawning, timeouts, cancellation, temp-directory lifecycle,
  and transcript parsing in Milestones 2, 3, 4.
- `testing-discipline`: before writing any test file in every milestone.
- `build-deploy-and-tooling`: before touching `package.json`, adding the
  headless script, or any decision to add a dependency.
- `doc-update` (`.agents/skills/doc-update/SKILL.md`): in Milestone 8, to
  update `docs/agent-docs/agent-architecture-map.md` for the new subsystem.
- `pre-commit-self-review` (`.agents/skills/pre-commit-self-review/SKILL.md`):
  before declaring each milestone complete.

Unavailable skills or fallbacks:

- All repository skills above live under `.agents/skills/`, which is the Codex
  project skill root. When this plan is executed from Claude Code they are not
  exposed as harness skills. Fallback: read each `SKILL.md` directly at the
  gate and run its checklist; this is how the planning gates were satisfied.
  When executed from Codex CLI they load natively.
- `doc-alignment` is not needed for this work.

## Surprises & Discoveries

- Discovery: Codex has a native skill loader. `~/.codex/skills/` is populated
  on the user's machine and `skill-manager/electron/skill-installer.js:19`
  installs into `$CODEX_HOME/skills`; project skills go to `.agents/skills/`.
  Evidence: directory listing and installer source, 2026-09-18.

- Discovery: Claude Code reads `CLAUDE.md` from the working directory and
  every ancestor directory; Codex reads `AGENTS.md` from the Git root down to
  the working directory, 32 KiB combined budget. A workspace under this repo
  inherits this repo's instruction files in both arms.
  Evidence: Claude memory docs and Codex `AGENTS.md` docs, fetched 2026-09-18;
  recorded in the spec's "Instruction-file delivery".

- Discovery: `~/.codex/AGENTS.md` on the user's machine is a copy of this
  repository's `AGENTS.md`. Any Codex run that inherits the user's home carries
  this repo's guidance.
  Evidence: `head ~/.codex/AGENTS.md`, 2026-09-18.

- Discovery: Both CLIs are installed but outside PATH. Claude Code CLI is at
  `C:\Users\alexb\AppData\Roaming\Claude\claude-code\2.1.275\claude.exe`;
  Codex CLI is at
  `C:\Users\alexb\AppData\Local\OpenAI\Codex\bin\247581e40ee272fb\codex.exe`.
  The Claude path carries a version number, so it moves on upgrade and must be
  configurable rather than pinned.
  Evidence: `Get-Process claude | Select Path` and a search of
  `%LOCALAPPDATA%\OpenAI`, 2026-09-20.

- Discovery: Non-interactive flags exist for both CLIs. Claude:
  `claude -p --output-format json|stream-json --model <m> --effort
  low|medium|high|xhigh|max --permission-mode <mode> --max-turns <n>
  --max-budget-usd <n>`, with `CLAUDE_CONFIG_DIR` relocating the config
  directory. Codex: `codex exec [PROMPT|-] --model <m> -c
  model_reasoning_effort=<e> --sandbox read-only|workspace-write
  --ask-for-approval never --cd <dir> --json --output-last-message <file>
  --skip-git-repo-check`, with `CODEX_HOME` relocating the home. Whether
  `codex exec --json` reports token usage is not confirmed by the reference.
  Evidence: `code.claude.com/docs/en/cli-reference` and
  `learn.chatgpt.com/docs/developer-commands?surface=cli`, fetched 2026-09-20.

- Discovery: Neither `claude` nor `codex` is on `PATH` in the shells this plan
  was drafted from, although both are installed for the user. CLI paths must
  be configurable.
  Evidence: `Get-Command claude`, `Get-Command codex` on 2026-09-18.

- Discovery: A subagent told to follow `testing-discipline` will run that
  skill's "test the test" step by mutating the module under test and restoring
  it. Mid-cycle the working tree legitimately holds a deliberately broken
  module, which looks like sabotage from outside. Verify against the agent's
  backups before intervening; stopping it mid-cycle is what risks leaving a
  mutation in place.
  Evidence: this plan's Milestone 1 execution on 2026-09-20. The agent kept
  byte-exact backups and every live module matched them after the stop.

- Discovery: `skill-manager/package.json` has one dependency (`electron`) and
  no test script; tests run with `node --test tests/unit/*.test.js` and
  `node --test tests/integration/*.test.js`.
  Evidence: `package.json` and `docs/agent-docs/agent-architecture-map.md`.

## Spike outcomes (Milestone 2)

Every claim below was re-verified directly rather than taken from the spike
agent's report.

- **Claude cannot be spawned with credentials.** There is no
  `~/.claude/.credentials.json`, no `ANTHROPIC_API_KEY`, and no Credential
  Manager entry; the desktop app holds auth for its in-process SDK. A spawned
  `claude.exe` returns "Not logged in" in about 1.4 seconds. The CLI itself
  works: `claude.exe --version` reports 2.1.275.
- **Codex ambient skills cannot be isolated.** With `CODEX_HOME`, `USERPROFILE`
  and `HOME` all relocated and `--ignore-user-config` passed, a run still
  listed the user's global skills. `~/.agents/skills` holds 41 and
  `~/.codex/skills` holds 34. No `skills.*` config key exists: five plausible
  keys were rejected by `--strict-config`. The global `AGENTS.md` IS removed by
  relocating `CODEX_HOME`.
- **Skill libraries are directories of symbolic links.** 33 of the 34 entries
  under `~/.codex/skills` are links. Node's `readdirSync(withFileTypes)`
  reports a link as a link, so `entry.isDirectory()` is false and a naive scan
  saw 1 skill instead of 34. This silently defeated the ambient-collision check
  until `evaluation-fs.js` was added.
- **`codex exec` has no `--ask-for-approval`** in 0.155.0-alpha.9.2; passing it
  is a hard arg-parse error. It does have `--ignore-user-config`,
  `--ephemeral`, `--worktree` and `--dangerously-bypass-approvals-and-sandbox`.
- **`codex exec` exits 0 even when its tooling failed** and the model answered
  from nothing. Exit code alone is not a success signal; a `turn.completed`
  event is.
- **The Codex Windows sandbox is broken on this machine**, failing with
  `CreateProcessWithLogonW failed: 1385` under the user's own `CODEX_HOME`, so
  it is not caused by relocation. Secondary Logon is running, so this is a
  user-rights policy rather than a stopped service.
- **Model and reasoning effort appear only in the rollout file**, at
  `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`, as `type:"turn_context"`
  with `payload.model` and `payload.effort`. Stdout carries token usage only,
  under `turn.completed` → `usage.*`. Codex reports no cost anywhere.
- **Codex emits no event identifying a skill load or file read**, so skill
  activation is generally `undetermined` there. Claude's `tool_use` events do
  name the tool, so the same signal is real on that side. The three-state
  activation signal is what makes this reportable rather than a false negative.
- **A bad `ANTHROPIC_API_KEY` makes Claude hang silently** rather than fail
  fast, so the adapter's own timeout is load-bearing.

## Decision Log

- Decision: Build both adapters; the user will run `/login` against the
  standalone Claude CLI to create a credential store.
  Rationale: The user chose this over a Codex-only v1. Until they do, a Claude
  run fails with reason `not-logged-in`, which the adapter reports explicitly
  rather than as a generic failure.
  Date/Author: 2026-09-20 / user

- Decision: Refuse an evaluation whose skill subject is also installed in an
  ambient skill root, and record the ambient skills in every run and report.
  Rationale: The ambient skills cannot be removed, but they are a constant
  across both arms, so the comparison stays valid. What is not valid is an
  `absent` baseline against a globally installed subject, and that failure
  would produce a normal-looking report. Refusing is the only safe option.
  Chosen by the user over a pre-run relocation step, which would touch their
  real configuration and leave it moved if a run crashed.
  Date/Author: 2026-09-20 / user

- Decision: Run task arms with `--dangerously-bypass-approvals-and-sandbox` in
  an isolated temp workspace; review arms keep `--sandbox read-only`.
  Rationale: The Windows sandbox fails on this machine regardless of
  relocation, and fixing it means changing a user-rights policy. The user
  accepted running unsandboxed. The temp workspace scopes intent, not
  permission, and that limitation is recorded rather than implied.
  Date/Author: 2026-09-20 / user

- Decision: Add `evaluation-fs.js` and route every filesystem enumeration
  through it.
  Rationale: Skill libraries are directories of symlinks. Five call sites used
  `entry.isDirectory()` and would have seen nothing: the ambient-collision
  check, catalog target and scenario discovery, directory fingerprinting, and
  store listings. Skill installation also switched to `dereference: true` so a
  linked skill lands in the workspace as real files.
  Date/Author: 2026-09-20 / Claude

- Decision: Persist evaluation definitions, arm results, comparisons, and
  reports as files under an evaluation root, not in SQLite.
  Rationale: `domain-modeling` decision 5 — the data is persistent but small
  and only lightly interconnected (comparisons reference arm results by id),
  so one of three database triggers applies. Files are human-inspectable and
  match the spec's "copy results back" option. Default root is
  `path.join(app.getPath("userData"), "evaluations")`, overridable by
  `SKILL_MANAGER_EVALUATION_ROOT` for tests and scripts, mirroring
  `SKILL_MANAGER_DB_PATH`.
  Date/Author: 2026-09-20 / Claude + user

- Decision: Execute run workspaces under `app.getPath("temp")`, never under
  the repository, and copy retained results into the evaluation root.
  Rationale: Spec "Run context isolation"; both agents would inherit the
  repo's instruction files otherwise. Same temp-root pattern as
  `skill-repository-importer.js`.
  Date/Author: 2026-09-20 / Claude + user

- Decision: Isolate agent homes by relocating them: `CLAUDE_CONFIG_DIR` for
  Claude, `CODEX_HOME` for Codex, each pointing at a per-evaluation directory
  that contains only copied credentials and a minimal config. Milestone 2
  verifies this works; if credentials cannot be relocated, fall back to
  inheriting the user's home with the leak recorded, per the spec's explicit
  inherit mode.
  Rationale: Relocation is the only mechanism that removes user-global skills,
  rules, instruction files, plugins, and MCP servers at once.
  Date/Author: 2026-09-20 / Claude

- Decision: Unify validators and behavioral checks under one **check**
  contract: a scenario-owned command run in the arm workspace that prints a
  JSON result. Two kinds (`validator`, `behavioral`) are kept as a field.
  Rationale: `api-and-interface-design` decisions 3 and 4 — one contract with
  one reason to change; the app never learns document formats or test
  frameworks. A check may reference the arm's run manifest (`manifest:test`)
  instead of a literal command.
  Date/Author: 2026-09-20 / Claude

- Decision: Each generative run must leave `run-manifest.json` at the
  workspace root declaring shell and install/build/test/run commands.
  Rationale: Spec "Scenario"; the stack is open, so the app cannot know how to
  build the output.
  Date/Author: 2026-09-20 / Claude + user

- Decision: Invoke the evaluation model through the same agent runner
  boundary as task runs, with a read-only role.
  Rationale: One process-launching path to test and secure; the reviewer is a
  Claude or Codex run with a different sandbox and prompt.
  Date/Author: 2026-09-20 / Claude

- Decision: Add a headless script `skill-manager/scripts/evaluate.js` that
  drives the service from the command line.
  Rationale: `build-deploy-and-tooling` decision 11 — the loop will be run
  many times while the UI is unfinished; a script makes every milestone
  observable without Electron and doubles as the smoke test.
  Date/Author: 2026-09-20 / Claude

- Decision: Select agent adapters through a registry keyed by agent id, not a
  `switch` on the agent name in the service.
  Rationale: `api-and-interface-design` decision 9 and `coding-quality.md`
  "capability-based polymorphism over branching on kind".
  Date/Author: 2026-09-20 / Claude

- Decision: Configure CLI executable paths in `AppConfig`
  (`evaluation.codexCliPath`, `evaluation.claudeCliPath`) with environment
  overrides `SKILL_MANAGER_CODEX_CLI` and `SKILL_MANAGER_CLAUDE_CLI`.
  Rationale: Neither CLI is reliably on `PATH`; `AppConfig` already owns app
  preference state.
  Date/Author: 2026-09-20 / Claude

- Decision: Scenario front matter is JSON, not YAML, fenced by `---` lines
  inside the scenario `.md`.
  Rationale: The scenario shape nests lists of objects (`checks`,
  `review.dimensions`), and the plan's original "small hand-written key/value
  and list reader" would be a YAML subset parser with its own bug surface for
  no gain. `JSON.parse` on the fenced block is unambiguous and still leaves the
  prompt as readable Markdown. Deviation from this plan's Milestone 1 text,
  recorded here as PLANS.md requires.
  Date/Author: 2026-09-20 / Claude

- Decision: Split the single "evaluation root" into a catalog root and a store
  root, resolved by `electron/evaluation-paths.js`.
  Rationale: The two have opposite lifecycles. Fixtures, scenarios, and
  subjects are checked in and read-only at run time; definitions, arm results,
  comparisons, and reports are generated and must stay out of the repository.
  One module owns both resolutions plus the CLI path overrides, so Electron
  and the command line cannot drift.
  Date/Author: 2026-09-20 / Claude

- Decision: Add no new npm dependencies for v1. Scenario check scripts that
  need to read `.docx` files own that choice inside the fixture.
  Rationale: `build-deploy-and-tooling` decision 5; keeps the app agnostic to
  output formats.
  Date/Author: 2026-09-20 / Claude

## Outcomes & Retrospective

Not started.

## Context and orientation

This work lives inside the Electron skill manager under `skill-manager/`.

Existing modules the plan builds on:

- `skill-manager/electron/main.js`: constructs backend objects at
  `app.whenReady()` and registers `ipcMain.handle("skill-manager:<op>")`
  handlers. New evaluation channels are registered here with the prefix
  `skill-manager:evaluation-`.
- `skill-manager/electron/preload.js`: exposes `window.skillManager` with one
  method per channel. Every new channel gets a mirrored method.
- `skill-manager/electron/active-skill-library.js`: orchestration for the
  selected skill library. The evaluation service reads cataloged skills through
  it (`getActiveLibrary`, skill rows) but is a separate capability.
- `skill-manager/electron/skill-installer.js`: knows the Codex skill roots
  (`$CODEX_HOME/skills`, `<project>/.agents/skills/<name>`) and copies skill
  directories. Subject activation for skills reuses its copy logic.
- `skill-manager/electron/app-config.js`: JSON preference file under user data
  with atomic write. Extended with CLI paths.
- `skill-manager/ui/renderer.js` and `skill-manager/ui/index.html`: a single
  IIFE that owns UI state and rendering, plus a side panel and modals. The
  evaluation UI is a new section with its own script file.
- `skill-manager/tests/unit/` and `tests/integration/`: `node:test` with
  `node:assert/strict`; integration tests use real temp directories under
  `os.tmpdir()`.

Terms used below, all defined in the spec:

- **Subject**: guidance under test — a `skill`, an `instruction-file`, or a
  `referenced-document` reached through a pointer in an instruction file.
- **Guidance set**: every subject in force for one arm, each with a content
  fingerprint.
- **Arm configuration**: agent CLI + execution model + reasoning effort +
  guidance set.
- **Varied factor**: the one thing that differs between the two arms:
  `guidance`, `agent`, `model`, or `effort`.
- **Guidance difference mode**: for a `guidance` factor, `absent`,
  `prior-version`, or `alternative-configuration`.
- **Target** and **scenario**: the starting files and the task prompt with its
  checks; a target is `extension` (diffed) or `generative` (whole output).
- **Arm result**: the persisted output of running one arm configuration on
  one target and scenario, including every repetition.
- **Comparison**: two arm results, a review, and a report.

Acceptance behavior for the whole plan:

From the app, the user selects a varied factor, two arm configurations, a
target and scenario, a reviewer role, and repetition count; approves the
proposed evaluation plan; starts the evaluation; watches both arms run; and
receives a blinded side-by-side review harness or a model review, then a
Markdown report stating the verdict, sample size, activation records, cost
record, and every configuration detail. The same flow runs headless from
`node scripts/evaluate.js`.

## Milestone 1 - Catalog, definition model, and store

### Scope

Load targets and scenarios from the repository, model arm configurations and
evaluation definitions as immutable values with fingerprints, validate the
one-varied-factor rule, and persist versioned definitions under the evaluation
root. No agent runs yet.

### Changes

- File: `skill-manager/evaluations/README.md`
  Edit: Create. Document the folder layout (`fixtures/<target>/`,
  `scenarios/<target>/<name>.md`, `subjects/`) and the two file formats below.

- Target format: `skill-manager/evaluations/fixtures/<target>/target.json`
  with `{ "id", "shape": "extension"|"generative", "description" }`, a
  `content/` directory holding the snapshot files, and an optional `checks/`
  directory holding check scripts.

- Scenario format: `skill-manager/evaluations/scenarios/<target>/<name>.md`
  with YAML front matter and the prompt as body. Front matter fields: `id`,
  `target`, `pins` (free-form map, e.g. `language`), `requiresRunManifest`
  (boolean), `checks` (list of `{ id, kind: validator|behavioral, command,
  timeoutSeconds }` where `command` is a literal or `manifest:install|build|
  test`), `review.dimensions` (list of strings), `review.guidance` (string).

- File: `skill-manager/electron/evaluation-catalog.js`
  Edit: Create `EvaluationCatalog` with `listTargets()`, `listScenarios()`,
  `getTarget(id)`, `getScenario(id)`. Parse front matter into a typed
  `Scenario` value; reject malformed files with `EvaluationCatalogError`
  naming the file and field. The parser is a small hand-written key/value and
  list reader sufficient for the fields above — no YAML dependency.

- File: `skill-manager/electron/evaluation-definition.js`
  Edit: Create the pure domain module. Values: `Subject` (kind, sourcePath,
  fingerprint, pointer for `referenced-document`), `GuidanceSet` (ordered
  subjects, set fingerprint), `ArmConfiguration` (agent, model, effort,
  guidanceSet), `EvaluationDefinition` (id, version, variedFactor,
  guidanceDifferenceMode, arms {reference, candidate}, targetId, scenarioId,
  evaluationModel, reviewerRole, decisionFraming, repetitionCount, rubric,
  checks, fingerprints). Functions: `fingerprintFile(path)`,
  `fingerprintDirectory(path)` (sha256 over sorted relative paths and
  contents), `variedFactorBetween(armA, armB)` returning exactly one factor or
  throwing `EvaluationDefinitionError` listing every differing field, and
  `nextVersion(previous, changes)`.

- File: `skill-manager/electron/evaluation-store.js`
  Edit: Create `EvaluationStore({ rootPath, fileSystem })` with
  `saveDefinition(definition)` → `definitions/<id>/v<N>.json`,
  `loadDefinition(id, version)`, `listDefinitions()`, and the arm-result and
  comparison methods stubbed for Milestone 5 and 6. Writes are atomic via
  temp-file rename, as in `app-config.js`.

- File: `skill-manager/electron/app-config.js`
  Edit: Extend the schema with `evaluation: { codexCliPath, claudeCliPath }`
  preserving existing behavior for files that lack the key.

- File: `skill-manager/scripts/evaluate.js`
  Edit: Create with two commands: `list` (prints targets and scenarios) and
  `define <options>` (builds and saves a definition, printing its path and the
  detected varied factor). Reads the evaluation root from
  `SKILL_MANAGER_EVALUATION_ROOT` or a `--root` argument.

- File: `skill-manager/tests/unit/evaluation-definition.test.js`
  Edit: Cases named by scenario: two arms differing only in effort yield
  `effort`; arms differing in model and effort are rejected with both fields
  named; identical arms are rejected; `prior-version` requires two
  fingerprints; a `referenced-document` without a pointer is rejected.

- File: `skill-manager/tests/integration/evaluation-catalog.test.js`
  Edit: Load a temp fixture tree; malformed front matter names the file;
  `manifest:test` commands parse to a manifest reference.

- File: `skill-manager/tests/integration/evaluation-store.test.js`
  Edit: Save v1, save a changed definition as v2, load both, list.

### Validation

- Command: `cd skill-manager && node --test tests/unit/*.test.js`
  Expected: new definition tests pass alongside existing unit tests.

- Command: `cd skill-manager && node --test tests/integration/*.test.js`
  Expected: catalog and store tests pass; existing integration tests
  unaffected.

- Command: `cd skill-manager && node scripts/evaluate.js list`
  Expected: prints the checked-in targets and scenarios (Milestone 8 adds real
  ones; until then an empty list with no error).

### Rollback/Containment

All files are new except `app-config.js`. Revert the `app-config.js` schema
change together with its test if the extended shape causes trouble; existing
behavior must not change for configs without the `evaluation` key.

## Milestone 2 - Agent CLI spike

### Scope

A throwaway experiment, not production code, that answers the questions the
adapters depend on. Nothing from this milestone ships except the recorded
answers.

### Hypotheses and pass/fail signals

1. Hypothesis: `claude -p` runs with `CLAUDE_CONFIG_DIR` pointing at a fresh
   directory containing only a copied `.credentials.json`.
   Run: create the directory, copy the credentials file from `~/.claude`, run
   `claude -p --output-format json --permission-mode bypassPermissions "list
   the files in this directory"` in an empty temp workspace.
   Pass: a JSON result with an assistant message. Fail: an auth prompt or
   error. Informs: relocation versus inherit-home fallback.
2. Hypothesis: With the relocated home, a user-global skill from
   `~/.claude/skills/` is not visible to the run.
   Run: prompt "which skills are available to you? list their names".
   Pass: none of the user's global skill names appear. Informs: whether
   relocation alone isolates skills.
3. Hypothesis: `codex exec` runs with `CODEX_HOME` pointing at a fresh
   directory containing only a copied `auth.json`, with `--skip-git-repo-check
   --sandbox workspace-write --ask-for-approval never --json`.
   Pass and fail as in 1. Also check whether a minimal `config.toml` is
   required.
4. Hypothesis: With the relocated Codex home, `~/.codex/AGENTS.md` and
   `~/.codex/skills/` are not visible.
   Run: prompt "what project instructions and skills do you have?".
   Pass: no repository instructions and no global skill names. Informs:
   isolation for Codex.
5. Hypothesis: Both CLIs report the model used, and Claude reports effort and
   usage/cost, in their JSON output.
   Run: inspect the JSON from 1 and 3 with `--model` and effort set.
   Pass: fields identified and recorded in Surprises & Discoveries with their
   exact names. Fail: effort marked "as-requested, unconfirmed" in the adapter.
6. Hypothesis: A skill installed at `<workspace>/.claude/skills/<name>/` and
   `<workspace>/.agents/skills/<name>/` is loadable by the respective CLI, and
   its invocation is visible in the transcript.
   Run: install a trivial skill whose body says "reply with the word
   ACTIVATED"; prompt something that should trigger it.
   Pass: the reply contains the word and the transcript shows the skill load.
   Informs: activation-signal extraction.
7. Hypothesis: A read-only reviewer run is possible: `--sandbox read-only`
   for Codex, `--permission-mode plan` for Claude, with a prompt that asks for
   a JSON verdict in a fenced block.
   Pass: the output contains parseable JSON and no files changed.

### Changes

- File: `skill-manager/scripts/spike/agent-cli-spike.js`
  Edit: Create a script that runs the seven experiments given CLI paths and
  prints a summary table. Delete or archive it at the end of Milestone 4.

- File: this plan
  Edit: Record each experiment's outcome under Surprises & Discoveries and any
  changed choice under Decision Log before starting Milestone 3.

### Validation

- Command: `cd skill-manager && node scripts/spike/agent-cli-spike.js
  --claude <path> --codex <path>`
  Expected: seven rows, each pass or fail with the observed output snippet.

### Rollback/Containment

The spike touches only temp directories and its own script. If credential
relocation fails for a CLI, the adapter for that CLI will use the inherit-home
mode and mark isolation as partial in every run record; the spec permits this
when recorded.

## Milestone 3 - Workspace preparation, isolation checks, and subject activation

### Scope

Create an isolated workspace from a target snapshot, refuse workspaces with
instruction-file ancestry, materialize a guidance set for a given agent, and
record exactly which files activation wrote.

### Changes

- File: `skill-manager/electron/evaluation-workspace.js`
  Edit: Create `EvaluationWorkspace` with `prepare({ target, arm, tempRoot })`
  that copies `fixtures/<target>/content/` into
  `<tempRoot>/skill-manager/evaluation-<id>/<arm-role>/workspace/`, runs
  `git init` when the agent is Codex so the workspace is its own discovery
  root, and returns a `PreparedWorkspace` value with `path`, `homePath`, and
  `activationArtifacts` (relative paths written by activation).
  `assertNoInstructionAncestry(path)` walks parent directories and fails with
  `EvaluationWorkspaceError` naming the offending file for any of `CLAUDE.md`,
  `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `AGENTS.override.md`,
  or an enclosing Git root carrying one. `assertNoFixtureCollision(target)`
  rejects fixtures containing those files or `.claude/rules/` unless the
  scenario declares the collision.

- File: `skill-manager/electron/evaluation-activation.js`
  Edit: Create per-agent activation as two small objects with the same shape,
  `ClaudeActivation` and `CodexActivation`, each with
  `activate(workspacePath, guidanceSet)`. Skill → copy into
  `.claude/skills/<name>/` or `.agents/skills/<name>/` (reuse the copy routine
  from `skill-installer.js`, extracted to a shared helper if needed).
  Instruction file → write `CLAUDE.md` or `AGENTS.md`. Referenced document →
  write the document at its declared workspace path and write the pointer
  instruction file. In `absent` mode for a referenced document, write neither.
  Return the list of written relative paths. Each object also exposes
  `instructionBudgetBytes()` (Codex 32 KiB, Claude 4 MiB) so the service can
  flag truncation before running.

- File: `skill-manager/electron/evaluation-home.js`
  Edit: Create `IsolatedAgentHome` with `create(agent, evaluationId)` that
  builds the per-agent directory Milestone 2 validated (copied credentials,
  minimal config) and returns `{ path, envVarName, isolation: "isolated" |
  "inherited" }`.

- File: `skill-manager/tests/integration/evaluation-workspace.test.js`
  Edit: Prepared workspace contains the fixture files; a temp parent holding
  `CLAUDE.md` is rejected naming that path; a fixture with
  `AGENTS.override.md` is rejected; the Codex workspace has its own `.git`.

- File: `skill-manager/tests/integration/evaluation-activation.test.js`
  Edit: A skill lands at the Claude root on Claude and the Codex root on
  Codex; an instruction file is written as `CLAUDE.md` on one and `AGENTS.md`
  on the other, byte-identical content; a referenced document writes document
  plus pointer, and `absent` writes neither; the returned artifact list matches
  what is on disk; an instruction file over 32 KiB is flagged for Codex only.

### Validation

- Command: `cd skill-manager && node --test tests/integration/*.test.js`
  Expected: workspace and activation tests pass.

### Rollback/Containment

New files only. If activation for one agent is wrong, the other agent's path
stays usable; the service refuses to start an evaluation whose activation
threw.

## Milestone 4 - Agent runner boundary, fake runner, and real adapters

### Scope

One interface for launching and supervising a run, a fake implementation for
tests, and Codex and Claude adapters that turn the spike's findings into
production code with timeout, cancellation, transcript capture, and activation
signals.

### Changes

- File: `skill-manager/electron/evaluation-agent-runner.js`
  Edit: Create `AgentRunner({ adapters })` where `adapters` is a map from agent
  id to adapter. Method `run(request)` with `request = { role: "task" |
  "review", arm, workspacePath, home, prompt, timeoutMs, signal, onEvent }`
  returns a `RunRecord`: `{ status: "completed" | "failed" | "timed-out" |
  "canceled", exitCode, startedAt, endedAt, transcriptPath, lastMessage,
  modelReported, effortRequested, effortReported, usage, activationSignals,
  agentVersion }`. Unknown agent id fails with `AgentRunnerError` before
  spawning. Export `FakeAgentRunner` from
  `skill-manager/tests/helpers/fake-agent-runner.js` that returns scripted
  records and optionally writes files into the workspace to simulate output.

- File: `skill-manager/electron/evaluation-agent-codex.js`
  Edit: Create `CodexAgentAdapter({ cliPath, spawn })`. Builds `codex exec -
  --json --skip-git-repo-check --cd <workspace> --model <m> -c
  model_reasoning_effort=<e> --output-last-message <file>` plus `--sandbox
  workspace-write --ask-for-approval never` for `task` and `--sandbox
  read-only` for `review`; sets `CODEX_HOME` from `home.path`; pipes the
  prompt on stdin; streams newline-delimited JSON to the transcript file and to
  `onEvent`; on exit reads the last message; extracts model, effort (if
  reported), usage (if reported), and activation signals by scanning events
  for skill loads and file reads of the guidance set paths, returning
  `undetermined` when the event stream carries no tool detail; reads
  `codex --version` once for `agentVersion`.

- File: `skill-manager/electron/evaluation-agent-claude.js`
  Edit: Create `ClaudeAgentAdapter({ cliPath, spawn })`. Builds `claude -p
  --output-format stream-json --model <m> --effort <e> --max-turns <n>
  --max-budget-usd <cap>` plus `--permission-mode bypassPermissions` for
  `task` and `--permission-mode plan` for `review`; sets `CLAUDE_CONFIG_DIR`;
  cwd is the workspace; same transcript, event, extraction, and version
  handling as Codex, with activation signals from `Skill` tool uses and
  `Read` tool uses of guidance paths.

- Shared behavior in both adapters, factored only if it is genuinely identical
  after both exist: timeout kills the process tree and records `timed-out`;
  `signal.abort()` records `canceled`; a non-zero exit records `failed` with
  stderr tail; partial transcript is kept in every case.

- File: `skill-manager/scripts/evaluate.js`
  Edit: Add `run-arm <definition> <reference|candidate>` that prepares a
  workspace and runs one arm once, printing the run record path. This is the
  first real end-to-end observable.

- File: `skill-manager/tests/unit/evaluation-agent-runner.test.js`
  Edit: Unknown agent fails before spawn; adapter chosen by arm agent id;
  events forwarded; abort produces `canceled`.

- File: `skill-manager/tests/unit/evaluation-agent-adapters.test.js`
  Edit: With a stubbed `spawn`, assert the exact argument vectors for task and
  review roles on both adapters; the environment variable set; the transcript
  written; extraction of model/effort/usage from recorded sample events
  captured during the spike; `undetermined` when tool events are absent;
  timeout and non-zero exit produce the right statuses.

### Validation

- Command: `cd skill-manager && node --test tests/unit/*.test.js`
  Expected: runner and adapter tests pass without spawning real CLIs.

- Command: `cd skill-manager && node scripts/evaluate.js run-arm <def>
  reference`
  Expected: with real CLI paths configured, a run record with status
  `completed`, a transcript file, and output files in the workspace. With a
  bad CLI path, a clear `AgentRunnerError` and no partial state.

### Rollback/Containment

Adapters are independent; a broken adapter disables that agent only. The
fake runner keeps every later milestone testable regardless.

## Milestone 5 - Evidence: inventory, check runner, cost record, arm results

### Scope

After a run, describe what it produced, run the scenario's checks against it
through its run manifest, record cost, and persist the arm result with all
repetitions.

### Changes

- File: `skill-manager/electron/evaluation-evidence.js`
  Edit: Create `describeWorkspace(prepared, target)` returning an
  `ArtifactInventory` for generative targets (files with sizes and roles
  inferred from extension and path, entry points, test files, declared
  dependencies read from common manifests, total size) or a `ChangeDescription`
  for extension targets (added/modified/deleted relative to the snapshot). Both
  exclude `activationArtifacts`. Create `readRunManifest(workspacePath)` that
  parses `run-manifest.json` into a `RunManifest` value or returns a
  `missing`/`invalid` result as run evidence, not an exception.

- File: `skill-manager/electron/evaluation-check-runner.js`
  Edit: Create `CheckRunner({ spawn })` with `runAll(checks, workspace,
  manifest)`. A check command is either literal or `manifest:<step>`; the
  latter resolves through the manifest and yields `status: "error"` with
  reason `manifest-missing` when there is none. Commands run in the shell the
  manifest declares (`powershell`, `bash`, `cmd`), in the workspace, with the
  check's timeout. The script's stdout is parsed as `{ status: "pass" | "fail"
  | "error", summary, findings: [{ id, message, severity }] }`; non-JSON
  output with a non-zero exit is `error` with the tail of the output.

- File: `skill-manager/electron/evaluation-store.js`
  Edit: Implement `saveArmResult(result)` → `arm-results/<id>/arm.json` with
  `runs/<n>/` holding `run.json`, `transcript.jsonl`, `inventory.json`,
  `checks.json`, `cost.json`, and a copied `workspace/` when retention is
  requested. `loadArmResult(id)`, `listArmResults(filter)`.

- File: `skill-manager/electron/evaluation-cost.js`
  Edit: Create `costRecordFor(subject)` (bytes, approximate tokens as
  bytes/4, delivered bytes for instruction files given the agent budget, read
  fraction for referenced documents from activation signals) and
  `runCost(runRecord)` (duration, usage passthrough).

- File: `skill-manager/scripts/evaluate.js`
  Edit: `run-arm` now also describes the workspace, runs checks, writes cost,
  and saves the arm result, printing the result id.

- File: `skill-manager/tests/integration/evaluation-evidence.test.js`
  Edit: A generative workspace with `src/`, `tests/`, and a package manifest
  yields the expected inventory; activation artifacts are excluded; an
  extension workspace yields the expected added/modified/deleted lists; a
  missing manifest is reported, not thrown.

- File: `skill-manager/tests/integration/evaluation-check-runner.test.js`
  Edit: A check script that prints a pass result passes; one that exits 1
  with JSON `fail` fails with its findings; one that exits 1 without JSON is
  `error`; `manifest:test` resolves the manifest command; a missing manifest
  yields `manifest-missing`; a timeout yields `error` with reason `timeout`.

- File: `skill-manager/tests/integration/evaluation-store.test.js`
  Edit: Add arm-result round trip with two runs and retained workspace copy.

### Validation

- Command: `cd skill-manager && node --test tests/integration/*.test.js`
  Expected: evidence, check-runner, and store tests pass.

- Command: `cd skill-manager && node scripts/evaluate.js run-arm <def>
  candidate --repetitions 2`
  Expected: an arm result with two runs, each with inventory, check results,
  and cost, under the evaluation root.

### Rollback/Containment

New files only. The check runner never mutates the workspace beyond what the
scenario's own scripts do; a failing check is data.

## Milestone 6 - Comparison: compatibility, blinding, reviewers, report

### Scope

Pair two arm results, verify they are comparable, build a blinded review
bundle, obtain a verdict from a model or record one from the user, and write
the Markdown report.

### Changes

- File: `skill-manager/electron/evaluation-comparison.js`
  Edit: Create `assertComparable(armA, armB)` enforcing identical target,
  scenario, rubric, and check fingerprints and exactly one differing factor,
  with `EvaluationComparisonError` naming what differs; flag CLI-version or
  model-identifier drift against the current adapter versions. Create
  `buildReviewBundle(armA, armB, { seed })` that randomly assigns A/B, copies
  inventories, check results, manifests, and retained workspaces into
  `review-bundle/A` and `review-bundle/B`, rewrites paths, redacts agent and
  model names from transcripts and manifests, and records the assignment
  sealed in `assignment.json`. Blinding is recorded as `full` for `guidance`
  factors and `partial` for execution factors.

- File: `skill-manager/electron/evaluation-review.js`
  Edit: Create `ModelReviewer({ runner })` that runs the evaluation model in
  `review` role with the bundle as workspace and a prompt containing the
  rubric dimensions, the fixed verdict set, and the instruction to answer with
  one fenced JSON block `{ dimensions: [{ name, assessment, evidence }],
  recommendation, reasoning, uncertainty }`; parses it; fails with
  `EvaluationReviewError` when no valid block is found. Create
  `UserReviewRecord` with the same shape plus `blinded: true | false` and
  `pairVerdicts` for repetition pairs, validated on save. Under `both`, both
  are stored, never merged. Apply the spec's default: an `agent` or `model`
  comparison whose evaluation model shares a family with either arm defaults
  the reviewer role to `both` and records the family.

- File: `skill-manager/electron/evaluation-report-writer.js`
  Edit: Create `writeReport(comparison, reviews, outputPath)` producing
  Markdown with every item in the spec's "Report Shape", re-attaching labels
  from `assignment.json`, stating sample size next to the recommendation,
  pairing a `non-inferiority` verdict with the cost difference, and never
  printing "equivalent" for an "inconclusive" review.

- File: `skill-manager/electron/evaluation-store.js`
  Edit: `saveComparison`, `loadComparison`, `listComparisons`; report at
  `comparisons/<id>/report.md`.

- File: `skill-manager/scripts/evaluate.js`
  Edit: Add `compare <armResultA> <armResultB> --reviewer model|user|both`
  and `report <comparisonId>`. In `user` mode the script prints the bundle
  path and accepts a verdict JSON file.

- File: `skill-manager/tests/unit/evaluation-comparison.test.js`
  Edit: Two arms differing in effort are comparable; differing in effort and
  model are rejected naming both; mismatched scenario fingerprint rejected;
  drift is flagged; bundle assignment is random but sealed and recoverable;
  bundle text contains no agent or model names for a `guidance` factor.

- File: `skill-manager/tests/unit/evaluation-review.test.js`
  Edit: With the fake runner returning a sample review, the JSON block parses;
  a reply without a block fails clearly; a user record missing a dimension is
  rejected; `both` stores two records.

- File: `skill-manager/tests/unit/evaluation-report-writer.test.js`
  Edit: Report contains the varied factor, both configurations, sample size,
  blinding status, activation records including `undetermined`, cost record,
  and follows the "inconclusive is not equivalent" rule.

### Validation

- Command: `cd skill-manager && node --test tests/unit/*.test.js`
  Expected: comparison, review, and report tests pass.

- Command: `cd skill-manager && node scripts/evaluate.js compare <a> <b>
  --reviewer user` then `report <id>`
  Expected: a blinded bundle on disk, a saved user verdict, and a report whose
  labels match the sealed assignment.

### Rollback/Containment

New files only. A failed model review leaves the bundle and arm results intact
so the user can review manually instead.

## Milestone 7 - IPC and UI evaluation panel

### Scope

Expose the service to the renderer and add an Evaluate section: configure,
approve, run with live status, review, and open the report.

### Changes

- File: `skill-manager/electron/evaluation-service.js`
  Edit: Create `EvaluationService` as the application-orchestration layer
  composing catalog, definition, workspace, activation, home, runner, evidence,
  check runner, store, comparison, review, and report writer. Methods mirror
  the spec's V1 workflow: `listCatalog()`, `proposePlan(input)`,
  `saveDefinition(plan)`, `startEvaluation(definitionId, { reuse })` returning
  an evaluation id and emitting progress events, `cancel(evaluationId)`,
  `submitUserReview(comparisonId, record)`, `reportPath(comparisonId)`. It
  holds no provider-specific logic.

- File: `skill-manager/electron/main.js`
  Edit: Construct `EvaluationService` with the evaluation root, temp root, CLI
  paths from `AppConfig`/environment, and the adapter registry. Register
  channels: `skill-manager:evaluation-list-catalog`,
  `-propose-plan`, `-save-definition`, `-list-definitions`,
  `-list-arm-results`, `-start`, `-cancel`, `-status`, `-submit-user-review`,
  `-open-report`, `-open-workspace`, `-set-cli-paths`. Progress is pushed with
  `mainWindow.webContents.send("skill-manager:evaluation-progress", event)`.

- File: `skill-manager/electron/preload.js`
  Edit: Mirror each channel; add `onEvaluationProgress(callback)` using
  `ipcRenderer.on`.

- File: `skill-manager/ui/index.html`
  Edit: Add an "Evaluate" button to the command shell and an
  `evaluation-panel` section with: factor selector; two arm configuration
  forms (agent, model, effort, guidance set picker fed by the catalog and the
  active library); target/scenario selector; reviewer role, framing,
  repetition count; proposed-plan editor with Approve; run status area with
  per-arm progress and Cancel; review harness with A/B columns, per-dimension
  inputs, overall verdict, Unblind; Open Report. Load
  `ui/evaluation-panel.js`.

- File: `skill-manager/ui/evaluation-panel.js`
  Edit: Create a second IIFE owning evaluation UI state and rendering, using
  `window.skillManager` only. It does not reach into `renderer.js` state; the
  Evaluate button toggles its section.

- File: `skill-manager/tests/unit/evaluation-service.test.js`
  Edit: With fakes for every collaborator, `startEvaluation` runs the
  reference arm, the candidate arm, repetitions, checks, comparison, and
  review in order, emits progress events, honors cancel, refuses a definition
  whose arms differ in two factors, and defaults reviewer role to `both` for
  same-family execution comparisons.

### Validation

- Command: `cd skill-manager && node --check electron/main.js && node --check
  ui/renderer.js && node --check ui/evaluation-panel.js`
  Expected: all parse.

- Command: `cd skill-manager && node --test tests/unit/*.test.js`
  Expected: service tests pass.

- Command: `cd skill-manager && electron .`
  Expected: the Evaluate section opens, the catalog lists targets and
  scenarios, a definition can be approved and saved, and Start with the fake
  runner selected through a dev flag (`SKILL_MANAGER_EVALUATION_FAKE_RUNNER=1`)
  completes both arms and opens the review harness.

### Rollback/Containment

Keep evaluation UI in its own script and section so reverting it leaves the
existing skill UI untouched. IPC channels are additive.

## Milestone 8 - First fixtures and scenarios, end-to-end run, docs update

### Scope

Author the stage 1 and stage 2 document-generator fixtures and scenarios from
the spec, run the first real evaluation end to end with user review, and update
the agent architecture map.

### Changes

- File: `skill-manager/evaluations/fixtures/docgen-requirements/`
  Edit: `target.json` (generative), `content/requirements.md` supplied by the
  user with numbered requirements, `checks/structure.js` (required sections
  present in `docs/specs/*.md` and `docs/plans/*.md`, plan matches `PLANS.md`
  section list) and `checks/traceability.js` (every requirement id appears in
  the plan). Each prints the check JSON contract.

- File: `skill-manager/evaluations/scenarios/docgen-requirements/write-spec-and-plan.md`
  Edit: Front matter pins output locations and requirement numbering; checks
  reference the two scripts as validators; review dimensions: coverage,
  interpretation, ambiguity handling, decomposition and ordering,
  verification, scope. Body is the prompt.

- File: `skill-manager/evaluations/fixtures/docgen-plan/`
  Edit: `target.json` (generative), `content/requirements.md` plus the frozen
  `content/docs/specs/...-spec.md` and `content/docs/plans/...-exec-plan.md`
  chosen by the user, a `prescriptiveness.md` note stating how much structure
  the plan fixes, and `checks/docx-constraints.js` that runs the declared
  invocations through the arm's manifest, opens each produced `.docx` (as a
  zip containing `word/document.xml`; the script chooses its own reading
  approach and documents it), and asserts the requirements' constraints.

- File: `skill-manager/evaluations/scenarios/docgen-plan/implement-plan.md`
  Edit: Pins only implementation language and the CLI contract; requires a
  run manifest; checks: `manifest:install`, `manifest:build`, `manifest:test`
  as validators and `docx-constraints` as behavioral; review dimensions per
  the spec's stage 2 scenario, including stack choice.

- File: `skill-manager/evaluations/subjects/`
  Edit: `coding-quality-v1.md` and `coding-quality-v2.md` snapshots of the
  repository's two versions, plus `pointer-claude.md` and `pointer-codex.md`
  holding the identical pointer text for both agents.

- File: `docs/agent-docs/agent-architecture-map.md`
  Edit: Following `doc-update`, add the evaluation subsystem: module list and
  responsibilities, the evaluation root and temp workspace assumptions, the
  runner boundary and adapter registry, the check contract, the fake runner as
  the test seam, and routing guidance. Add the new verification commands.

- File: this plan
  Edit: Fill Outcomes & Retrospective with evidence from the end-to-end run.

### Validation

- Command: `cd skill-manager && node scripts/evaluate.js list`
  Expected: both docgen targets and scenarios listed.

- Command: `cd skill-manager && node --test tests/unit/*.test.js && node
  --test tests/integration/*.test.js`
  Expected: full suite green.

- Manual, in the app: define a stage 1 evaluation with varied factor
  `guidance`, mode `prior-version`, subject `PLANS.md` or the Planning Flow
  section, agent and model of the user's choice, reviewer `user`, one
  repetition per arm. Start it. Expected: both arms complete, structure and
  traceability checks report, the blinded review harness shows A and B, a
  verdict is saved, the report opens and states sample size 1 per arm, both
  configurations, activation records, and cost.

- Manual, second run: stage 2 with the frozen plan, subject
  `coding-quality.md` v1 versus v2. Expected: manifests are read, build and
  test checks run per arm, `docx-constraints` reports per arm, review and
  report as above with stack choice visible.

### Rollback/Containment

Fixtures and scenarios are data; a wrong check script fails as `error` in the
report without affecting the app. If the end-to-end run exposes an adapter
defect, record it in Surprises & Discoveries, fix it under Milestone 4's
tests, and rerun; do not mark the milestone complete on a partial run.
