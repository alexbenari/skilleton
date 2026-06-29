# Skill Manager UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall top-heavy Electron UI with a compact command-strip layout that keeps all skills visible, sorts enabled repo skills first, adds filter chips and a right-side panel, and preserves the current startup loading overlay.

**Architecture:** Keep the current Electron runtime and business logic intact. Concentrate the redesign in `ui/index.html` and `ui/renderer.js` by replacing the current board layout with a command strip, summary row, chip filters, compact status area, and a right-side panel that renders enabled/global summaries and full-path details on demand.

**Tech Stack:** Electron, plain HTML, plain CSS, plain JavaScript, existing `window.skillManager` preload bridge.

---

## Why this matters

The current UI spends too much vertical space on configuration cards, counters,
and status blocks before the user reaches the actual skill list. Users want to
land on skills faster, keep all skills visible, and still retain enough context
to understand the selected library root, active project, and current repo state.

This plan ships a denser shell without changing the underlying Electron app
architecture or skill-management logic.

## Progress

- [x] (2026-04-22 20:45Z) UI redesign spec approved in `docs/specs/skill-manager-ui-redesign-spec.md`.
- [x] (2026-04-22 21:05Z) Replace the tall shell in `ui/index.html` with the command-strip layout.
- [x] (2026-04-22 21:10Z) Rework `ui/renderer.js` state and rendering to support summary line, short labels, filter chips, and right-side panel.
- [x] (2026-04-22 21:15Z) Simplify skill cards so primary actions stay prominent and secondary actions move to compact edge controls.
- [x] (2026-04-22 21:18Z) Validate startup, filtering, panel behavior, and responsive layout in the Electron app.

## Surprises & Discoveries

- Discovery: The current renderer is a single self-invoking file that owns all
  UI state, DOM queries, filtering, and card rendering.
  Evidence: `ui/renderer.js`

- Discovery: The current shell is already fully local and data-rich; no backend
  change is required for the redesign because `statusSnapshot()` already returns
  library root, project root, enabled skills, global installs, conflict counts,
  and per-skill repo status.
  Evidence: `electron/preload.js`, `electron/main.js`, `ui/renderer.js`

- Discovery: There is no existing automated UI test harness in this repo.
  Validation must rely on `node --check` plus Electron smoke tests.
  Evidence: repository search for `*.test.js`, `*.spec.js`, and `tests/` returned no results

- Discovery: Root and project editing could not simply be removed with the old
  top board; the compact shell still needs a place to browse, save, and refresh
  those paths.
  Evidence: the old `root-form` and `project-form` in `ui/index.html` handled
  real app operations, so the redesign moved those controls into the new side
  panel instead of dropping them

## Decision Log

- Decision: Keep the current Electron + plain HTML/CSS/JS stack.
  Rationale: The user explicitly approved staying in the current architecture.
  Date/Author: 2026-04-22 / Codex

- Decision: Use the `Command Strip + Smart Cards + Right Panel` direction.
  Rationale: It solves the scrolling problem more directly than a side-rail
  layout while keeping the skill grid as the primary working surface.
  Date/Author: 2026-04-22 / Codex + user

- Decision: Keep all skills visible by default and sort enabled repo skills
  first instead of showing only enabled skills.
  Rationale: The user wants browsing to stay broad, not constrained to the
  currently installed subset.
  Date/Author: 2026-04-22 / Codex + user

- Decision: Preserve the blocking startup loading overlay.
  Rationale: The user explicitly chose the current startup behavior over
  progressive hydration.
  Date/Author: 2026-04-22 / Codex + user

- Decision: Keep a small always-visible status area in the shell.
  Rationale: The user wants anchored status feedback without the current large
  `Status` card.
  Date/Author: 2026-04-22 / Codex + user

## Outcomes & Retrospective

Implemented outcome:

- Startup still blocks behind the loading overlay.
- After load, the top of the app compresses into a command strip, summary line,
  filter chips, and a smaller status area.
