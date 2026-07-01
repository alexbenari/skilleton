# Skill Manager SQLite Catalog Implementation Plan

## Why this matters

Skill-manager currently derives important app state from files inside the skill
library folder and from JSON config files. This makes metadata ownership blurry:
the skill library stores both skill content and skill-manager app metadata. This
plan moves library, skill, and tag metadata into an internal Electron SQLite
catalog so skill-manager has a clear source of truth while skill folders remain
plain filesystem content.

The user-visible goal is: when the Electron app starts, it loads the selected
library and skill tags from its internal SQLite catalog, does not silently
discover new folders until the user explicitly imports or refreshes, and still
installs, uninstalls, reads, updates, and filters skills as before.

## Progress

- [x] (2026-06-30 12:00Z) Feature spec approved in
  `docs/specs/skill-manager-sqlite-catalog-spec.md`.
- [ ] Create the missing agent architecture map before production code changes.
- [ ] Complete SQLite driver spike and record final driver choice.
- [ ] Add SQLite persistence layer with a thin adapter smoke test.
- [ ] Extract mockable catalog discovery and filesystem skill-reading boundary
  into a `SkillDiscovery` class.
- [ ] Add DB-backed domain catalog, active-library, installer, and app-service
  boundaries.
- [ ] Add multi-library startup picker, selection flow, and persisted
  last-selected library.
- [ ] Make Add Skills catalog only the cloned destination.
- [ ] Add narrow JSON tag migration script.
- [ ] Remove legacy Python CLI and stale app-as-skill manifest.
- [ ] Update agent-facing docs and final verification evidence.

## Surprises & Discoveries

- Discovery: Root `AGENTS.md` points to `docs/agent-docs/agent-architecture-map.md`,
  but that file did not exist when the spec was written.
  Evidence: `Get-Content docs/agent-docs/agent-architecture-map.md` failed with
  "Cannot find path".
- Discovery: The existing backend test entrypoint is direct `node:test`, not
  `npm test`.
  Evidence: `npm test` reported "Missing script: test"; `node --test
  tests/skill-library.test.js` passed 15 tests.
- Discovery: Local Node 22 exposes `node:sqlite`, but it reports an experimental
  warning.
  Evidence: `node -e "require('node:sqlite')"` printed `ExperimentalWarning`.
- Discovery: `skill-manager/SKILL.md` documented the imported app folder as a
  skill and centered the legacy Python CLI, so the approved spec removes it.
  Evidence: review of `skill-manager/SKILL.md` before deletion.

## Decision Log

- Decision: Scope the SQLite catalog to the Electron app and remove the Python
  CLI as part of this feature.
  Rationale: The Python CLI is legacy, not understood by the product owner, and
  would create a second metadata implementation.
  Date/Author: 2026-06-30 / Codex and user

- Decision: Store the SQLite database under Electron `app.getPath("userData")`.
  Rationale: The user rejected `~/.codex` as the app metadata location; Electron
  user data is the native place for app-owned state.
  Date/Author: 2026-06-30 / Codex and user

- Decision: Make SQLite the authority for the skill catalog.
  Rationale: Startup should not silently discover whatever happens to exist in
  the library folder. Explicit import and refresh make catalog changes
  intentional.
  Date/Author: 2026-06-30 / Codex and user

- Decision: Use `skills.name` as the app-facing identity and SQLite `skills.id`
  only for internal joins.
  Rationale: The current app already treats frontmatter `name` as the
  operational identity. A separate `skill_key` would add vocabulary without a
  current user need.
  Date/Author: 2026-06-30 / Codex and user

- Decision: If multiple library rows exist, startup must ask the user which one
  to load when there is no valid persisted last-selected library.
  Rationale: The v1 UI still loads one library at a time, but the database can
  contain more than one configured library. A remembered user selection is safe;
  guessing from row order or paths is not.
  Date/Author: 2026-06-30 / user

- Decision: Persist the last-selected library in an Electron app configuration
  file under `app.getPath("userData")`.
  Rationale: Last selection is app preference state, not catalog metadata. There
  is no current Electron-native app config file; the old `~/.codex` pointer file
  is being retired.
  Date/Author: 2026-06-30 / user and Codex

