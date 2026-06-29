# Skill Manager UI Redesign Spec

Date: 2026-04-22

## Purpose

Redesign the Electron app UI to reduce vertical waste, improve scanability, and
keep the skill grid as the primary working surface without changing the current
Electron + plain HTML/CSS/JS architecture.

## Goals

- Reduce the amount of scrolling before the user reaches the skill list.
- Make the app feel more like a fast operational tool and less like a settings
  page.
- Keep all skills visible by default while prioritizing currently enabled repo
  skills.
- Preserve the current loading model at startup.
- Simplify card actions without hiding important primary install actions.

## Non-Goals

- No framework migration.
- No redesign of the underlying skill-management logic or Electron IPC model.
- No change to startup behavior from blocking load to progressive hydration.
- No shift from card browsing to a dense table or list view in this iteration.

## Approved Product Direction

The redesign will use a command-strip shell with smart skill cards.

The top of the app will become a thin command strip instead of the current tall
board. The main skill grid will remain the primary surface. Secondary context
such as enabled-skill summaries and global installs will move into a right-side
panel so the main grid stays visually stable.

## Shell Layout

After startup completes, the app shell will have four layers:

1. A compact command strip.
2. A single-line summary row.
3. A row of filter chips.
4. The skill card grid.

The command strip will contain:

- A short `Library` label for the configured library root.
- A short `Project` label for the currently selected project.
- Search input.
- `Add Skills` action.
- A small always-visible status area.

The strip will prefer short folder labels instead of full absolute paths. Full
paths will be available through hover states, detail views, or the side panel.

## Summary Row

The current separate stat boxes will be replaced by one compact summary line,
for example:

`142 skills • 4 enabled • 2 global • 1 update`

This row is informational only and should not consume card-like visual weight.

## Filter Model

The UI will keep text search and add quick filter chips below the strip.

Initial chip set:

- `Enabled`
- `Global`
- `Needs Update`
- `Conflicts`

Additional chips may be added later if they map cleanly to existing state, but
the first redesign pass should keep the chip set small and obvious.

## Side Panel

A right-side panel will replace the current permanently visible sections for:

- `Enabled Here`
- `Installed Globally`
- expanded contextual details such as full paths when needed

Reasoning:

- It preserves a stable main grid.
- It avoids vertical reflow.
- It leaves room for future details or quick actions without re-expanding the
  top layout.

## Skill Grid

The main content remains a responsive grid of skill cards.

Default behavior:

- Show all available skills.
- Sort enabled-in-repo skills first.
- Keep the rest of the library visible and searchable.

The redesign should preserve current card density or improve it, but should not
reintroduce tall cards through decorative containers or duplicated metadata.

## Skill Card Structure

Each card will contain:

- repo status dot
- optional repo arrow
- skill name
- short description
- primary install/uninstall actions in the card body
- small edge actions for secondary operations

Primary actions remain full buttons in the body because they represent the main
task the user performs on a skill.

Secondary edge actions:

- `↗` for repo link when available
- `View`
- `Update` only when repo status is yellow
- `Delete`

Secondary metadata such as full local path or conflict target should be removed
from the default always-visible card body unless needed to explain a current
problem state.

## Status And Feedback

The large `Status` card will be removed.

The redesign will keep a small visible status area in the shell. It should show
short action feedback and refresh messages without dominating the layout.

Behavior:

- On user action, the status area should update immediately.
- Success and error feedback should stay anchored in the shell.
- Avoid popups for routine success/error messaging.

## Loading Behavior

Startup will keep the current blocking loading overlay.

This is an explicit approved choice. The redesign should improve how the loaded
state looks, but should not replace startup with progressive card hydration in
this iteration.

## Accessibility And Interaction Expectations

- Preserve keyboard access for major controls.
- Keep tooltips or hover affordances supplemental, not the only way to discover
  critical actions.
- Maintain clear visual distinction between primary install actions and smaller
  secondary controls.
- Do not rely on color alone to communicate actionable warning states such as
  `Needs Update`.

## Affected Areas

Likely implementation surface:

- `ui/index.html`
- `ui/renderer.js`

If needed, minor adjustments may be made in Electron bridge code only to support
new UI state presentation, not to change core business logic.

## Testing Expectations

The redesign should be validated at minimum for:

- startup load flow
- repo selection flow
- search and chip filtering behavior
- enabled-skill sorting
- side-panel open and close behavior
- primary install and uninstall actions
- update button visibility for yellow repo status
- status-area messaging after actions
- desktop layout and narrow/mobile-width layout behavior

## Open Decisions Deferred

These were intentionally deferred and are not blockers for the redesign spec:

- final typography refinements
- motion and micro-interaction polish
- exact visual styling of chips and panel
- whether additional chips beyond the initial set are worthwhile
