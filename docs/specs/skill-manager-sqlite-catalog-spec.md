# Skill Manager SQLite Catalog Spec

Date: 2026-06-30

## Purpose

Move skill-manager's Electron app from JSON-backed and filesystem-discovered
metadata to an internal SQLite catalog. The catalog becomes the source of truth
for skill libraries, skills, and tags, while the filesystem continues to store
the actual skill folders.

## Goals

- Store skill-manager metadata internally in an Electron-native SQLite database.
- Stop storing skill metadata inside the skill library folder.
- Stop using `.skill-library-manager.json` as the app's active tag/config store.
- Make SQLite authoritative for which skills skill-manager knows about.
- Keep the current single-library user experience for the first version.
- If multiple libraries are present in SQLite, let the user choose one library
  to load at startup.
- Preserve the current UI-facing skill snapshot shape where practical.
- Provide a one-time script to migrate existing tag assignments from the old
  `.skill-library-manager.json` file after the new database-backed catalog is
  ready.
- Remove the legacy Python CLI as part of this feature.

## Non-Goals

- No automatic migration from existing JSON files during app startup.
- No support for multiple active libraries in the UI in this version.
- No deletion of old JSON config files as part of normal app behavior.
- No full library-content management system beyond existing clone, refresh,
  install, uninstall, and delete flows.

## Approved Product Direction

The selected approach is a DB-authoritative catalog with explicit import and
refresh. Skill-manager will not silently discover new skills on startup just
because folders exist under the library root. Startup reads from SQLite. The
filesystem is scanned only when the user performs an explicit catalog-changing
operation such as importing a library, refreshing the library, or adding skills.

The first implementation keeps one loaded library at a time. If the database
contains more than one library row and no valid last-selected library is stored
in app configuration, startup asks the user which library to load. The main
browsing and install UI still works against one selected library, not a
combined multi-library view. When the user selects a library, the app persists
that choice as the last-selected library for the next startup.

## Architecture

The Electron main process owns persistence. The SQLite database lives under
Electron's app data directory via `app.getPath("userData")`, for example:

`<electron-user-data>/skill-manager.sqlite`

The app must also store app-level configuration next to the database, for
example:

`<electron-user-data>/skill-manager-config.json`

Version 1 app configuration stores only `lastSelectedLibraryId`. It is app
state, not catalog metadata, so it should stay outside the skill library folder
and outside the SQLite catalog tables. Tests and scripts must be able to
override these locations so automated tests do not write to a real user profile.

Add a focused database persistence module:

- `skill-manager/electron/skill-library-db.js`

This module exports the domain-facing `SkillLibraryDB` persistence interface
and a concrete `DBAdapter` implementation. It owns:

- opening the SQLite database
- initializing and upgrading schema
- reading and writing configured skill libraries
- reading, upserting, and deleting skills
- managing tags and skill-tag links
- wrapping import/refresh changes in transactions
- returning plain JavaScript records to the application layer

Model the filesystem discovery boundary as a class:

- `skill-manager/electron/skill-discovery.js`
- primary class: `SkillDiscovery`

`SkillDiscovery` should own skill folder discovery, `SKILL.md` metadata reading,
metadata parsing, source derivation, and duplicate/collapse rules. It should
split skill metadata handling into a pure parser and a file-backed reader:

- `parseSkillMetadata(markdown)` parses `SKILL.md` text into metadata such as
  `name` and `description`.
- `readSkillMetadata(skillMdPath)` reads a `SKILL.md` file and delegates to
  `parseSkillMetadata()`.

It should accept its filesystem dependency through the constructor so tests can
use a mock file reader/scanner where that keeps the test focused.

Model `skill-manager/electron/skill-library.js` as the domain catalog class:

- primary class: `SkillLibrary`

`SkillLibrary` should own catalog-level behavior and invariants:

- importing or refreshing skills from the filesystem when explicitly requested
- reading `SKILL.md` content
- applying discovered skill sets to the catalog transactionally through
  `SkillLibraryDB`
