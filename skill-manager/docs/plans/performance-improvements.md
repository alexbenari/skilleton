# Skill Library Manager Performance Improvements

## Goal

Make the app feel instant for common UI actions by separating cheap state updates from expensive library and git work.

## Current Bottleneck

`statusSnapshot()` is used for startup, refresh, project switching, and tag saves. It currently performs all of these synchronously:

- recursive skill discovery
- git repo root detection per discovered skill
- git upstream/ahead/behind checks per repo
- project install/conflict state calculation
- global install/conflict state calculation

Measured on `C:\dev\skills-main`, full snapshot refresh takes about 5-6 seconds. Tag writes themselves take about 100 ms, but the UI pays the full snapshot cost afterward.

## Planned Changes

1. Async git checks
   - Initial render should not block on git update status.
   - Skill cards should start with a grey repo indicator.
   - Git status checks should run in the background.
   - Cards update to green/yellow/red when each repo result arrives.
   - Repo status should be cached by repo root.

2. Project switching should be project-only
   - Reuse cached library discovery results.
   - Recalculate only:
     - project skill installed state
     - project conflict state
   - Do not redo recursive discovery.
   - Do not redo git checks.

3. Tag saves should be local updates
   - Saving tags should update `.skill-library-manager.json`.
   - Update the affected skill row in memory/UI.
   - Recompute `allTags` locally.
   - Do not call full `statusSnapshot()`.

4. Explicit refresh keeps doing full work
   - The `Refresh` button can invalidate caches.
   - It may trigger discovery and async repo checks.
   - UI should remain usable while checks are pending.

## Suggested Backend Shape

- `loadLibrarySnapshot({ includeGit: false })`
- `getProjectState(projectRoot, cachedSkills)`
- `setSkillTags(skillName, tags)` returns only `{ skill, tags, allTags }`
- `refreshRepoStatuses()` emits or returns repo-status patches by skill/repo

## UI Behavior

- Startup:
  - Render skills as soon as discovery and install-state checks finish.
  - Show grey repo dots for pending git status.
  - Update repo dots asynchronously.

- Project switch:
  - Keep skill list and tags visible.
  - Recompute install/conflict badges only.

- Tag save:
  - Close inline tag editor immediately after save.
  - Update tag chips on the current card and filter chips.
  - Do not show the loading overlay.