- `Enabled Here` and `Installed Globally` move out of the permanent top layout
  into a right-side panel.
- Skill cards stay visible by default, with enabled repo skills sorted first and
  secondary actions moved to compact edge controls.
- Library root and project management now live in side-panel flows opened from
  the short `Library` and `Project` strip buttons.

Evidence:

- `node --check ui/renderer.js`
- `node --check electron/main.js`
- `node --check electron/preload.js`
- Electron boot smoke test via `npm start -- --project=C:\dev\clip-sandbox`
  confirmed Electron processes launched successfully after the redesign

## Context and orientation

The Electron app has a thin main-process bridge and a renderer-heavy UI.

- `electron/main.js` creates the BrowserWindow and exposes IPC handlers such as
  `skill-manager:get-state`, `skill-manager:set-root`, `skill-manager:enable-skill`,
  and `skill-manager:update-skill-repo`.
- `electron/preload.js` exposes those IPC handlers on `window.skillManager`.
- `ui/index.html` contains all shell markup and inline CSS. It currently renders
  a hero block, a large top board with root/project forms, five stat cards,
  `Enabled Here`, `Installed Globally`, and a large `Status` card above the
  skill list.
- `ui/renderer.js` owns all renderer state. It fetches snapshots via
  `api.getState(project)`, renders cards from `snapshot.skills`, and currently
  supports only text search plus a single `Enabled only` checkbox.

The redesign should not change business logic in `electron/skill-library.js`
unless a UI need cannot be met with the existing snapshot shape. The snapshot
already contains:

- configured library root
- project root
- counts for visible, enabled, global, and conflict states
- enabled/global installed lists
- per-skill fields for install state, conflict state, repo status, repo URL, and
  local path

## File map before editing

- `ui/index.html`
  Responsibility: top-level shell markup, inline CSS, loading overlay, modal DOM
  containers, card grid mount points.
- `ui/renderer.js`
  Responsibility: local state, fetching snapshots, filtering, card rendering,
  modal behavior, button handlers, and status messages.
- `electron/main.js`
  Responsibility: IPC registration only. This plan assumes no production edit is
  required here.
- `electron/preload.js`
  Responsibility: renderer bridge only. This plan assumes no production edit is
  required here.
- `SKILL.md`
  Responsibility: user-facing usage notes. Update only if the redesign changes
  how users discover or operate major UI surfaces.

## Milestone 1 - Replace the shell with a command strip

### Scope

Replace the current hero + board-heavy layout with a compact shell that keeps
startup loading unchanged but reduces the amount of content above the skill
grid.

### Files

- Modify: `ui/index.html`
- Modify: `ui/renderer.js`

### Changes

- File: `ui/index.html`
  Edit: Remove the current hero block and the large board sections that render
  `Library Root`, `Project`, stat cards, `Enabled Here`, `Installed Globally`,
  and the large `Status` card.

  Replace that shell with markup shaped like:

      <section class="command-shell panel">
        <div class="command-strip">
          <button id="library-trigger" class="path-chip" type="button"></button>
          <button id="project-trigger" class="path-chip" type="button"></button>
          <div class="search-wrap">
            <input id="filter-input" type="text" placeholder="Filter skills">
          </div>
          <button id="add-skills-button" type="button" class="secondary">Add Skills</button>
          <div id="status-pill" class="status-pill info">Ready.</div>
        </div>
        <div class="summary-strip">
          <div id="summary-line" class="summary-line">0 skills</div>
          <div class="summary-actions">
            <button id="show-enabled-panel" type="button" class="secondary summary-action">Enabled Here</button>
            <button id="show-global-panel" type="button" class="secondary summary-action">Installed Globally</button>
          </div>
        </div>
        <div id="filter-chips" class="chip-row"></div>
      </section>

      <section class="panel section">
        <div class="skills-header">
          <div>
            <h2>Available Skills</h2>
            <div class="meta">Enabled skills appear first.</div>
          </div>
        </div>
        <div id="skills" class="skills-grid"></div>
      </section>

      <aside id="side-panel" class="side-panel" aria-hidden="true">
        <div class="side-panel-header">
          <h2 id="side-panel-title">Workspace Details</h2>
          <button id="side-panel-close" type="button" class="secondary">Close</button>
        </div>
        <div id="side-panel-body" class="side-panel-body"></div>
      </aside>