- rejecting unresolved duplicate names with structured domain details
- assigning normalized tags to cataloged skills
- resolving cataloged skills by app-facing name within an active library

`SkillLibrary` should receive its dependencies through the constructor,
including `SkillLibraryDB` and a `SkillDiscovery` instance. `skill-library.js`
should export the `SkillLibrary` class directly. Tests should instantiate
`SkillLibrary` directly with mocks.

Model active library selection explicitly:

- primary class: `ActiveSkillLibrary`

`ActiveSkillLibrary` represents the one library currently loaded by the app. It
contains the selected library id/path and exposes selected-library operations so
callers cannot accidentally mutate an arbitrary library when multiple library
rows exist.

Model install/copy behavior separately:

- primary class: `SkillInstaller`

`SkillInstaller` owns project/global install paths, copied-directory comparison,
install-state classification, force/blocked replacement rules, and safe removal
of installed copies. It is not the Add Skills repository-clone flow and should
not own catalog persistence.

Model repository-based Add Skills behavior separately:

- primary class: `SkillRepositoryImporter`

`SkillRepositoryImporter` owns cloning a skill repository into the active
library folder, discovering skills under only that cloned destination, asking the
catalog to add those discovered skills transactionally, and returning the
structured no-skills/duplicate failure details needed by the renderer.

Define narrow interfaces around persistence and filesystem reads so application
logic can be tested without a real database or real library folder. At minimum,
business logic should depend on `SkillLibraryDB` for catalog operations and a
file-scanning/skill-reading interface for filesystem discovery and `SKILL.md`
reads.

SQL and schema details should stay in `DBAdapter`. UI-facing snapshot assembly
should stay out of the domain catalog object and live in an application/view
model layer that combines catalog rows with live install and Git status.

## Data Model

Use these tables for version 1:

### `skill_libraries`

Stores configured skill libraries.

Required columns:

- `id`: SQLite primary key
- `local_path`: absolute path to the library folder
- `created_at`: timestamp
- `updated_at`: timestamp

Version 1 may contain multiple rows, but the app loads one selected library at a
time. Future metadata may be added as columns or as a separate table when a
concrete need appears.

### `skills`

Stores skills known to the active library catalog.

Required columns:

- `id`: SQLite primary key
- `library_id`: foreign key to `skill_libraries.id`
- `name`: app-facing skill identity and display name
- `local_path`: absolute path to the skill folder
- `description`: one-sentence description derived from `SKILL.md`
- `source`: source label shown by the UI, currently derived from the skill path
- `git_source_url`: source Git URL if available
- `created_at`: timestamp
- `updated_at`: timestamp

Constraints:

- `(library_id, name)` must be unique.

`skills.name` remains the operational skill identity. Do not add a separate
`skill_key` in this version.

### `tags`

Stores normalized tag names shared across the catalog.

Required columns:

- `id`: SQLite primary key
- `name`: normalized tag name

Constraints:

- `name` must be unique.

### `skill_tags`

Stores many-to-many skill/tag assignments.

Required columns:

- `skill_id`: foreign key to `skills.id`
- `tag_id`: foreign key to `tags.id`

Constraints:

- `(skill_id, tag_id)` must be unique.

## Catalog Behavior

### Startup

On startup, the Electron app:

1. opens the SQLite database,
2. initializes schema if needed,
3. reads app configuration from Electron user data,
4. reads configured library rows from SQLite,
5. if exactly one library exists, loads it and persists it as the
   last-selected library,
6. if multiple libraries exist and app configuration names a valid
   last-selected library, loads that library,
7. if multiple libraries exist and no valid last-selected library is available,
   shows a library-picker state instead of guessing,
8. after the user selects a library, persists the selected library id in app
   configuration,
9. after a library is selected, reads skills and tags for that library from
   SQLite,
10. builds the UI snapshot from DB rows plus live project/global install state.

