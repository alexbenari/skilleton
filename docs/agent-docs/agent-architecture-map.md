# Agent Architecture Map

Last updated: 2026-09-20
Status: canonical agent entrypoint

## Purpose

Use this file first when orienting in this repository. It tells you where to
look and which boundaries are normative.

## Repo map

- `skill-manager/`: Electron app for managing a local skill library.
- `docs/specs/` and `docs/plans/`: historical feature documents, useful for
  rationale but not the primary architecture source.
- `docs/agent-docs/`: agent-facing architecture knowledge base. This file is
  the entrypoint.

## Current architecture

### Skill manager

Start here for current production behavior:

- `skill-manager/electron/main.js` wires Electron IPC to the backend module.
- `skill-manager/electron/preload.js` exposes the renderer bridge.
- `skill-manager/electron/active-skill-library.js` is the application
  orchestration layer. It resolves the active library, persists the selected
  library, builds UI snapshots, and coordinates Git status checks.
- `skill-manager/electron/skill-library-db.js` is the SQLite persistence
  boundary. It owns schema creation and the authoritative `skill_libraries`,
  `skills`, `tags`, and `skill_tags` tables.
- `skill-manager/electron/skill-library.js` is the `SkillLibrary` domain
  object for one selected library. It owns refresh, read, tag update, and
  delete-skill behavior.
- `skill-manager/electron/skill-discovery.js` owns filesystem discovery and
  `SKILL.md` parsing/collapse rules.
- `skill-manager/electron/skill-installer.js` owns project/global install
  behavior for already-cataloged skills.
- `skill-manager/electron/skill-repository-importer.js` owns Add Skills
  temp-clone, plain-file copy import, Git provenance capture, and narrow
  catalog update behavior for one imported repo.
- `skill-manager/electron/app-config.js` stores app preference state,
  currently `lastSelectedLibraryId`.
- `skill-manager/ui/renderer.js` is the plain-JS presentation layer and local UI
  state. It now owns the library picker flow, selected-library actions, and the
  Add Skills repo import modal and result messaging.
- `skill-manager/scripts/migrate-json-tags-to-sqlite.js` is the manual one-time
  migration script that reads legacy `.skill-library-manager.json` tag data and
  writes it into SQLite for already-cataloged skills by name.
- `skill-manager/tests/unit/` holds single-boundary tests such as orchestration
  or domain-module behavior.
- `skill-manager/tests/integration/` holds real filesystem, real Git, and real
  SQLite collaboration tests.

### Guidance evaluation

A separate capability that measures whether a piece of agent guidance improves
an agent's work, by running the same task under two configurations that differ
in exactly one factor. It does not share modules with catalog, install, or tag
behavior. Every module is prefixed `evaluation-`.

Domain and persistence:

- `electron/evaluation-definition.js` owns the value types: `Subject`,
  `GuidanceSet`, `ArmConfiguration`, `EvaluationDefinition`. The varied factor
  is derived from the two arms, never declared, and arms differing in more than
  one factor are rejected.
- `electron/evaluation-catalog.js` reads targets and scenarios from
  `skill-manager/evaluations/`. Scenario front matter is JSON, not YAML.
- `electron/evaluation-store.js` persists versioned definitions, arm results,
  and comparisons as files, and refuses to overwrite a historical version.
- `electron/evaluation-arm-result.js` is the stored unit: one arm
  configuration plus all of its runs and evidence.
- `electron/evaluation-fingerprint.js` and `electron/evaluation-fs.js` are the
  filesystem primitives. Every enumeration goes through `evaluation-fs`, which
  follows symbolic links; skill libraries are directories of links and a plain
  `isDirectory()` check sees none of them.

Execution:

- `electron/evaluation-agent-runner.js` is the boundary. Adapters are selected
  from a registry keyed by agent id.
- `electron/evaluation-agent-codex.js` and `evaluation-agent-claude.js` are the
  adapters; `evaluation-agent-process.js` holds the shared spawn, timeout and
  cancellation handling.
- `electron/evaluation-workspace.js` prepares an isolated run workspace and
  refuses any workspace or fixture that would leak guidance into both arms.
- `electron/evaluation-activation.js` materializes a guidance set for one agent.
- `electron/evaluation-home.js` builds a per-evaluation agent home.
- `electron/evaluation-ambient-guidance.js` records what isolation cannot
  remove and refuses a colliding evaluation.

Evidence and comparison:

- `electron/evaluation-evidence.js`, `evaluation-check-runner.js`,
  `evaluation-cost.js` collect what a run produced.
- `electron/evaluation-comparison.js` decides comparability and builds the
  blinded review bundle.
- `electron/evaluation-review.js` and `evaluation-report-writer.js` produce and
  render the verdict.

Orchestration and surfaces:

- `electron/evaluation-service.js` composes all of the above; it holds no
  provider-specific logic.
- `electron/evaluation-wiring.js` constructs the service for both Electron and
  the command line, so the two cannot drift.
- `electron/evaluation-paths.js` resolves the catalog root, the store root and
  the CLI paths.
- `scripts/evaluate.js` drives the whole loop headlessly.
- `ui/evaluation-panel.js` owns the Evaluate section; it does not touch
  `ui/renderer.js` state.

### Guidance evaluation operating assumptions

- Run workspaces execute under the OS temp directory, never inside this
  repository. Both agents walk upward for instruction files, so a workspace
  here would inherit this repo's `CLAUDE.md` and `AGENTS.md` into both arms.
- The catalog (`skill-manager/evaluations/`) is checked in; generated data
  (definitions, arm results, comparisons, reports) is not.
- Isolating the agent home removes the user-global instruction file, rules,
  plugins and MCP config. It does not remove global skills: Codex reads
  `~/.agents/skills` and `$CODEX_HOME/skills` regardless of `CODEX_HOME`,
  `USERPROFILE`, `HOME` or `--ignore-user-config`, and no config key disables
  it. Those skills are recorded as ambient guidance, and an evaluation whose
  skill subject collides with one is refused.
- A Codex run's exit code is not a success signal; a `turn.completed` event is.
- Codex emits no event identifying a skill load, so activation there is
  generally `undetermined`. Claude's tool uses name the tool, so absence is
  evidence.
- Task arms run unsandboxed because the Codex Windows sandbox fails on this
  machine; review arms stay read-only.
- Neither CLI is on `PATH`. Paths come from `AppConfig` or the
  `SKILL_MANAGER_CODEX_CLI` / `SKILL_MANAGER_CLAUDE_CLI` environment variables.

### Current metadata source of truth

- SQLite is the authority for libraries, skills, and tags.
- The Electron database lives under `app.getPath("userData")`, unless
  `SKILL_MANAGER_DB_PATH` overrides it for tests or scripts.
- App preference state lives in a JSON file under `app.getPath("userData")`,
  currently only `lastSelectedLibraryId`.
- Legacy `.skill-library-manager.json` data is not live runtime state anymore;
  it is only read by the one-time migration script.

### Current operating assumptions

- Startup must not silently scan the library root.
- One skill library is loaded at a time.
- If more than one library exists and no persisted selection is valid, the UI
  must require an explicit library choice before skill operations proceed.
- Add Skills must update only the imported repo's discovered skills; it must not
  force a full library refresh.
- Add Skills uses a temp clone under the OS temp directory, then copies the
  repo into the active library without `.git`.
- If Add Skills finds no `SKILL.md` entries, the app should report that clearly
  and auto-delete the temp clone.
- Duplicate skill names during Add Skills are fatal for that import and should
  report both the existing and incoming skill locations to the user.
- The legacy Python CLI has been removed. Electron is the only supported app
  surface.
- `node:sqlite` is the current SQLite driver choice. It worked in Electron 37
  main-process validation, with the only observed downside being the current
  experimental warning.

## Routing guidance

When working in `skill-manager/`:

1. Read this file.
2. For backend persistence work, inspect `electron/skill-library-db.js`.
3. For library selection, snapshot assembly, or Git state, inspect
   `electron/active-skill-library.js`.
4. For discovery/import work, inspect `electron/skill-discovery.js` and
   `electron/skill-repository-importer.js`.
5. For install/uninstall behavior, inspect `electron/skill-installer.js`.
6. For one-library domain behavior, inspect `electron/skill-library.js`.
7. For app preference state, inspect `electron/app-config.js`.
8. For the one-time legacy tag import, inspect
   `scripts/migrate-json-tags-to-sqlite.js`.
9. For UI state and startup/picker flow, inspect `electron/main.js`,
   `electron/preload.js`, and `ui/renderer.js`.
10. For guidance evaluation, read `electron/evaluation-service.js` for the
   orchestration and `electron/evaluation-definition.js` for the vocabulary;
   the spec is `docs/specs/skill-manager-skill-evaluation-spec.md`.
11. Use `skill-manager/tests/unit/` and `skill-manager/tests/integration/` as
   the primary automated verification entrypoints.

## Verification commands

Backend baseline:

- `cd skill-manager`
- `node --test tests/unit/*.test.js`
- `node --test tests/integration/*.test.js`
- `node --check ui/renderer.js`
- `node --check electron/main.js`

Headless evaluation check:

- `node scripts/evaluate.js list`

Electron smoke check:

- `electron .`

## Historical docs

Historical context for the existing UI and prior changes lives under
`skill-manager/docs/`. Do not treat those files as the canonical architecture
entrypoint unless this map links to a specific one for rationale.