- Decision: Use DDD-oriented names for the new boundaries:
  `SkillLibrary`, `SkillInstaller`, `ActiveSkillLibrary`, `SkillLibraryDB`, and
  `DBAdapter`. Use `SkillRepositoryImporter` for the Add Skills repository-clone
  flow.
  Rationale: These names keep the ubiquitous language centered on skill
  libraries while separating domain catalog behavior, project/global
  installation behavior, repository importing, active selection, and SQL
  implementation.
  Date/Author: 2026-06-30 / user and Codex

## Outcomes & Retrospective

Not yet implemented. During execution, update this section with shipped
behavior, verification commands, manual QA evidence, and any follow-up work.

## Context and orientation

The `skill-manager/` folder is an Electron app imported into this monorepo. Its
current main process code lives in `skill-manager/electron/`. The central
workflow module is `skill-manager/electron/skill-library.js`, which currently
does many things: reads JSON config, discovers skill folders recursively,
parses `SKILL.md`, computes install state, clones repos, updates tags, and
builds `statusSnapshot()` for the renderer.

The renderer is plain JavaScript in `skill-manager/ui/renderer.js`, bridged
through `skill-manager/electron/preload.js` and IPC handlers in
`skill-manager/electron/main.js`. The UI currently depends on snapshot fields
such as `libraryRoot`, `projectRoot`, `skills`, `enabled`, `globalEnabled`,
`allTags`, install-state fields, repo status fields, `description`, `source`,
and `path`.

Current metadata storage:

- `~/.codex/local-skill-library.json` points at the configured library root.
- `<library-root>/.skill-library-manager.json` stores `skill_tags`.
- Skill rows are discovered by scanning folders under the configured library
  root for `SKILL.md`.

Target metadata storage:

- SQLite database under Electron `app.getPath("userData")`.
- Electron app configuration file under `app.getPath("userData")` for
  `lastSelectedLibraryId`.
- `skill_libraries`, `skills`, `tags`, and `skill_tags` tables.
- Skill folders still live on disk under the selected library root.
- Startup reads SQLite only; filesystem scanning happens through explicit
  import/refresh/Add Skills.

Important current behaviors to preserve:

- Duplicate skill names are errors unless existing packaged-variant or
  identical-content collapse rules resolve them.
- Project installs are copied to `.agents/skills/<skill-name>`.
- Global installs are copied to `~/.codex/skills/<skill-name>`.
- Modified copied installs remain installed but block replacement until the
  user explicitly forces replacement.
- Git status checks can be pending initially and refreshed separately.

Use repository design guidance from `coding-quality.md`: keep state ownership
explicit, keep SQL in the storage boundary, keep workflow logic out of the UI,
and prefer small focused modules over expanding `skill-library.js` further.

## Milestone 1 - Agent Architecture Map Bootstrap

### Scope

Create the missing canonical agent architecture map before production edits so
future work in this feature can orient from a live source of truth and keep it
updated as boundaries change.

### Files

- Create: `docs/agent-docs/agent-architecture-map.md`

### Changes

Create a compact architecture map that covers:

- repo layout at the monorepo level,
- `skill-manager/` as an Electron app,
- the current pre-feature state of `skill-manager/electron/skill-library.js` as
  the legacy all-in-one backend module,
- the intended feature boundaries:
  - `skill-manager/electron/skill-library-db.js` exporting `SkillLibraryDB` and
    `DBAdapter`,
  - `skill-manager/electron/skill-discovery.js` as filesystem discovery and
    `SKILL.md` parsing,
  - `skill-manager/electron/skill-library.js` as the `SkillLibrary` domain
    catalog,
  - `SkillInstaller` as project/global install behavior, not repository clone
    importing,
  - `SkillRepositoryImporter` as Add Skills repository clone/catalog behavior,
  - `ActiveSkillLibrary` as selected-library context,
  - `skill-manager/ui/renderer.js` as presentation/local interaction,