Startup must not scan the library root for new skills.

If no library is configured, the app shows the existing unconfigured state.

If more than one library is configured, the app must not pick one implicitly.
It should show a library picker that lists configured paths and continue only
after the user chooses one.

If a library is configured but no skills have been imported, the app shows an
empty catalog state and offers the user an explicit import or refresh action.

### Set Library

Setting the library stores the chosen absolute local path in SQLite. It does not
write `~/.codex/local-skill-library.json` or `<library-root>/.skill-library-manager.json`.

Setting the library does not need to scan the folder automatically. The UI may
offer an immediate import/refresh action after the path is saved.

If the path is already present in `skill_libraries`, setting it selects that
existing row rather than creating a duplicate.

### Import Or Refresh Library

Import and refresh are explicit actions that reconcile the SQLite catalog with
the filesystem.

The workflow:

1. scan the configured library folder for folders containing `SKILL.md`,
2. parse `SKILL.md` frontmatter,
3. derive skill `name`, `description`, `local_path`, `source`, and available Git
   source metadata,
4. apply the existing duplicate-name, packaged-variant, and identical-content
   collapse behavior,
5. write the discovered catalog to SQLite in one transaction.

If unresolved duplicate skill names remain, the operation fails and leaves the
previous SQLite catalog unchanged.

On successful refresh, skills missing from the filesystem are removed from the
catalog. This is acceptable because refresh is an explicit user request to make
the database match the library folder.

### Add Skills

`Add Skills` continues to clone a Git repository into the active library folder.
After a successful clone, the app catalogs the skills found in the cloned repo.

This action should not rely on startup discovery. It must explicitly update the
SQLite catalog for the cloned content.

`Add Skills` must not perform a full library refresh. It should scan only the
newly cloned destination, apply the same metadata parsing and duplicate rules to
the added skills, and insert/update only those catalog rows. If the cloned repo
introduces an unresolved duplicate name against an existing DB skill, the action
fails fast and does not partially catalog the cloned skills.

If the cloned repo contains no catalogable skills, the app should tell the user
that the clone succeeded but no `SKILL.md` entries were found. It should then
ask whether to delete the cloned repo folder. Deletion happens only if the user
confirms; otherwise the cloned folder remains on disk and is not cataloged.

Duplicate-name failures must return structured details for the UI. At minimum,
the failure should include:

- duplicate skill name,
- existing DB skill id,
- existing DB skill local path,
- newly discovered skill local path.

The UI should show a clear failure message that names the duplicate skill and
shows which existing catalog skill blocked the add.

### Delete Library

Deleting a configured library removes that library row, its skills, and related
tag links from SQLite. It must not delete the library folder from disk.

Delete library fails fast when:

- the requested library id or path does not exist in SQLite,
- the loaded library is being deleted and the UI cannot transition to another
  configured library or the unconfigured state,
- a database transaction cannot remove the catalog rows cleanly.

If multiple libraries remain after deletion, the app should return to the
library picker. If none remain, it should return to the unconfigured state.

### Delete Library Skill

Deleting a library skill:

1. preserves the current safety checks that prevent deleting a skill that is
   enabled in the current project or installed globally,
2. removes the skill folder from disk,
3. deletes the skill row from SQLite,
4. deletes related `skill_tags` rows.

The operation must refuse to delete paths outside the configured library root.

### Tags

Tag edits write only to SQLite:

- normalize tags using the current app rules,
- upsert tag rows,
- replace the selected skill's `skill_tags` links,
- return updated tags and `allTags` to the UI.

Tag edits must not write `.skill-library-manager.json`.

### Read Markdown

`readSkillMarkdown(skillName)` reads the skill path from SQLite, then reads the
current `SKILL.md` content from disk.

If the DB row exists but the file is missing, the app should report a clear
error for that skill.

### Install, Uninstall, And Status

Project and global install behavior remains copy-based:

- project scope: `.agents/skills/<skill-name>`
- global scope: `~/.codex/skills/<skill-name>`

