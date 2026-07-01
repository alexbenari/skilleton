# Add Skills Temp Import Spec

Date: 2026-07-01

## Purpose

Change `Add Skills` so importing a Git repo into a skill library no longer
creates a nested Git repo inside the library. The app should clone the source
repo into a temporary folder, discover skills there, then copy the full repo
contents into the active library as plain files without `.git`.

This allows the active library to live safely inside the `skilleton` monorepo
while preserving the current repo-URL-driven import workflow.

## Goals

- Keep `Add Skills` as a repo-URL-based workflow.
- Avoid creating nested Git repos under the active library root.
- Preserve the current behavior that `Add Skills` catalogs only the imported
  repo, not the whole library.
- Preserve the current duplicate-name checks and `SKILL.md` discovery rules.
- Copy the full imported repo tree into the library, excluding `.git`.
- Auto-delete the temporary clone on success and on handled failure paths.
- Store enough Git provenance now to support a later update-check feature.
- Keep manual library discovery explicit: copied local folders are discovered
  only after an explicit library refresh, not on startup.

## Non-Goals

- No local-folder import flow in `Add Skills`.
- No update-preview or update-apply feature in this spec.
- No selective copy of only skill folders or only `scripts/` and
  `references/`.
- No automatic startup rescan of the library root.
- No repo-subtree-based import workflow.
- No new UI for comparing upstream changes yet.

## Approved Product Direction

`Add Skills` remains a Git-repo import feature, but the repo clone becomes a
temporary implementation detail instead of the lasting on-disk shape inside the
library.

The selected import model is:

1. clone repo into a temp folder outside the library root,
2. discover skills only under that temp clone,
3. validate the import against the current catalog,
4. copy the full repo contents into `libraryRoot/<repoName>` excluding `.git`,
5. catalog the copied skills from their final library paths,
6. delete the temp clone.

The resulting library contents are plain files owned by the library folder, not
live nested repos.


## Current Problem

The current implementation in
`skill-manager/electron/skill-repository-importer.js` clones directly into the
active library root. When the library root lives inside a Git repo such as
`D:\tmp\dev\skilleton\skills`, this creates nested `.git` directories under the
monorepo. That makes outer-repo Git behavior awkward and violates the desired
library shape.

## Architecture

### Existing module responsibilities to preserve

- `skill-manager/electron/skill-repository-importer.js`
  owns the `Add Skills` workflow.
- `skill-manager/electron/skill-discovery.js`
  owns discovery, `SKILL.md` parsing, source derivation, and duplicate
  collapse rules.
- `skill-manager/electron/skill-library-db.js`
  owns catalog persistence.
- `skill-manager/electron/active-skill-library.js`
  remains the orchestration boundary used by IPC.
- `skill-manager/electron/main.js`,
  `skill-manager/electron/preload.js`,
  and `skill-manager/ui/renderer.js`
  remain thin UI and bridge layers.

### New importer workflow

`SkillRepositoryImporter` should change from "clone into library and catalog the
clone" to "temp clone, copy, then catalog the copied destination."

The importer should own:

- creating a temporary working directory outside the active library root,
- cloning the repo there,
- reading Git provenance from the temp clone,
- discovering skills under the temp clone only,
- validating duplicate-name conflicts before copying into the library,
- copying the full repo tree into the final library destination while excluding
  `.git`,
- translating discovered temp-clone skill paths into final library paths,
- cataloging only the copied skills,
- cleaning up the temp clone in success and handled failure cases.

The importer should not:

- perform a full library refresh,
- silently leave temp clones behind during normal handled failures,
- change startup behavior,
- require the renderer to reason about temp folders.

## Data Model

The existing `skills` table already stores:

- `git_source_url`

This spec adds two nullable provenance columns:

- `git_tracked_ref`
- `git_imported_revision`

Definitions:

- `git_tracked_ref`: the ref the import should conceptually track later, such
  as the default branch name when it can be determined.