- tests and commands to run,
- the normative rule that SQLite is the metadata source of truth and startup
  must not silently scan the library root.

Keep the map honest: mark planned boundaries as planned until their code exists.
Historical docs under `skill-manager/docs/` remain historical context, not the
current architecture entrypoint.

### Validation

- Command: `Test-Path docs/agent-docs/agent-architecture-map.md`
- Expected: prints `True`.
- Command: `rg -n "SkillLibraryDB|DBAdapter|skill-discovery|SQLite|source of truth|skill-library.js|renderer.js" docs/agent-docs/agent-architecture-map.md`
- Expected: each major boundary is documented.

### Rollback/Containment

If the implementation changes the planned boundaries, update the map in the same
milestone that changes them. Do not leave `AGENTS.md` pointing at a missing file.

## Milestone 2 - SQLite Driver Spike

### Scope

Choose the SQLite driver with local evidence before production edits. The spike
must answer whether Electron 37 can use Node's `node:sqlite` in the main process
without hanging or producing unusable warnings, and whether a package dependency
is needed instead.

### Files

- Create temporary spike file only if needed: `skill-manager/scripts/spike-sqlite-driver.js`
- Modify after decision: `docs/plans/skill-manager-sqlite-catalog-exec-plan.md`

### Changes

Run two candidate checks:

1. Node runtime check:
   - Command:

         @'
         const sqlite = require("node:sqlite");
         const db = new sqlite.DatabaseSync(":memory:");
         db.exec("create table t(id integer primary key, name text unique); insert into t(name) values ('ok')");
         console.log(db.prepare("select name from t").get().name);
         db.close();
         '@ | node

   - Expected if usable in Node: prints `ok`; warnings are recorded.

2. Electron main-process check:
   - Create `skill-manager/scripts/spike-sqlite-driver.js` with a minimal
     Electron app that opens a memory database in `app.whenReady()`, creates a
     table, reads a row, prints `electron-sqlite-ok`, and exits.
   - Command: `npx electron scripts/spike-sqlite-driver.js`
   - Expected if usable in Electron: exits with code 0 and prints
     `electron-sqlite-ok`.

Selection criteria:

- Prefer `node:sqlite` only if it works in Electron main process, supports the
  synchronous operations needed by this local app, and warnings are acceptable
  for the project.
- If `node:sqlite` is unavailable or too unstable, choose a maintained package
  such as `better-sqlite3`, add it as a dependency, and document the native
  package/build impact in this plan's Decision Log.

After the spike, delete any temporary spike file unless it becomes a useful
checked-in diagnostic.

### Validation

- Command: `git diff -- docs/plans/skill-manager-sqlite-catalog-exec-plan.md`
- Expected: Decision Log contains the selected SQLite driver and rationale.

### Rollback/Containment

If both candidates fail, stop implementation and record the blocker in
`Surprises & Discoveries`. Do not start the storage layer until the persistence
dependency is settled.

## Milestone 3 - SkillLibraryDB And DBAdapter Smoke Test

### Scope

Add the SQLite persistence layer behind a small domain-facing API. This
milestone does not test SQLite itself. It uses a thin adapter smoke test to
prove our SQL wiring matches the `SkillLibraryDB` interface and that transaction
rollback is wired correctly.

### Files

- Create: `skill-manager/electron/skill-library-db.js`
- Create: `skill-manager/tests/skill-library-db.integration.test.js`
- Modify if a dependency is chosen: `skill-manager/package.json`
- Modify if a dependency is chosen: `skill-manager/package-lock.json`

### Changes

Implement `skill-library-db.js` as the only module that speaks SQL. Export a
domain-facing `SkillLibraryDB` interface shape and a concrete `DBAdapter` factory
such as `createDBAdapter({ databasePath, sqliteDriver })`, which returns an
object that implements the methods listed below.

`DBAdapter` should expose plain methods:

- `initialize()`
- `close()`
- `listLibraries()`
- `setLibrary(localPath)`
- `deleteLibrary(libraryId)`
- `getLibrary(libraryId)`
- `listSkills(libraryId)`
- `replaceLibrarySkills(libraryId, discoveredSkills)`
- `upsertSkills(libraryId, discoveredSkills)`
- `deleteSkill(skillId)`
- `setSkillTags(libraryId, skillName, tags)`
- `listTags()`
- `importTagsForExistingSkills(libraryId, skillTagsByName)`

Schema version 1 tables:

- `schema_meta(key text primary key, value text not null)`
- `skill_libraries(id integer primary key, local_path text not null unique, created_at text not null, updated_at text not null)`
- `skills(id integer primary key, library_id integer not null references skill_libraries(id) on delete cascade, name text not null, local_path text not null, description text not null, source text, git_source_url text, created_at text not null, updated_at text not null, unique(library_id, name))`
- `tags(id integer primary key, name text not null unique)`
- `skill_tags(skill_id integer not null references skills(id) on delete cascade, tag_id integer not null references tags(id) on delete cascade, primary key(skill_id, tag_id))`

Enable foreign keys on every connection. Use transactions for
`replaceLibrarySkills`, `upsertSkills`, `deleteLibrary`, `deleteSkill`,
`setSkillTags`, and `importTagsForExistingSkills`.

Tests in `skill-library-db.integration.test.js` use a real temporary SQLite database
only because this milestone verifies our adapter code. Do not test SQLite
features in isolation. Cover:

- `setLibrary()` followed by `listLibraries()` returns the expected local path,
- `replaceLibrarySkills()` followed by `listSkills()` returns the expected skill
  rows and removes rows absent from the replacement input,
- `setSkillTags()` followed by `listSkills()` returns the expected tag names for
  that skill,
- a forced failure inside `replaceLibrarySkills()` leaves the previous catalog
  unchanged.

### Validation

- Command: `node --test tests/skill-library-db.integration.test.js`
- Expected: the DB adapter smoke tests pass.
- Command: `node --test tests/skill-library.test.js`
- Expected: existing workflow tests still pass because production workflow has
  not yet been switched to the new DB adapter.

### Rollback/Containment

This milestone is additive. If it fails, remove `skill-library-db.js`,
`skill-library-db.integration.test.js`, and any package dependency changes.

## Milestone 4 - SkillDiscovery Class

### Scope

Move skill discovery and `SKILL.md` parsing into a focused `SkillDiscovery`
class that can be used by refresh, Add Skills, and tests. Keep behavior
equivalent to the current discovery functions in `skill-library.js`.

### Files

- Create: `skill-manager/electron/skill-discovery.js`
- Create: `skill-manager/tests/skill-discovery.test.js`
- Modify: `skill-manager/electron/skill-library.js`

### Changes

Move or copy the current discovery-related behavior into
`skill-discovery.js` as methods on `SkillDiscovery`:

- `parseSkillMetadata(markdown)`
- `readSkillMetadata(skillMdPath)`
- `firstSentence(text)`
- `discoverSkills(root)`
- packaged skill collapse logic using `PACKAGED_SKILL_LOCATIONS`
- identical-content collapse logic
- `skillSourceFromPath(libraryRoot, skillPath, skillName)`
- duplicate failure formatting

Expose this class API:

- `new SkillDiscovery({ fileSystem })`
- `parseSkillMetadata(markdown)`
- `readSkillMetadata(skillMdPath)`
- `discoverLibrarySkills(libraryRoot)`
- `discoverSkillsUnderPath(libraryRoot, targetPath)`
- `readSkillMarkdown(skillPath)`

`parseSkillMetadata(markdown)` should be pure and easy to unit test. It parses
the frontmatter block from `SKILL.md` text into metadata such as `name` and
`description`. `readSkillMetadata(skillMdPath)` is the file-backed wrapper that
reads a `SKILL.md` file and delegates to `parseSkillMetadata()`.

The constructor-injected `fileSystem` dependency should provide the small
operations needed by discovery, such as `readFileSync`, `readdirSync`,
`statSync`, and `existsSync`. Production uses `fs`; unit tests can use mocks for
pure logic and temporary folders for traversal behavior.