The app uses DB skill rows as the catalog input, then computes install state
from the live filesystem as it does today.

The UI-facing snapshot should preserve current fields where practical,
including:

- `libraryRoot`
- `projectRoot`
- `skills`
- `enabled`
- `conflicts`
- `globalEnabled`
- `globalConflicts`
- `allTags`
- count fields
- skill row fields such as `name`, `path`, `source`, `description`, `tags`,
  repo status fields, project install fields, and global install fields

## Manual Tag Migration Script

Add a one-time script:

- `skill-manager/scripts/migrate-json-tags-to-sqlite.js`

The script is intentionally narrow. It assumes the new SQLite database already
exists and the library's skills have already been imported by the Electron app.

Inputs:

- required path to an existing `.skill-library-manager.json`
- optional database path override for tests or manual recovery

Behavior:

1. read `skill_tags` from the provided JSON file,
2. normalize tags with the same rules as the app,
3. insert all unique normalized tags into `tags`,
4. for each JSON skill name that exists in the current active SQLite library,
   replace that skill's tag links in `skill_tags`,
5. ignore JSON skill names that are not found in SQLite,
6. print a summary containing:
   - JSON file path
   - skills updated
   - unique tags imported
   - missing skill names ignored

The script must not:

- read the old Codex pointer file,
- import library roots,
- scan skill folders,
- import skill rows,
- delete JSON files.

Manual migration flow:

1. run the new app,
2. set/import/refresh the existing library so SQLite contains the current
   skills,
3. run the migration script against the old `.skill-library-manager.json`,
4. refresh/restart the app and verify tags appear.

## Legacy Python CLI Cleanup

Remove the legacy Python CLI as part of this feature. The supported interface is
the Electron app.

Remove or obsolete:

- `skill-manager/scripts/skill-library.py`
- `skill-manager/scripts/skill_library_core.py`
- `skill-manager/scripts/skill_library_ui.py`
- documentation that instructs users to run the Python CLI
- tests or fixtures that exist only for the Python CLI, if any

Keep any logic that the Electron implementation still needs by moving it into
the Electron modules before deleting the Python files. Do not keep a parallel
Python implementation of SQLite catalog behavior.

## Error Handling And Fail-Fast Design

Database open, schema, and transaction failures should surface as clear
`SkillLibraryError` failures through the existing snapshot/action error path.

All catalog-changing operations should validate prerequisites before doing
destructive work or partial writes.

### Start App

Startup fails fast when the database cannot be opened, schema initialization
fails, or the schema version is unsupported. The UI should show a clear blocking
error rather than falling back to filesystem discovery.

If multiple libraries exist and app configuration does not name a valid
last-selected library, startup fails fast into a library-picker state. It must
not guess the active library from row order, previous JSON files, or filesystem
paths.

### Load Library

Loading a library fails fast when:

- the library row does not exist,
- the library path is missing or not a directory,
- skills or tags cannot be read from SQLite,
- required DB relationships are inconsistent.

The operation should not scan the filesystem to repair missing DB state.

### Refresh Library

Refresh fails fast when:

- no library is selected,
- the selected library path is missing or unreadable,
- discovery finds unresolved duplicate skill names,
- `SKILL.md` parsing or filesystem traversal hits an unrecoverable error,
- the database transaction cannot be committed.

Refresh must be transactional. If duplicate-name resolution fails, or if
database writes fail, the previous catalog remains intact.

### Add Skills

Add Skills fails fast when:

- no library is selected,
- the clone URL is empty or invalid for the supported clone flow,
- the destination already exists,
- `git clone` fails,
- the newly cloned destination contains no catalogable skills,
- the newly cloned destination introduces unresolved duplicate names,
- DB writes fail.

If cataloging the cloned destination fails after a successful clone, the app
should report that the clone exists on disk but was not cataloged. It should not
silently run a full refresh to mask the failure.