- `git_imported_revision`: the imported commit SHA recorded from the temp clone
  at import time.

Version 1 of this feature stores provenance per skill row rather than adding a
new repo-import table. Repeating repo-level provenance across skills from the
same imported repo is acceptable in this iteration because it keeps the schema
change small and supports the planned update feature later.

If a skill enters the catalog through manual library refresh rather than
`Add Skills`, these fields may remain `NULL`.

## Import Workflow

### User flow

1. User selects an active library.
2. User clicks `Add Skills`.
3. User pastes a repo URL.
4. App imports the repo into the library without creating a nested `.git`
   folder there.
5. App refreshes the visible catalog state from the updated DB snapshot.

### Backend flow

1. Normalize and validate the repo URL using the current importer rules.
2. Derive `repoName` from the repo URL.
3. Compute the final library destination as `path.join(libraryRoot, repoName)`.
4. Fail fast if the final destination already exists.
5. Create a unique temp parent directory outside the library root.
6. Clone the repo into that temp location.
7. Read Git provenance from the temp clone:
   - imported revision via `HEAD`
   - tracked ref when it can be resolved cheaply and reliably
8. Discover skills under the temp clone only.
9. If discovery reports unresolved collisions within the imported repo, fail the
   import using the existing `SkillDiscovery` behavior.
10. If no skills are found, delete the temp clone and return a structured
    `no-skills-found` result.
11. Check discovered skill names against existing DB rows for the active
    library.
12. If a duplicate-name conflict exists, delete the temp clone and return a
    structured `duplicate-name` result without writing to the library root.
13. Copy the full temp-clone tree into the final library destination while
    excluding `.git`.
14. Translate discovered skill local paths from temp paths to final destination
    paths.
15. Upsert those copied skills into the DB with final `localPath`,
    `gitSourceUrl`, `gitTrackedRef`, and `gitImportedRevision`.
16. Delete the temp clone.
17. Return a structured `cataloged` result naming the imported skills and the
    final destination.

## Copy Rules

The importer must copy the full repo tree into the library destination except
for `.git`.

Rules:

- Exclude the `.git` directory entirely.
- Preserve the relative file and folder structure of everything else.
- Preserve nested skill packaging layouts such as `.agents/skills/...`,
  `.github/skills/...`, and other discovery-supported shapes.
- Copy text and binary files alike.
- Do not try to infer a smaller subset of "skill-relevant" files in this
  iteration.

Rationale:

- It preserves the current repo import shape closely.
- It avoids fragile heuristics about what a skill repo "really needs."
- It keeps the future update feature simpler because imported files map cleanly
  to upstream repo paths.

## Discovery And Path Translation

Discovery should still run against the temp clone so the importer can fail
before writing into the library when there are no skills, when discovery itself
reports unresolved collisions inside the imported repo, or when the imported
skill names later conflict with the existing library catalog.

However, cataloged `localPath` values must point to the copied destination in
the library, not to the temp clone.

The importer therefore needs a deterministic path translation step:

- temp clone root: `<tempParent>/<repoName>`
- final destination: `<libraryRoot>/<repoName>`
- discovered skill path:
  `<tempParent>/<repoName>/<relativeSkillPath>`
- final catalog path:
  `<libraryRoot>/<repoName>/<relativeSkillPath>`

The DB must never retain temp-clone paths.

## Error Handling And Fail-Fast Design

### Add Skills fails fast when

- no library is selected,
- repo URL is empty or invalid for the supported clone flow,
- final destination already exists in the library root,
- temp directory creation fails,
- `git clone` fails,
- Git provenance lookup fails in a way the importer chooses to treat as fatal,
- discovery finds unresolved duplicate names within the imported repo,
- no catalogable skills are found,
- imported skills conflict by name with existing cataloged skills,
- copy into the final library destination fails,
- DB writes fail.

### Cleanup expectations

The temp clone must be deleted after:

- successful import,
- `no-skills-found`,
- duplicate-name failure,
- handled copy or DB failure where cleanup can still safely run.

If cleanup itself fails, the error reported to the UI should mention that a temp
folder may remain on disk.

### Final destination safety

The importer must not remove or overwrite an existing destination folder.
`Add Skills` should continue to fail fast when `libraryRoot/<repoName>` already
exists.

### No partial cataloging

If copying into the library fails or DB writes fail, the importer must not leave
partially cataloged skill rows behind.

If copying into the library created a partial destination before failure, the
implementation should clean it up where practical before returning the error.

## UI And IPC Behavior

The visible workflow remains:

- click `Add Skills`
- paste repo URL
- wait for import result

Renderer copy should change to match the new backend behavior:

- success should say the repo was imported into the library, not cloned into the
  library as a live repo
- `no-skills-found` should explain that no skills were found and that no repo
  folder was added to the library
- duplicate-name failure should explain that nothing was added to the library

The old cleanup confirmation for `no-skills-found` should be removed, because
the temp clone is auto-deleted by the backend.

IPC result shapes may evolve, but at minimum should preserve these structured
statuses:

- `cataloged`
- `no-skills-found`
- `duplicate-name`

For duplicate-name failures, the result should include:

- duplicate skill name,
- existing DB skill id,
- existing DB skill local path,
- incoming skill path information meaningful after temp-clone cleanup

Because the temp clone is deleted, the incoming path detail should not rely only
on a temp path. The response should include either:

- the would-be final destination path, or
- the imported repo-relative skill path,

so the UI can explain what would have been copied.

## Provenance Requirements

On successful import, each imported skill row should store:

- `gitSourceUrl`
- `gitTrackedRef`
- `gitImportedRevision`

These values are for future update checking and diff reporting. This spec does
not yet require any UI that exposes them directly.

## Manual Local Copies

This spec does not add a local-folder import workflow.

If a user manually copies a local skill folder or repo contents into the library
root themselves:

- the app must not auto-discover it on startup,
- the app must discover it when the user explicitly runs library refresh,
- refresh continues to be the supported way to reconcile such manual filesystem
  changes into the DB catalog.

## Testing Expectations

At minimum, automated coverage should prove:

- `Add Skills` clones to a temp location outside the library root.
- Successful import copies the full repo tree into `libraryRoot/<repoName>`.
- Successful import excludes `.git` from the copied destination.
- Discovery still runs only against the imported repo, not the whole library.
- Cataloged skill `localPath` values point to the final copied destination, not
  to temp paths.
- `git_imported_revision` is stored for imported skills.
- `git_tracked_ref` is stored when available.
- `no-skills-found` leaves no destination in the library and auto-deletes the
  temp clone.
- duplicate-name failure leaves no destination in the library and auto-deletes
  the temp clone.
- duplicate-name failure reports structured existing/incoming details.
- copy failure does not partially catalog skills.
- DB failure does not leave partially cataloged skills.
- existing manual refresh behavior still discovers library folders only when the
  user explicitly refreshes.

Primary test targets:

- `skill-manager/tests/skill-repository-importer.test.js`
- any DB adapter tests needed for new provenance columns
- any snapshot or IPC tests touched by changed result messaging

## Likely Files Touched

- `skill-manager/electron/skill-repository-importer.js`
- `skill-manager/electron/skill-library-db.js`
- `skill-manager/electron/active-skill-library.js`
- `skill-manager/electron/main.js`
- `skill-manager/electron/preload.js`
- `skill-manager/ui/renderer.js`
- `skill-manager/tests/skill-repository-importer.test.js`
- tests covering DB schema and upsert behavior

## Deferred Follow-Up

Future update work can build on the stored provenance to:

- fetch remote refs in a temp clone,
- compare the stored imported revision to upstream,
- report files added, removed, or changed,
- detect local modifications in copied library files before overwrite.

That future work is intentionally out of scope for this spec.