Keep the output shape aligned with DB rows:

- `name`
- `localPath`
- `description`
- `source`
- `gitSourceUrl`

Use the existing duplicate/collapse behavior exactly: packaged variants from
one imported repo collapse to the highest-priority location, identical content
collapses to one row, unresolved duplicate names fail.

### Validation

- Command: `node --test tests/skill-discovery.test.js`
- Expected: tests pass for frontmatter parsing, packaged-variant collapse,
  identical-content collapse, source derivation, and unresolved duplicate
  failure.
- Command: `node --test tests/skill-library.test.js`
- Expected: existing workflow tests still pass after `skill-library.js` imports
  discovery helpers.

### Rollback/Containment

If extraction destabilizes behavior, keep `SkillDiscovery` and tests but
temporarily wrap the class from `skill-library.js` until parity is restored. Do
not change DB-backed workflow in this milestone.

## Milestone 5 - SkillLibrary, ActiveSkillLibrary, And SkillInstaller

### Scope

Convert the Electron backend from JSON config and startup filesystem discovery
to explicit domain/application boundaries backed by SQLite catalog reads.
Preserve existing install/read/update/status behavior from the UI's perspective.

### Files

- Modify: `skill-manager/electron/skill-library.js`
- Modify: `skill-manager/electron/main.js`
- Modify: `skill-manager/electron/preload.js`
- Modify: `skill-manager/tests/skill-library.test.js`
- Create if helpful: `skill-manager/tests/helpers/fake-skill-library-db.js`
- Create if helpful: `skill-manager/electron/skill-installer.js`
- Create if helpful: `skill-manager/electron/app-config.js`

### Changes

Introduce explicit boundaries:

- `SkillLibrary`: domain catalog object for one skill library's catalog
  behavior and invariants.
- `ActiveSkillLibrary`: selected-library context for the currently loaded
  library id/path. Operations that mutate or inspect cataloged skills should go
  through this context or receive an explicit library id.
- `SkillInstaller`: project/global install behavior, including path resolution,
  copied-directory comparison, install-state classification, force/blocked
  replacement rules, and safe removal of installed copies.
- App-service/orchestration layer in `main.js` or a small backend coordinator:
  opens DB/config, selects active library, combines catalog rows with install
  and Git state, and builds renderer snapshots.

Expose this `SkillLibrary` API:

- `new SkillLibrary({ libraryId, localPath, db, discovery })`
- `refreshLibrary(libraryId)`
- `setSkillTags(skillName, tags)`
- `readSkillMarkdown(skillName)`
- `deleteLibrarySkill(skillName, project)`

Constructor dependencies:

- `db`: `SkillLibraryDB` implementation,
- `discovery`: `SkillDiscovery` instance or test double,
- `libraryId` and `localPath`: active catalog identity and root path.

Expose this `SkillInstaller` API:

- `new SkillInstaller({ fileSystem, codexHomePath })`
- `enableSkill(skill, project, force)`
- `disableSkill(skillName, project)`
- `installGlobalSkill(skill, force)`
- `uninstallGlobalSkill(skillName)`
- `installState(entryPath, skillPath)`

Constructor dependencies:

- `fileSystem`: filesystem helper for install/delete/copy checks,
- `codexHomePath`: resolver for the Codex home path used by global installs.

Export the class directly from `skill-library.js`:

    module.exports = { SkillLibrary, SkillLibraryError };

Update `main.js` to construct production dependencies once near IPC setup:

    const { SkillLibrary } = require("./skill-library");
    const { createDBAdapter } = require("./skill-library-db");
    const { SkillDiscovery } = require("./skill-discovery");

IPC handlers should call an active-library/app-service path that creates or
loads `ActiveSkillLibrary` explicitly. Tests should instantiate `SkillLibrary`,
`ActiveSkillLibrary`, and `SkillInstaller` directly with mock dependencies where
that keeps the behavior focused.

Replace `readConfig()`, `writeConfig()`, `writeLibraryConfig()`, and
`loadSkillsFromConfig()` usage with store-backed operations:

- `statusSnapshot(project, options)` opens/initializes the DB adapter, reads app
  configuration, lists libraries, returns unconfigured state if none exist,
  loads the only library or valid last-selected library, returns a library picker
  state when selection is required, reads skills and tags through
  `ActiveSkillLibrary`, and computes project/global install state through
  `SkillInstaller`.
- `setRoot(rootPath)` becomes DB-backed `setLibrary(rootPath)` and does not
  write JSON.
- Add explicit `refreshLibrary(libraryId)` or `refreshLibrary(project)` IPC
  handler that scans the selected library folder and calls
  `db.replaceLibrarySkills()`.
- `setSkillTags(skillName, tags)` uses `SkillLibrary.setSkillTags()`.
- `readSkillMarkdown(skillName)` resolves the DB skill row, then reads
  `SKILL.md` from disk.
- `enableSkill`, `installGlobalSkill`, `updateSkillRepo`, and
  `deleteLibrarySkill` resolve skill rows from SQLite through the active
  library.

Remove or quarantine old JSON config helpers once no production path uses them.
Keep constants for installed skill locations and `SKILL.md` filename where
needed.

Tests:

- Use a mock `SkillLibraryDB` for workflow tests that only assert orchestration and
  fail-fast behavior.
- Use a mock `SkillDiscovery` for workflow tests that should not touch the
  filesystem.
- Keep a small set of temporary filesystem tests for copied install behavior.
- Update existing tests that seed JSON config to seed either the mock DB
  interface, a real temporary DB adapter, or the app config file depending on
  what behavior is under test.

### Validation

- Command: `node --test tests/skill-library.test.js`
- Expected: updated workflow tests pass.
- Command: `node --test tests/skill-library-db.integration.test.js tests/skill-discovery.test.js`
- Expected: storage and discovery tests still pass.

### Rollback/Containment

If the DB switch breaks too much at once, keep the class and mock tests, then
temporarily support a compatibility adapter that reads JSON into an in-memory
mock `SkillLibraryDB` for tests only. Do not reintroduce JSON as production
authority.

## Milestone 6 - Library Picker, App Config, And UI Flow

### Scope

Update the Electron IPC and renderer so startup can present no-library,
single-library, valid last-selected-library, and choose-library states. Add
explicit import/refresh and delete-library actions.

### Files

- Modify: `skill-manager/electron/main.js`
- Modify: `skill-manager/electron/preload.js`
- Modify: `skill-manager/ui/index.html`
- Modify: `skill-manager/ui/renderer.js`
- Create if practical: `skill-manager/tests/renderer-state.test.js`

### Changes

IPC additions:

- `skill-manager:list-libraries`
- `skill-manager:select-library`
- `skill-manager:refresh-library`
- `skill-manager:delete-library`

Snapshot shape additions:

- `librarySelectionRequired: true` when multiple libraries exist and none is
  selected,
- `libraries: [{ id, localPath }]` for picker rendering,
- selected `libraryId` when loaded.
- `lastSelectedLibraryId` in app configuration after the user selects a library
  or when a single library is auto-selected.

Renderer behavior:

- If `snapshot.librarySelectionRequired` is true, render a library picker with
  one action per configured path.
- Selecting a library calls `selectLibrary(id)`, persists that id in app
  configuration, and then loads the normal skill grid.
- Existing `Library` path button still lets the user set a library path.
- Add or expose a clear `Refresh Library` command that calls the explicit
  refresh IPC handler.
- Add `Delete Library` only in a non-dangerous place such as the library side
  panel, with confirmation text that says it removes catalog data only and does
  not delete the folder.

Testing:

- Prefer a renderer state helper test over browser automation for the picker
  branching if the current renderer structure permits extraction.
- If helper extraction is too invasive, cover this through manual QA in the
  final milestone and keep UI edits focused.

### Validation

