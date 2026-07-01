# Agent Architecture Map

Last updated: 2026-06-30
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
- `skill-manager/electron/skill-repository-importer.js` owns Add Skills clone
  and narrow import behavior for a newly cloned repo.
- `skill-manager/electron/app-config.js` stores app preference state,
  currently `lastSelectedLibraryId`.
- `skill-manager/ui/renderer.js` is the plain-JS presentation layer and local UI
  state. It now owns the library picker flow, selected-library actions, and the
  Add Skills cleanup prompt when a cloned repo has no catalogable skills.
- `skill-manager/scripts/migrate-json-tags-to-sqlite.js` is the manual one-time
  migration script that reads legacy `.skill-library-manager.json` tag data and
  writes it into SQLite for already-cataloged skills by name.
- `skill-manager/tests/` is the primary verification entrypoint. The tests are
  split by boundary: orchestration, discovery, installer, repository importer,
  and DB adapter integration.

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
- Add Skills must update only the cloned repo's discovered skills; it must not
  force a full library refresh.
- If Add Skills clones a repo with no `SKILL.md` entries, the app should report
  that clearly and offer cleanup of the cloned folder.
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
10. Use `skill-manager/tests/` as the primary verification entrypoint.

## Verification commands

Backend baseline:

- `cd skill-manager`
- `node --test tests/skill-library.test.js`
- `node --test tests/skill-library-db.integration.test.js`
- `node --test tests/skill-discovery.test.js`
- `node --test tests/skill-installer.test.js`
- `node --test tests/skill-repository-importer.test.js`
- `node --check ui/renderer.js`
- `node --check electron/main.js`

Electron smoke check:

- `electron .`

## Historical docs

Historical context for the existing UI and prior changes lives under
`skill-manager/docs/`. Do not treat those files as the canonical architecture
entrypoint unless this map links to a specific one for rationale.
