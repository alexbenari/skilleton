# Implement Temp-Clone Add Skills Import

## Why this matters

Users should be able to keep their skill library inside the `skilleton`
monorepo and still import skills from a Git repo through the app. Today `Add
Skills` clones directly into the library root, which creates nested `.git`
directories and makes the monorepo awkward to use. This change preserves the
existing repo-URL workflow while importing plain files into the library instead
of embedded repos.

## Progress

- [x] (2026-07-01 00:00Z) Product spec approved in
  `docs/specs/add-skills-temp-import-spec.md`.
- [ ] (2026-07-01 00:00Z) Add DB support for imported Git provenance
  (`git_tracked_ref`, `git_imported_revision`) and keep existing skill reads and
  writes working.
- [ ] (2026-07-01 00:00Z) Replace direct-to-library clone behavior with
  temp-clone, copy-without-`.git`, path translation, and temp cleanup.
- [ ] (2026-07-01 00:00Z) Update IPC and renderer messaging to reflect import
  instead of live clone behavior and remove no-skills cleanup prompting.
- [ ] (2026-07-01 00:00Z) Verify the feature end to end with importer tests, DB
  tests, and a manual Electron smoke check.

## Surprises & Discoveries

- Discovery: The current product direction is DB-authoritative and does not
  silently rescan the library root on startup.
  Evidence: `docs/agent-docs/agent-architecture-map.md` and
  `docs/specs/skill-manager-sqlite-catalog-spec.md`.

- Discovery: The current importer clones directly into `libraryRoot/<repoName>`
  and then catalogs only that destination.
  Evidence: `skill-manager/electron/skill-repository-importer.js`.

- Discovery: The current renderer still assumes a long-lived cloned folder and
  prompts the user to delete it when no skills are found.
  Evidence: `skill-manager/ui/renderer.js` function `cloneSkillsRepo()`.