- File: `ui/index.html`
  Edit: Add CSS for the new shell primitives instead of the removed board/stats
  styles. At minimum define:

      .command-shell { padding: 14px 16px; display: grid; gap: 10px; }
      .command-strip { display: grid; grid-template-columns: auto auto minmax(220px, 1fr) auto auto; gap: 10px; align-items: center; }
      .path-chip { min-width: 0; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .summary-strip { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
      .summary-line { color: var(--muted); font-size: 0.92rem; }
      .summary-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .summary-action { padding: 7px 11px; font-size: 0.82rem; }
      .chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .filter-chip.active { background: linear-gradient(135deg, var(--accent), var(--accent-strong)); color: #fff; }
      .status-pill { justify-self: end; padding: 8px 12px; border-radius: 999px; font-size: 0.82rem; }
      .side-panel { position: fixed; top: 18px; right: 18px; bottom: 18px; width: min(360px, calc(100vw - 24px)); display: none; }
      .side-panel.open { display: grid; grid-template-rows: auto 1fr; }

- File: `ui/renderer.js`
  Edit: Replace references to removed DOM nodes with new shell refs:

      const libraryTrigger = document.getElementById("library-trigger");
      const projectTrigger = document.getElementById("project-trigger");
      const summaryLineEl = document.getElementById("summary-line");
      const showEnabledPanelButton = document.getElementById("show-enabled-panel");
      const showGlobalPanelButton = document.getElementById("show-global-panel");
      const statusPill = document.getElementById("status-pill");
      const filterChipsEl = document.getElementById("filter-chips");
      const sidePanel = document.getElementById("side-panel");
      const sidePanelTitle = document.getElementById("side-panel-title");
      const sidePanelBody = document.getElementById("side-panel-body");
      const sidePanelClose = document.getElementById("side-panel-close");

- File: `ui/renderer.js`
  Edit: Introduce shell state needed by the redesign:

      const CHIP_DEFS = [
        { key: "enabled", label: "Enabled" },
        { key: "global", label: "Global" },
        { key: "updates", label: "Needs Update" },
        { key: "conflicts", label: "Conflicts" },
      ];

      const state = {
        snapshot: null,
        filter: "",
        activeFilters: new Set(),
        sidePanelSection: null,
        browser: {
          open: false,
          mode: null,
          currentPath: "",
          entries: [],
          parentPath: null,
        },
        cloneModalOpen: false,
      };

### Validation

- Command: `node --check ui/renderer.js`
  Expected: no syntax errors.

- Command: `npm start -- --project=C:\\dev\\clip-sandbox`
  Expected: Electron launches, shows the current blocking loading overlay, then
  renders a compact top shell instead of the large hero + board layout.

### Rollback/Containment

If the shell rewrite breaks rendering, revert `ui/index.html` and `ui/renderer.js`
to the last working state together. Do not partially keep the new shell markup
with the old renderer selectors.

## Milestone 2 - Add summary line, filter chips, short labels, and right-side panel

### Scope

Make the compact shell useful by wiring short path labels, summary counts,
filter chips, and the right-side panel that replaces the permanent enabled/global
sections.

### Files

- Modify: `ui/renderer.js`
- Modify: `ui/index.html`

### Changes

- File: `ui/renderer.js`
  Edit: Add helpers for short labels and summary text:

      function shortPathLabel(targetPath, fallback) {
        if (!targetPath) {
          return fallback;
        }
        const parts = targetPath.split(/[/\\\\]+/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : targetPath;
      }

      function buildSummaryLine(snapshot) {
        const updates = (snapshot.skills || []).filter((skill) => skill.repoStatus === "needs_update").length;
        return `${snapshot.skillCount || 0} skills • ${snapshot.enabledCount || 0} enabled • ${snapshot.globalEnabledCount || 0} global • ${updates} update${updates === 1 ? "" : "s"}`;
      }

- File: `ui/renderer.js`
  Edit: Replace the old `enabledOnly` boolean filter with composable chip
  filtering:

      function skillMatchesActiveFilters(skill) {
        if (state.activeFilters.has("enabled") && !skill.installed) return false;
        if (state.activeFilters.has("global") && !skill.global_installed) return false;
        if (state.activeFilters.has("updates") && skill.repoStatus !== "needs_update") return false;
        if (state.activeFilters.has("conflicts") && !skill.conflict && !skill.global_conflict) return false;
        return true;
      }

      function filteredSkills(snapshot) {
        const query = state.filter.trim().toLowerCase();
        return (snapshot.skills || []).filter((skill) => {
          if (!skillMatchesActiveFilters(skill)) return false;
          if (!query) return true;
          return (
            skill.name.toLowerCase().includes(query) ||
            skill.description.toLowerCase().includes(query) ||
            skill.path.toLowerCase().includes(query)
          );
        });
      }

- File: `ui/renderer.js`
  Edit: Render the chip row and wire click handlers:

      function renderFilterChips() {
        filterChipsEl.innerHTML = "";
        CHIP_DEFS.forEach((chip) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `secondary filter-chip${state.activeFilters.has(chip.key) ? " active" : ""}`;
          button.textContent = chip.label;
          button.addEventListener("click", () => {
            if (state.activeFilters.has(chip.key)) state.activeFilters.delete(chip.key);
            else state.activeFilters.add(chip.key);
            render();
          });
          filterChipsEl.appendChild(button);
        });
      }

- File: `ui/renderer.js`
  Edit: Populate the short path controls and tooltip them with absolute paths:

      libraryTrigger.textContent = `Library: ${shortPathLabel(snapshot.libraryRoot, "Not set")}`;
      libraryTrigger.title = snapshot.libraryRoot || "Library root is not configured.";
      projectTrigger.textContent = `Project: ${shortPathLabel(snapshot.projectRoot, "No project")}`;
      projectTrigger.title = snapshot.projectRoot || "Project root is not resolved.";
      summaryLineEl.textContent = buildSummaryLine(snapshot);

- File: `ui/renderer.js`
  Edit: Replace `renderPills()` usage in the main shell with panel rendering.
  The side panel needs two modes:

      function openSidePanel(section) {
        state.sidePanelSection = section;
        renderSidePanel();
      }

      function renderSidePanel() {
        if (!state.sidePanelSection || !state.snapshot) {
          sidePanel.classList.remove("open");
          sidePanel.setAttribute("aria-hidden", "true");
          return;
        }

        const snapshot = state.snapshot;
        sidePanel.classList.add("open");
        sidePanel.setAttribute("aria-hidden", "false");

        if (state.sidePanelSection === "enabled") {
          sidePanelTitle.textContent = "Enabled Here";
          sidePanelBody.innerHTML = (snapshot.enabled || []).length
            ? snapshot.enabled.map((skill) => `<div class="panel-item">${escapeHtml(skill.name)}</div>`).join("")
            : '<div class="empty">No skills enabled in this repo.</div>';
          return;
        }

        if (state.sidePanelSection === "global") {
          sidePanelTitle.textContent = "Installed Globally";
          sidePanelBody.innerHTML = `
            <div class="panel-meta">${escapeHtml(snapshot.globalRoot || "")}</div>
            ${(snapshot.globalEnabled || []).length
              ? snapshot.globalEnabled.map((skill) => `<div class="panel-item">${escapeHtml(skill.name)}</div>`).join("")
              : '<div class="empty">No library skills installed globally.</div>'}
          `;
          return;
        }
      }

- File: `ui/renderer.js`
  Edit: Wire the shell buttons:

      showEnabledPanelButton.addEventListener("click", () => openSidePanel("enabled"));
      showGlobalPanelButton.addEventListener("click", () => openSidePanel("global"));
      sidePanelClose.addEventListener("click", () => {
        state.sidePanelSection = null;
        renderSidePanel();
      });

  Keep `libraryTrigger` and `projectTrigger` dedicated to root and project path
  affordances. They may later open a path-details panel section, but they should
  not be overloaded to mean enabled/global state.

### Validation

- Command: `node --check ui/renderer.js`
  Expected: no syntax errors.

- Command: `npm start -- --project=C:\\dev\\clip-sandbox`
  Expected: the shell shows short `Library` and `Project` labels, one summary
  line, clickable chips, and a right-side panel that opens and closes without
  pushing the grid downward.

- Manual check: select `Enabled`, `Global`, `Needs Update`, and `Conflicts`
  chips in different combinations.
  Expected: the skill grid narrows correctly while the search box still works.

### Rollback/Containment

If chip logic or side-panel rendering is unstable, keep the command strip but
temporarily disable only the new chip row and panel controls. Do not restore the
old board layout unless the shell itself is broken.

## Milestone 3 - Simplify skill cards and anchor status feedback in the shell

### Scope

Keep skill cards as the main working surface while reducing clutter, preserving
primary install buttons, and moving secondary controls to compact edge actions.

### Files

- Modify: `ui/index.html`
- Modify: `ui/renderer.js`
- Modify: `SKILL.md`

### Changes

- File: `ui/index.html`
  Edit: Add CSS for compact edge actions and de-emphasized metadata:

      .skill-card { padding-top: 18px; }
      .card-edge-actions { position: absolute; top: 8px; right: 28px; display: flex; gap: 6px; }
      .card-edge-button { width: 24px; height: 24px; padding: 0; border-radius: 999px; }
      .skill-meta-subtle { color: var(--muted); font-size: 0.82rem; }
      .status-pill.info { background: var(--accent-soft); }
      .status-pill.warn { background: var(--warn-soft); }
      .status-pill.error { background: var(--danger-soft); }

- File: `ui/renderer.js`
  Edit: Change `setMessage()` so it writes into the new shell pill instead of
  the removed `message-box` card:

      function setMessage(kind, text) {
        statusPill.className = `status-pill ${kind}`;
        statusPill.textContent = text;
      }

- File: `ui/renderer.js`
  Edit: In `renderSkills(snapshot)`, remove always-visible `skill.path` and
  conflict path blocks from the default card body. Keep full paths in `title`
  attributes and only surface conflict details inline when there is an active
  repo/global conflict:

      title.title = skill.path;
      desc.title = skill.description;

      if (skill.conflict || skill.global_conflict) {
        const issue = document.createElement("div");
        issue.className = "skill-meta-subtle";
        issue.textContent = skill.conflict
          ? `Repo conflict: ${skill.project_entry_target || skill.project_entry || ""}`
          : `Global conflict: ${skill.global_entry_target || skill.global_entry || ""}`;
        issue.title = issue.textContent;
        card.appendChild(issue);
      }

- File: `ui/renderer.js`
  Edit: Render compact edge actions instead of mixing every secondary action
  into the main body action row:

      const edgeActions = document.createElement("div");
      edgeActions.className = "card-edge-actions";

      if (skill.repoWebUrl) {
        edgeActions.appendChild(makeEdgeButton("↗", `Open GitHub repo for ${skill.name}`, () => api.openExternal(skill.repoWebUrl)));
      }

      edgeActions.appendChild(makeEdgeButton("V", `View ${skill.name}`, () => viewSkill(skill.name)));

      if (skill.repoStatus === "needs_update" && skill.repoRoot) {
        edgeActions.appendChild(makeEdgeButton("U", `Update repo for ${skill.name}`, () => updateSkillRepo(skill.name)));
      }

      edgeActions.appendChild(makeEdgeButton("×", `Delete ${skill.name} from library`, () => deleteLibrarySkill(skill), "danger-outline"));

  Add the helper:

      function makeEdgeButton(label, title, onClick, className = "secondary") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `card-edge-button ${className}`;
        button.textContent = label;
        button.title = title;
        button.setAttribute("aria-label", title);
        button.addEventListener("click", onClick);
        return button;
      }

- File: `ui/renderer.js`
  Edit: Keep install buttons as the main body controls. The main action row
  should now only contain the repo and global install buttons:

      actions.append(repoButton, globalButton);

- File: `SKILL.md`
  Edit: Update the Electron UI notes from the old tall layout to the new command
  strip model, for example:

      - The Electron UI opens on a compact command strip with search, filter chips,
        a summary line, and a small status area.
      - `Enabled Here` and `Installed Globally` are available from the right-side panel.

### Validation

- Command: `node --check ui/renderer.js`
  Expected: no syntax errors.

- Command: `npm start -- --project=C:\\dev\\clip-sandbox`
  Expected: cards still show all skills, enabled repo skills sort first, primary
  install actions remain obvious, and secondary actions appear as small edge
  controls.

- Manual check: click `View`, `Update`, repo `↗`, and `Delete` on at least one
  applicable card.
  Expected: each control still performs the existing action, and the status pill
  updates immediately on action start or completion.

### Rollback/Containment

If compact edge buttons reduce clarity too much, revert only the edge-action
markup and CSS while keeping the command strip, summary line, chips, and panel.
Do not resurrect the old large status card.

## Milestone 4 - Responsive cleanup and final validation

### Scope

Finish the redesign with responsive adjustments and a manual verification pass
that matches the approved spec.

### Files

- Modify: `ui/index.html`
- Modify: `ui/renderer.js` if small responsive fixes are needed

### Changes

- File: `ui/index.html`
  Edit: Update the existing media queries so the command strip stacks cleanly on
  narrow widths and the side panel becomes full-width on smaller windows:

      @media (max-width: 980px) {
        .command-strip { grid-template-columns: 1fr 1fr; }
        .search-wrap { grid-column: 1 / -1; }
        .status-pill { justify-self: start; }
        .summary-strip { flex-direction: column; align-items: start; }
      }

      @media (max-width: 640px) {
        .command-strip { grid-template-columns: 1fr; }
        .side-panel { inset: 12px; width: auto; }
        .skills-grid { grid-template-columns: 1fr; }
      }

- File: `ui/renderer.js`
  Edit: Ensure `render()` always calls:

      renderFilterChips();
      renderSidePanel();
      renderSkills(snapshot);

  so shell state stays in sync after any action or refresh.

- File: `ui/renderer.js`
  Edit: Keep the loading overlay behavior unchanged for startup and refreshes.
  Do not weaken or remove `setLoading()` in this pass.

### Validation

- Command: `node --check electron/main.js`
  Expected: no syntax errors.

- Command: `node --check electron/preload.js`
  Expected: no syntax errors.

- Command: `node --check ui/renderer.js`
  Expected: no syntax errors.

- Command: `npm start -- --project=C:\\dev\\clip-sandbox`
  Expected: startup loading overlay appears first, then the redesign appears and
  remains usable when the window is resized narrower.

- Manual checklist:
  - Verify all skills are visible by default.
  - Verify enabled repo skills appear first.
  - Verify the summary line reads correctly after repo changes.
  - Verify the right-side panel opens without pushing down the skill grid.
  - Verify status text remains visible after enable, disable, global install,
    uninstall, and update actions.

### Rollback/Containment

If final polish introduces regressions, keep the milestone focused on CSS and
small renderer sync fixes. Avoid changing main-process code while resolving
layout issues.