- Command: `node --test tests/skill-library.test.js`
- Expected: backend picker state tests pass.
- Command if renderer helper exists: `node --test tests/renderer-state.test.js`
- Expected: picker/no-library/loaded-state helper tests pass.
- Manual command: `npm start -- --project=D:\tmp\dev\skilleton\skill-manager`
- Expected: app starts; with no catalog it shows unconfigured/empty state; with
  multiple libraries seeded in the DB and no valid app config it prompts for
  library selection; after selection, restart loads the persisted last-selected
  library.

### Rollback/Containment

If full picker UI is too large, first expose the picker state and add a minimal
plain list of buttons. The richer styling can follow after behavior is proven.

## Milestone 7 - SkillRepositoryImporter Add Skills Narrow Cataloging

### Scope

Introduce `SkillRepositoryImporter` so Add Skills clones into the selected
library and catalogs only the newly cloned destination, never a full library
refresh.

### Files

- Modify: `skill-manager/electron/skill-library.js`
- Modify: `skill-manager/tests/skill-library.test.js`
- Create if helpful: `skill-manager/electron/skill-repository-importer.js`
- Modify if needed: `skill-manager/ui/renderer.js`

### Changes

Add or update an operation named for the use case, such as
`addSkillsFromRepository(repoUrl)`. It should:

- Fail fast if no library is selected.
- Normalize and validate the repo URL as today.
- Clone into the selected library root.
- Call `discovery.discoverSkillsUnderPath(libraryRoot, destination)`.
- If no skills are found, report a clear error that the repo was cloned but not
  cataloged. Return the cloned destination path and a structured
  `cleanupOffered` flag so the renderer can ask whether to delete the cloned
  repo folder.
- If discovered skill names conflict with existing DB skill names and cannot be
  resolved by the approved duplicate rules, fail without partial DB writes.
  Return a structured error payload containing the duplicate skill name, the
  existing DB skill id, the existing DB skill local path, and the newly
  discovered skill local path.
- Call `db.upsertSkills(libraryId, discoveredSkills)` in one transaction.
- Return a state snapshot that includes only the catalog changes from the
  cloned destination.

Keep `cloneSkillsRepo(repoUrl)` only as a temporary IPC compatibility wrapper if
needed while updating the renderer. The domain-facing operation should be the
Add Skills use case, not just the Git clone step.

Update renderer error handling for Add Skills so duplicate failures show a
message like:

    Could not add <repo>: skill "<name>" already exists in the catalog.
    Existing: <existing path>
    New: <new path>

For no-skill failures, update renderer handling so it asks:

    No skills were found in the cloned repo. Delete the cloned folder?

If the user confirms, call a backend cleanup method that deletes only the cloned
destination path returned by the failed Add Skills result. The backend cleanup
method must verify that the destination is inside the selected library root and
matches the path returned from the failed clone/catalog operation.

Tests should use:

- mock `SkillDiscovery` and mock `SkillLibraryDB` to prove no full refresh call occurs,
- temporary filesystem/git only where clone behavior itself must be verified.
- a mock DB conflict to prove duplicate errors include both existing and new
  skill paths for the renderer.
- a no-skill discovery result to prove the Add Skills response includes the
  cloned destination and cleanup offer without deleting automatically.

### Validation

- Command: `node --test tests/skill-library.test.js`
- Expected: Add Skills tests prove only the cloned destination is scanned and
  duplicate failures do not partially catalog skills and include the existing
  DB skill path in the error payload. No-skill failures include the cloned
  destination and do not delete it unless the cleanup method is called.

### Rollback/Containment

If clone plus catalog update fails after clone succeeds, keep the cloned folder
on disk and report that it was not cataloged. Do not delete user-visible cloned
content automatically.

## Milestone 8 - Tag Migration Script

### Scope

Add the narrow one-time script that imports tags from an existing
`.skill-library-manager.json` into an already initialized SQLite catalog.

### Files

- Create: `skill-manager/scripts/migrate-json-tags-to-sqlite.js`

### Changes

Script behavior:

- Accept required JSON path argument.
- Accept optional `--db <path>` argument for tests/manual recovery.
- Open the `DBAdapter`.
- Read only `skill_tags` from the JSON file.
- Normalize tags using the same `normalizeTags()` logic as the app.
- For the currently selected or only library, call
  `db.importTagsForExistingSkills(libraryId, skillTagsByName)`.