If the cataloging failure is specifically "no skills found", the renderer should
offer to delete the cloned repo folder. The backend delete action must remove
only the newly cloned destination path and must verify that path is inside the
selected library root before deleting it.

For duplicate-name failures, the error reported to the renderer must include
the existing catalog skill that caused the failure so the user can decide
whether to delete, rename, or ignore one of the duplicates.

### Delete Library

Delete library fails fast as described in the `Delete Library` section. The
operation removes only SQLite catalog data, not folders on disk.

### Delete Library Skill

Delete library skill fails fast when:

- no library is selected,
- the skill does not exist in SQLite,
- the skill is enabled in the current project,
- the skill is installed globally,
- the skill path is outside the selected library root,
- filesystem deletion fails,
- DB deletion fails.

If filesystem deletion succeeds but DB deletion fails, the app should report the
inconsistent state and require explicit refresh or repair. The implementation
plan should minimize this risk by validating DB write capability before deleting
from disk where practical.

Malformed or unreadable `SKILL.md` files should follow the current behavior
where possible: missing frontmatter is allowed, name falls back appropriately,
and missing description becomes `No description provided.`

Missing skill folders during normal startup should not silently remove database
rows. Startup can show an error/problem state for affected skills if needed.
Only explicit refresh removes missing skills from the catalog.

## Testing Expectations

At minimum, automated coverage should prove:

- setting a library stores or selects the corresponding library in SQLite,
- startup with multiple libraries asks the user to select one and does not load
  an arbitrary library,
- startup snapshot reads skills from SQLite without scanning newly added
  folders,
- explicit import/refresh discovers new skills,
- explicit refresh removes skills missing from disk,
- Add Skills catalogs only the newly cloned destination and does not perform a
  full library refresh,
- Add Skills duplicate-name failures report the existing DB skill path and the
  newly discovered duplicate path,
- Add Skills no-skill failures ask the user whether to delete the cloned repo
  folder and only delete it after confirmation,
- unresolved duplicate skill names fail refresh transactionally,
- tag saves update `tags` and `skill_tags`,
- `.skill-library-manager.json` is no longer written by tag saves,
- legacy Python CLI files and CLI documentation are removed,
- fail-fast branches are covered for startup, load library, refresh library,
  Add Skills, delete library, and delete library skill,
- project install, global install, copied-modified, conflict, read markdown, and
  Git status behavior continue to work from DB-backed skill rows.

Use mocks whenever they keep the test focused on the behavior under test:

- test workflow logic against a mock `SkillLibraryDB` instead of a real SQLite
  database,
- test filesystem-independent logic against a mock skill reader or library
  scanner,
- test tag-save workflow by asserting calls to `SkillLibraryDB` rather than
  writing a real database,
- reserve real SQLite tests for a thin `DBAdapter` smoke suite:
  prove our SQL statements map to the `SkillLibraryDB` interface and that transaction
  rollback is wired correctly; do not write tests whose only purpose is proving
  SQLite enforces SQL features,
- reserve real filesystem tests for scanner/import behavior, copied install
  behavior, and delete safety checks.

Existing `node:test` coverage should remain the primary backend validation path.
The current direct command is:

`node --test tests/skill-library.test.js`

The implementation may add a proper `npm test` script as a separate tooling
improvement if desired, but this spec does not require it.

## Documentation Expectations

Remove `skill-manager/SKILL.md`. It describes the imported app folder as an
installable skill and currently documents the legacy Python CLI. After this
feature, the app should be documented as an application, not as a skill.

Because the root `AGENTS.md` points to `docs/agent-docs/agent-architecture-map.md`
and that file is currently missing, implementation should repair the
agent-facing architecture documentation as the first execution step. The new
docs should identify the Electron SQLite catalog as the skill-manager metadata
source of truth and route future agents to the storage and workflow modules.

## Open Decisions Deferred

- Exact SQLite driver/package choice.
- Exact filename for the SQLite database.
- Exact UI label for the explicit import/refresh action.
