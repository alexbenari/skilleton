# Skill Install Copy Design

Date: 2026-06-29

## Purpose

Change skill installation so project-local and global installs create real
directory copies instead of links to the library.

## Goals

- Replace link-based installs with copied skill directories.
- Keep the library skill as the source used for new installs and refreshes.
- Allow re-adding a skill to refresh an unchanged installed copy.
- Block overwrite when an installed copy has local modifications unless the
  user explicitly chooses to replace it.
- Migrate legacy junction or symlink installs to copied directories on the next
  add/install action.

## Non-Goals

- No automatic background syncing from library skills into installed copies.
- No new metadata manifest inside installed skills.
- No central registry tracking installed copy provenance outside the filesystem.
- No change to skill discovery inside the library root.

## Approved Product Direction

The install model will become copy-based for both scopes:

- project scope: `.agents/skills/<skill-name>`
- global scope: `~/.codex/skills/<skill-name>`

Installed skills become independent snapshots. The library version is used only
when the user performs add/install again.

## Install Behavior

### First install

If the target path does not exist, the app copies the entire skill directory
from the library into the target scope.

### Re-add/install of an unchanged copied skill

If the target already exists as a real copied directory and its contents match
the current library skill recursively, add/install replaces it silently as a
refresh from the library.

### Re-add/install of a modified copied skill

If the target already exists as a real copied directory and its contents differ
from the current library skill recursively, add/install stops and reports a
conflict. The UI then offers two choices:

- copy anyway
- stop

If the user chooses copy anyway, the existing installed copy is removed and a
fresh copy is written from the library.

### Re-add/install of a legacy link

If the target exists as a junction or symlink that resolves to the library
skill, add/install removes the link and replaces it with a real copied
directory without prompting.

### Foreign target

If the target exists but is neither a recognized installed skill copy nor a
legacy link to the library skill, the backend treats it as a conflict and
requires explicit replacement approval before removing it.

## Remove Behavior

Disable and uninstall remain destructive within the install scope only:

- disabling a project skill removes the copied directory from
  `.agents/skills/<skill-name>`
- uninstalling a global skill removes the copied directory from
  `~/.codex/skills/<skill-name>`

These actions must never remove or modify the library source skill.

## Comparison Model

The overwrite guard uses recursive filesystem comparison.

Rules:

- compare the full relative file and folder set in source and installed copy
- compare file contents by bytes, not timestamps
- treat any added, removed, or changed file as a modification
- apply the same rule to text files, scripts, and binary assets
- ignore nothing by default

This comparison is used to distinguish an unchanged installed copy from a
modified one before replacing it.

## State Model

The existing install detection is too coarse for copy semantics. The backend
should use a richer state helper that distinguishes at least:

- missing
- copied-match
- copied-modified
- linked-match
- foreign-conflict

This state is used by project and global install flows to decide whether to:

- copy immediately
- refresh silently
- migrate a legacy link
- block and ask for explicit replacement

For general status display, a copied directory containing a valid `SKILL.md`
still counts as installed in that scope.

## Backend Changes

Primary implementation remains in `electron/skill-library.js`.

Required backend changes:

- replace junction creation with recursive directory copy for project install
- replace junction creation with recursive directory copy for global install
- add a recursive tree comparison helper
- add install-state detection that can classify copied, linked, and conflicting
  targets
- update enable/install flows to return structured results for refresh,
  migration, or blocked-modified cases
- keep remove flows scoped to deleting the installed target only

The current `link_mode: "junction"` config value becomes compatibility baggage
rather than an active behavior switch. Existing config reads may stay in place
temporarily, but install behavior should no longer depend on that field.

## IPC And UI Changes

The UI should keep the current action layout and stay close to the existing
interaction model.

Expected UI changes:

- keep the main actions in place for repo and global install
- update wording from link-oriented language to copy-oriented language where
  needed
- when the backend reports a modified installed copy, show a confirmation that
  explains the local copy differs from the library and asks whether to replace
  it
- if the user declines, stop without changing files
- if the backend reports a legacy link migration or a refresh, show a normal
  success message

The renderer should not try to guess modification state itself. It should react
to structured backend results and only ask for confirmation when the backend has
identified a replaceable conflict.

## API Response Shape

`enableSkill()` and `installGlobalSkill()` should return structured statuses
instead of relying on path conflict exceptions for normal copied-install flows.

Representative statuses:

- `enabled`
- `refreshed`
- `migrated-link`
- `blocked-modified`
- `already-installed-equivalent`

Exact names can change during implementation, but the API must distinguish
normal success, silent refresh, legacy migration, and user-confirmable
overwrite conflicts.

Unexpected filesystem failures should still surface as errors.

## Testing Expectations

Tests should move from link-focused assertions to copy-focused assertions.

Required coverage:

- project enable copies the full skill directory
- global install copies the full skill directory
- copied installs count as installed in status snapshots
- re-add/install refreshes an unchanged copied skill
- re-add/install of a modified copied skill is blocked without replacement
  approval
- force replace overwrites a modified copied skill
- re-add/install of a legacy junction or symlink replaces it with a real copied
  directory
- disable and uninstall remove only the installed copy
- foreign targets are treated as conflicts instead of silently accepted
- tree comparison catches nested additions, deletions, content changes, and
  binary differences

Existing tests that assert junction creation as the steady-state behavior should
be rewritten. Tests that cover reading legacy config or detecting legacy links
should remain where they serve migration compatibility.

## Risks And Constraints

- Recursive comparison adds filesystem work during repeated installs, but this
  is acceptable at the expected skill size and keeps the design free of hidden
  metadata.
- Force replace is destructive to local edits inside the installed copy, so the
  confirmation path must be explicit and narrowly triggered.
- Legacy installs may exist as symlinks or junctions, so migration logic must
  use `lstat` plus target resolution rather than assuming a normal directory.

## Implementation Boundaries

Likely touched files:

- `electron/skill-library.js`
- `electron/main.js`
- `electron/preload.js`
- `ui/renderer.js`
- tests covering install, uninstall, and snapshot behavior

No framework or architecture change is required for this feature.