- Discovery: Electron exposes a native temp path via `app.getPath('temp')`,
  which is a better home for temporary clone workdirs than `userData`.
  Evidence: [Electron `app.getPath`](https://electronjs.org/docs/latest/api/app)
  and `PLANS.md` requirement to record research decisions in the plan.

## Decision Log

- Decision: Keep `Add Skills` as a repo-URL import workflow only.
  Rationale: Manual local copies can already be brought into the catalog via an
  explicit library refresh, so a local-folder import flow is not needed here.
  Date/Author: 2026-07-01 / Codex + user

- Decision: Copy the full imported repo tree into the library, excluding `.git`.
  Rationale: This preserves current repo shape, avoids fragile heuristics about
  "skill-relevant" files, and sets up a cleaner future update story.
  Date/Author: 2026-07-01 / Codex + user

- Decision: Auto-delete the temp clone on success and on handled failure paths.
  Rationale: Temp workdirs are an implementation detail, not part of the user's
  persistent library.
  Date/Author: 2026-07-01 / Codex + user

- Decision: Store `git_tracked_ref` and `git_imported_revision` now.
  Rationale: The future update-check feature needs both the upstream location
  and the exact imported commit to compare against.
  Date/Author: 2026-07-01 / Codex + user

- Decision: Use `app.getPath('temp')` as the temp-root base and inject that
  path into the importer.
  Rationale: The main process already owns Electron-specific APIs, and injected
  paths keep `SkillRepositoryImporter` testable without reaching into Electron
  globals directly.
  Date/Author: 2026-07-01 / Codex + user

## Outcomes & Retrospective

Pending implementation.

The shipped behavior should let a user import a repo into any active library
without creating a nested `.git` directory inside that library. Verification
should prove both the filesystem outcome and the updated catalog state, not
just internal code changes.

## Context and orientation

This work lives entirely inside the Electron skill manager.

Important modules:

- `skill-manager/electron/skill-repository-importer.js`
  Current `Add Skills` backend. Today it normalizes the repo URL, derives
  `repoName`, clones directly into `libraryRoot/<repoName>`, discovers skills
  there, and upserts them into the DB.

- `skill-manager/electron/skill-discovery.js`
  Filesystem discovery and `SKILL.md` parsing. It recursively finds skills,
  derives `name`, `description`, and `source`, and can report unresolved name
  collisions.

- `skill-manager/electron/skill-library-db.js`
  SQLite schema and DB adapter. This is the persistence boundary for libraries,
  skills, and tags. Any new persisted provenance fields belong here.

- `skill-manager/electron/active-skill-library.js`
  Application orchestration layer. It exposes `addSkillsFromRepository()` to
  IPC callers and assembles state snapshots for the renderer.

- `skill-manager/electron/main.js`
  IPC wiring. This file constructs `SkillRepositoryImporter`, exposes the Add
  Skills handler, and is the right place to provide the Electron temp root into
  the importer.

- `skill-manager/electron/preload.js`
  Renderer bridge. Any IPC channel shape changes must stay mirrored here.

- `skill-manager/ui/renderer.js`
  UI behavior and user messages for Add Skills. Today it still refers to
  "cloning" into the library and prompts for cleanup when no skills are found.

- `skill-manager/tests/skill-repository-importer.test.js`
  Existing importer tests. Expand these to cover temp cloning, copy behavior,
  provenance, and cleanup.

Assumptions to preserve:

- Startup must not silently rescan the library root.
- `Add Skills` must update only the imported repo's discovered skills, not run
  a full library refresh.
- Duplicate imported skill names against the existing catalog remain fatal for
  the import.

Acceptance behavior:

When a user imports a skills repo through `Add Skills`, the app should place a
plain copied repo tree under the active library without `.git`, catalog the
copied skills correctly, and leave no temp clone behind.

## Milestone 1 - Extend DB provenance support

### Scope

Persist the additional Git provenance needed for temp-based imports and future
update checks, while keeping existing library refresh and read paths working.

### Changes

- File: `skill-manager/electron/skill-library-db.js`
  Edit: Add nullable `git_tracked_ref` and `git_imported_revision` columns to
  the `skills` schema, update row mapping, update upsert logic, and preserve
  existing behavior when those fields are absent.

- File: `skill-manager/electron/skill-library.js`
  Edit: Ensure refresh-based discovered skills continue to write `NULL` for the
  new provenance fields unless the discovery/import caller provides values.

- File: tests covering DB schema and skill upsert behavior
  Edit: Add assertions that imported rows can store and round-trip the new
  provenance fields.

### Validation

- Command: `cd skill-manager && node --test tests/skill-library-db.integration.test.js`
  Expected: DB schema initialization and skill upsert/read tests pass with the
  new provenance fields present.

- Command: `cd skill-manager && node --test tests/skill-library.test.js`
  Expected: existing skill-library behavior still passes, including refresh and
  tag-related flows.

### Rollback/Containment

If DB changes prove unstable, revert the schema and row-shape edits together
before touching importer logic. Do not proceed with importer work while the DB
adapter and tests are in a half-migrated state.

## Milestone 2 - Implement temp-clone import and cleanup

### Scope

Replace direct-to-library cloning with temp cloning under the OS temp
directory, copying the imported repo tree into the library without `.git`,
translating discovered paths, and cleaning up temp workdirs.

### Changes

- File: `skill-manager/electron/main.js`
  Edit: Pass an app-specific temp root based on `app.getPath('temp')` into
  `SkillRepositoryImporter`, for example a `skill-manager/repo-import-*`
  workdir base.

- File: `skill-manager/electron/skill-repository-importer.js`
  Edit: Introduce temp workdir creation, clone into temp, read `HEAD` and
  tracked ref, discover skills under the temp clone, fail before copying on
  no-skills and duplicate-name cases, recursively copy the repo tree into the
  final library destination excluding `.git`, translate discovered skill paths
  from temp paths to final paths, upsert the copied skills, and delete temp
  workdirs in success and handled failure paths.

- File: `skill-manager/electron/active-skill-library.js`
  Edit: Keep the orchestration API stable while adapting to any updated result
  payload shape from the importer.

- File: `skill-manager/tests/skill-repository-importer.test.js`
  Edit: Add focused tests for temp-root use, `.git` exclusion, final-path
  cataloging, auto-cleanup, duplicate-name failure behavior, and no-skills
  behavior.

### Validation

- Command: `cd skill-manager && node --test tests/skill-repository-importer.test.js`
  Expected: importer tests prove temp clone use, copied final destination
  behavior, `.git` exclusion, provenance capture, and cleanup.

- Command: `cd skill-manager && node --test tests/skill-library-db.integration.test.js`
  Expected: DB integration still passes after importer writes the new columns.

### Rollback/Containment

If temp-clone logic fails in a way that risks partial library writes, back out
the importer changes and return to a failing-but-safe direct-clone baseline in
source control rather than leaving mixed temp/copy behavior.

## Milestone 3 - Update IPC and renderer behavior

### Scope

Align the UI and bridge layers with the new import semantics and remove the old
cleanup prompt that assumed a persistent failed clone in the library.

### Changes

- File: `skill-manager/electron/main.js`
  Edit: Update Add Skills IPC response messages to describe importing into the
  library rather than cloning a live repo there. Remove the no-skills cleanup
  path if the backend now auto-cleans temp clones.

- File: `skill-manager/electron/preload.js`
  Edit: Keep bridge method names or payload expectations aligned with any IPC
  shape changes.

- File: `skill-manager/ui/renderer.js`
  Edit: Update Add Skills status copy, remove the user confirmation that offers
  to delete a no-skills clone, and keep duplicate-name messaging focused on the
  existing skill path and the would-be imported destination or relative path.

### Validation

- Command: `cd skill-manager && node --check electron/main.js`
  Expected: main-process file parses cleanly.

- Command: `cd skill-manager && node --check ui/renderer.js`
  Expected: renderer file parses cleanly.

### Rollback/Containment

If renderer or IPC messaging becomes inconsistent, keep backend import logic and
revert only the presentation-layer wording/prompt changes until the contract is
clear again.

## Milestone 4 - End-to-end verification and documentation touch-up

### Scope

Prove the feature from the user's perspective and update any agent-facing docs
only if implementation changes the durable architecture beyond what the current
docs already say.

### Changes

- File: `docs/agent-docs/agent-architecture-map.md` (only if needed)
  Edit: Update the Add Skills description from "clone into the active library
  folder" to temp-clone plus copied import if the final implementation changes
  the durable architecture enough to make the current wording stale.

- File: `docs/specs/add-skills-temp-import-spec.md` and this plan
  Edit: Record any implementation discoveries or deviations encountered during
  execution.

### Validation

- Command: `cd skill-manager && node --test tests/skill-library.test.js`
  Expected: no regressions in library behavior.

- Command: `cd skill-manager && node --test tests/skill-repository-importer.test.js && node --test tests/skill-library-db.integration.test.js && node --check electron/main.js && node --check ui/renderer.js`
  Expected: targeted backend and syntax checks all pass.

- Command: `cd skill-manager && electron .`
  Expected: manual smoke check succeeds. In the app, importing a small test repo
  creates `libraryRoot/<repoName>` without a `.git` folder, imported skills
  appear in the catalog, and no temp clone remains after the action completes.

### Rollback/Containment

If manual QA shows the user-visible behavior is wrong even though tests pass, do
not claim completion. Keep the work local, document the gap in `Progress` and
`Surprises & Discoveries`, and fix the observable behavior before hand-off.