- Ignore JSON skill names not found in SQLite.
- Print summary lines for JSON path, skills updated, unique tags imported, and
  missing skill names ignored.

### Validation

- Manual command shape:
  `node scripts/migrate-json-tags-to-sqlite.js D:\path\to\.skill-library-manager.json --db D:\path\to\skill-manager.sqlite`
- Expected: prints a summary and does not modify the JSON file.

### Rollback/Containment

The script is additive and does not delete JSON. If it fails, fix or remove the
script without affecting the app catalog.

## Milestone 9 - Legacy Python CLI And Stale Manifest Removal

### Scope

Remove the legacy Python CLI and the deleted app-as-skill manifest from the
product surface.

### Files

- Delete: `skill-manager/scripts/skill-library.py`
- Delete: `skill-manager/scripts/skill_library_core.py`
- Delete: `skill-manager/scripts/skill_library_ui.py`
- Delete: `skill-manager/SKILL.md`
- Modify: `README.md`
- Modify any docs that still recommend the Python CLI.

### Changes

Remove Python files only after Electron has equivalent needed behavior. Search
for references:

    rg -n "skill-library.py|skill_library_core|skill_library_ui|serve-ui|legacy CLI|skill-manager/SKILL.md|skill-library-manager" .

Update docs so the Electron app is described as an app under
`skill-manager/`, not as an installable skill. Historical docs under
`skill-manager/docs/superpowers/` and `skill-manager/docs/plans/` may remain as
history unless they are used as current instructions.

### Validation

- Command: `rg -n "skill-library.py|skill_library_core|skill_library_ui|serve-ui|legacy CLI" README.md AGENTS.md docs skill-manager -g "!node_modules"`
- Expected: no current instruction tells users to run the Python CLI. Historical
  docs may appear only if explicitly marked or clearly historical.
- Command: `node --test tests/skill-library.test.js tests/skill-library-db.integration.test.js tests/skill-discovery.test.js`
- Expected: all tests pass without Python files.

### Rollback/Containment

If a Python file still contains logic needed by Electron, move that logic into
Electron modules and tests before deleting. Do not keep the Python CLI as a
second supported surface.

## Milestone 10 - End-To-End Verification

### Scope

Prove the user-visible goal with automated tests and targeted manual QA in the
Electron app.

### Files

- Modify: `docs/plans/skill-manager-sqlite-catalog-exec-plan.md`

### Changes

Update `Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective` with final evidence.

Run automated verification:

- `node --test tests/skill-library-db.integration.test.js`
- `node --test tests/skill-discovery.test.js`
- `node --test tests/skill-library.test.js`
- any renderer helper tests added during execution.

Run manual QA:

1. Start app with no configured libraries and confirm it does not scan random
   folders.
2. Set a library and explicitly refresh/import it.
3. Add a new folder under the library manually, restart the app, and confirm it
   does not appear until explicit refresh.
4. Create or seed two libraries in SQLite and confirm startup asks which one to
   load.
5. Use Add Skills and confirm only the cloned destination is cataloged.
6. Save tags and confirm they appear after restart without writing
   `.skill-library-manager.json`.
7. Run the tag migration script against a copy of an old
   `.skill-library-manager.json` and confirm matching DB skills receive tags
   while unknown names are ignored.
8. Enable and uninstall a skill in project/global scopes.
9. Delete a skill and confirm the folder and DB row are removed.
10. Delete a library and confirm only catalog rows are removed, not folders on
    disk.

### Validation

- Expected automated result: all listed tests pass with zero failures.
- Expected manual result: each manual QA step in the `Run manual QA` list
  matches its stated confirmation behavior.
- Expected repository result: `git status --short` shows only intentional
  feature, docs, and dependency changes.

### Rollback/Containment

If automated tests pass but manual QA fails, keep the plan open and record the
failure in `Surprises & Discoveries`. Do not mark the feature complete until
the user-visible behavior is proven.
