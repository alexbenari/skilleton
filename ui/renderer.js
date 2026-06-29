(function () {
  const api = window.skillManager;
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
    activeTagFilters: new Set(),
    tagEditorSkill: null,
    tagDraft: "",
    repoStatusRefreshInFlight: false,
    sidePanelSection: null,
    projectPath: "",
    projectDraft: "",
    rootDraft: "",
    browser: {
      open: false,
      mode: null,
      currentPath: "",
      entries: [],
      parentPath: null,
    },
    cloneModalOpen: false,
  };

  const libraryTrigger = document.getElementById("library-trigger");
  const projectTrigger = document.getElementById("project-trigger");
  const skillsMetaEl = document.getElementById("skills-meta");
  const showEnabledPanelButton = document.getElementById("show-enabled-panel");
  const showGlobalPanelButton = document.getElementById("show-global-panel");
  const statusPill = document.getElementById("status-pill");
  const filterChipsEl = document.getElementById("filter-chips");
  const skillsEl = document.getElementById("skills");
  const sidePanel = document.getElementById("side-panel");
  const sidePanelTitle = document.getElementById("side-panel-title");
  const sidePanelBody = document.getElementById("side-panel-body");
  const sidePanelClose = document.getElementById("side-panel-close");
  const filterInput = document.getElementById("filter-input");
  const filterClearButton = document.getElementById("filter-clear");
  const folderModal = document.getElementById("folder-modal");
  const folderModalTitle = document.getElementById("folder-modal-title");
  const folderModalPath = document.getElementById("folder-modal-path");
  const folderModalList = document.getElementById("folder-modal-list");
  const folderModalUp = document.getElementById("folder-modal-up");
  const folderModalChoose = document.getElementById("folder-modal-choose");
  const folderModalCancel = document.getElementById("folder-modal-cancel");
  const loadingOverlay = document.getElementById("loading-overlay");
  const loadingText = document.getElementById("loading-text");
  const refreshSkillsButton = document.getElementById("refresh-skills-button");
  const addSkillsButton = document.getElementById("add-skills-button");
  const cloneModal = document.getElementById("clone-modal");
  const cloneUrlInput = document.getElementById("clone-url-input");
  const cloneSubmit = document.getElementById("clone-submit");
  const cloneCancel = document.getElementById("clone-cancel");

  function setMessage(kind, text) {
    statusPill.className = `status-pill ${kind}`;
    statusPill.textContent = text;
  }

  function enabledCountMessage(prefix) {
    const count = state.snapshot?.enabledCount || 0;
    const suffix = `${count} skill${count === 1 ? "" : "s"} enabled in this repo.`;
    return prefix ? `${prefix} ${suffix}` : suffix;
  }

  function setBusy(isBusy) {
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function setLoading(isLoading, text) {
    loadingOverlay.classList.toggle("open", isLoading);
    loadingOverlay.setAttribute("aria-hidden", isLoading ? "false" : "true");
    if (text) {
      loadingText.textContent = text;
    }
  }

  function renderCloneModal() {
    cloneModal.classList.toggle("open", state.cloneModalOpen);
    cloneModal.setAttribute("aria-hidden", state.cloneModalOpen ? "false" : "true");
  }

  function currentProject() {
    return state.projectPath.trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function shortPathLabel(targetPath, fallback) {
    if (!targetPath) {
      return fallback;
    }
    const parts = targetPath.split(/[/\\]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : targetPath;
  }

  function buildSummaryLine(snapshot) {
    const updates = (snapshot.skills || []).filter((skill) => skill.repoStatus === "needs_update").length;
    return `${snapshot.skillCount || 0} skills • ${snapshot.enabledCount || 0} enabled • ${snapshot.globalEnabledCount || 0} global • ${updates} update${updates === 1 ? "" : "s"}`;
  }

  function syncResolvedPaths(snapshot) {
    if (!snapshot) {
      return;
    }
    if (snapshot.libraryRoot) {
      state.rootDraft = snapshot.libraryRoot;
    }
    if (snapshot.projectRoot) {
      state.projectPath = snapshot.projectRoot;
      state.projectDraft = snapshot.projectRoot;
    }
  }

  function applyRepoStatuses(repoStatuses) {
    if (!state.snapshot || !Array.isArray(repoStatuses)) {
      return;
    }
    const byName = new Map(repoStatuses.map((status) => [status.name, status]));
    state.snapshot.skills = (state.snapshot.skills || []).map((skill) => {
      const status = byName.get(skill.name);
      return status ? { ...skill, ...status } : skill;
    });
    render();
  }

  async function refreshRepoStatusesInBackground(options = {}) {
    if (!state.snapshot?.configured || state.repoStatusRefreshInFlight) {
      return;
    }
    state.repoStatusRefreshInFlight = true;
    try {
      const result = await api.refreshRepoStatuses(currentProject() || null, {
        force: Boolean(options.force),
      });
      if (result.projectRoot && result.projectRoot !== state.snapshot?.projectRoot) {
        return;
      }
      applyRepoStatuses(result.repoStatuses || []);
    } catch (error) {
      setMessage("warn", error.message || String(error));
    } finally {
      state.repoStatusRefreshInFlight = false;
    }
  }

  async function refreshState(message, options = {}) {
    const showLoading = options.showLoading !== false;
    setBusy(true);
    if (showLoading) {
      setLoading(
        true,
        state.snapshot
          ? "Refreshing skills and updating project state."
          : "Enumerating skills and resolving the selected project."
      );
    }
    try {
      state.snapshot = await api.getState(currentProject() || null, {
        forceDiscovery: Boolean(options.forceDiscovery),
      });
      syncResolvedPaths(state.snapshot);
      render();
      if (state.snapshot.error) {
        setMessage("warn", state.snapshot.error);
        return false;
      } else if (message) {
        setMessage("info", enabledCountMessage(message));
      } else {
        setMessage("info", enabledCountMessage("Library and repo state refreshed."));
      }
      if (options.refreshGit !== false) {
        refreshRepoStatusesInBackground({ force: Boolean(options.forceDiscovery) });
      }
      return true;
    } catch (error) {
      setMessage("error", error.message || String(error));
      return false;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
      setBusy(false);
    }
  }

  async function runAction(action, pendingMessage, successMessage) {
    setBusy(true);
    if (pendingMessage) {
      setMessage("info", pendingMessage);
    }
    try {
      const result = await action();
      state.snapshot = result.state || state.snapshot;
      syncResolvedPaths(state.snapshot);
      render();
      const messageKind = result.messageKind || "info";
      const messageText =
        result.message || successMessage || "Done.";
      setMessage(
        messageKind,
        messageKind === "info" ? enabledCountMessage(messageText) : messageText
      );
      return result;
    } catch (error) {
      setMessage("error", error.message || String(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function installStateNeedsPrompt(installState) {
    return installState === "copied-modified" || installState === "foreign-conflict";
  }

  function skillHasIssue(skill) {
    return Boolean(
      skill.conflict ||
      skill.global_conflict ||
      installStateNeedsPrompt(skill.project_install_state) ||
      installStateNeedsPrompt(skill.global_install_state)
    );
  }

  function repoActionMeta(skill) {
    switch (skill.project_install_state) {
      case "linked-match":
        return { label: "Copy Into Repo", className: "primary" };
      case "copied-match":
        return { label: "Refresh Repo Copy", className: "secondary" };
      case "copied-modified":
        return { label: "Replace Repo Copy", className: "primary" };
      case "foreign-conflict":
        return { label: "Replace Repo Entry", className: "primary" };
      default:
        return { label: "Enable In Repo", className: "primary" };
    }
  }

  function globalActionMeta(skill) {
    switch (skill.global_install_state) {
      case "linked-match":
        return { label: "Copy Global Install", className: "secondary" };
      case "copied-match":
        return { label: "Refresh Global Copy", className: "secondary" };
      case "copied-modified":
        return { label: "Replace Global Copy", className: "secondary" };
      case "foreign-conflict":
        return { label: "Replace Global Entry", className: "secondary" };
      default:
        return { label: "Install Globally", className: "secondary" };
    }
  }

  function installIssueText(scope, skill) {
    const installState = scope === "repo" ? skill.project_install_state : skill.global_install_state;
    const entry = scope === "repo"
      ? skill.project_entry_target || skill.project_entry || ""
      : skill.global_entry_target || skill.global_entry || "";
    if (installState === "copied-modified") {
      return `${scope === "repo" ? "Repo" : "Global"} copy differs from the library. Refresh will replace local edits.`;
    }
    if (installState === "linked-match") {
      return `${scope === "repo" ? "Repo" : "Global"} install is still a legacy link. Refresh will replace it with a real copy.`;
    }
    if (installState === "foreign-conflict") {
      return `${scope === "repo" ? "Repo" : "Global"} entry points somewhere else: ${entry}`;
    }
    return "";
  }

  function skillMatchesActiveFilters(skill) {
    if (state.activeFilters.has("enabled") && !skill.installed) {
      return false;
    }
    if (state.activeFilters.has("global") && !skill.global_installed) {
      return false;
    }
    if (state.activeFilters.has("updates") && skill.repoStatus !== "needs_update") {
      return false;
    }
    if (state.activeFilters.has("conflicts") && !skillHasIssue(skill)) {
      return false;
    }
    for (const tag of state.activeTagFilters) {
      if (!(skill.tags || []).includes(tag)) {
        return false;
      }
    }
    return true;
  }

  function sortedVisibleSkills(snapshot) {
    const query = state.filter.trim().toLowerCase();
    return (snapshot.skills || [])
      .filter((skill) => {
        if (!skillMatchesActiveFilters(skill)) {
          return false;
        }
        if (!query) {
          return true;
        }
        return (
          skill.name.toLowerCase().includes(query) ||
          (skill.source || "").toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query) ||
          (skill.tags || []).some((tag) => tag.includes(query)) ||
          skill.path.toLowerCase().includes(query)
        );
      })
      .sort((left, right) => {
        if (left.installed !== right.installed) {
          return Number(right.installed) - Number(left.installed);
        }
        if (left.global_installed !== right.global_installed) {
          return Number(right.global_installed) - Number(left.global_installed);
        }
        return left.name.localeCompare(right.name);
      });
  }

  function renderFilterChips() {
    filterChipsEl.innerHTML = "";
    CHIP_DEFS.forEach((chip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `secondary filter-chip${state.activeFilters.has(chip.key) ? " active" : ""}`;
      button.textContent = chip.label;
      button.addEventListener("click", () => {
        if (state.activeFilters.has(chip.key)) {
          state.activeFilters.delete(chip.key);
        } else {
          state.activeFilters.add(chip.key);
        }
        render();
      });
      filterChipsEl.appendChild(button);
    });
    (state.snapshot?.allTags || []).forEach((tag) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `secondary filter-chip tag-filter${state.activeTagFilters.has(tag) ? " active" : ""}`;
      button.textContent = `#${tag}`;
      button.title = `Filter by ${tag}`;
      button.addEventListener("click", () => {
        if (state.activeTagFilters.has(tag)) {
          state.activeTagFilters.delete(tag);
        } else {
          state.activeTagFilters.add(tag);
        }
        render();
      });
      filterChipsEl.appendChild(button);
    });
  }

  function renderFilterInput() {
    filterInput.value = state.filter;
    filterClearButton.hidden = !state.filter;
  }

  function tagsFromDraft(value) {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function hasDraftTag(tag) {
    return tagsFromDraft(state.tagDraft).some(
      (draftTag) => draftTag.toLowerCase() === tag.toLowerCase()
    );
  }

  function toggleDraftTag(tag) {
    const tags = tagsFromDraft(state.tagDraft);
    const existingIndex = tags.findIndex(
      (draftTag) => draftTag.toLowerCase() === tag.toLowerCase()
    );
    if (existingIndex >= 0) {
      tags.splice(existingIndex, 1);
    } else {
      tags.push(tag);
    }
    state.tagDraft = tags.join(", ");
  }

  function renderFolderBrowser() {
    folderModal.classList.toggle("open", state.browser.open);
    folderModal.setAttribute("aria-hidden", state.browser.open ? "false" : "true");
    if (!state.browser.open) {
      return;
    }
    folderModalTitle.textContent =
      state.browser.mode === "root" ? "Select Library Root" : "Select Project Folder";
    folderModalPath.textContent = state.browser.currentPath || "Computer";
    folderModalList.innerHTML = "";
    if (!state.browser.entries.length) {
      folderModalList.innerHTML = '<div class="empty">No subfolders here.</div>';
    } else {
      state.browser.entries.forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "browser-entry";
        button.innerHTML = `${escapeHtml(entry.name)}<br><span>${escapeHtml(entry.path)}</span>`;
        button.addEventListener("click", () => openFolderBrowser(state.browser.mode, entry.path));
        folderModalList.appendChild(button);
      });
    }
    folderModalUp.disabled =
      state.browser.parentPath === null || state.browser.parentPath === undefined;
  }

  function makeEdgeButton(label, title, onClick, className = "secondary") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `card-edge-button ${className}`;
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", async () => {
      try {
        await onClick();
      } catch (error) {
        setMessage("error", error.message || String(error));
      }
    });
    return button;
  }

  function renderSkills(snapshot) {
    skillsEl.innerHTML = "";
    if (!snapshot.configured) {
      skillsEl.innerHTML = '<div class="empty">Set a valid library root to start browsing skills.</div>';
      return;
    }
    const skills = sortedVisibleSkills(snapshot);
    if (!skills.length) {
      skillsEl.innerHTML = '<div class="empty">No skills match the current filter set.</div>';
      return;
    }

    skills.forEach((skill) => {
      const card = document.createElement("article");
      card.className = `skill-card${skill.installed ? " installed" : ""}${skillHasIssue(skill) ? " conflict" : ""}`;

      const repoDot = document.createElement("div");
      const dotClass =
        skill.repoStatus === "needs_update"
          ? "red"
          : skill.repoStatus === "up_to_date"
            ? "green"
            : "grey";
      repoDot.className = `repo-dot ${dotClass}`;
      repoDot.title = skill.repoRoot
        ? `${skill.repoStatusReason}\nRepo: ${skill.repoRoot}`
        : skill.repoStatusReason;
      card.appendChild(repoDot);

      const edgeActions = document.createElement("div");
      edgeActions.className = "card-edge-actions";

      if (skill.repoWebUrl) {
        edgeActions.appendChild(
          makeEdgeButton("↗", `Open GitHub repo for ${skill.name}`, () => api.openExternal(skill.repoWebUrl))
        );
      }

      edgeActions.appendChild(
        makeEdgeButton("View", `View ${skill.name}`, () => viewSkill(skill.name))
      );

      if (skill.repoStatus === "needs_update" && skill.repoRoot) {
        edgeActions.appendChild(
          makeEdgeButton("Update", `Update repo for ${skill.name}`, () => updateSkillRepo(skill.name))
        );
      }

      edgeActions.appendChild(
        makeEdgeButton("Tags", `Edit tags for ${skill.name}`, () => editSkillTags(skill))
      );

      if (skill.installed) {
        edgeActions.appendChild(
          makeEdgeButton(
            "Disable Repo",
            `Remove ${skill.name} from this repo`,
            () => disableSkill(skill.name),
            "danger-outline"
          )
        );
      }

      if (skill.global_installed) {
        edgeActions.appendChild(
          makeEdgeButton(
            "Uninstall",
            `Remove ${skill.name} from global installs`,
            () => uninstallGlobalSkill(skill.name),
            "danger-outline"
          )
        );
      }

      edgeActions.appendChild(
        makeEdgeButton(
          "Delete",
          `Delete ${skill.name} from the library`,
          () => deleteLibrarySkill(skill),
          "danger-outline"
        )
      );
      card.appendChild(edgeActions);

      const top = document.createElement("div");
      top.className = "skill-top";

      const textWrap = document.createElement("div");
      const title = document.createElement("h3");
      title.className = "skill-name";
      title.textContent = skill.name;
      title.title = skill.path;

      const desc = document.createElement("div");
      desc.className = "meta";
      desc.textContent = skill.description;
      desc.title = skill.description;

      textWrap.append(title, desc);

      const badges = document.createElement("div");
      badges.className = "badges";
      if (skill.global_installed) {
        const badge = document.createElement("span");
        badge.className = "badge global";
        badge.textContent = "Global";
        badges.appendChild(badge);
      }
      if (skill.project_install_state === "linked-match") {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Repo Link";
        badges.appendChild(badge);
      }
      if (skill.project_install_state === "copied-modified") {
        const badge = document.createElement("span");
        badge.className = "badge conflict";
        badge.textContent = "Repo Modified";
        badges.appendChild(badge);
      }
      if (skill.conflict) {
        const badge = document.createElement("span");
        badge.className = "badge conflict";
        badge.textContent = "Repo Conflict";
        badges.appendChild(badge);
      }
      if (skill.global_install_state === "linked-match") {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Global Link";
        badges.appendChild(badge);
      }
      if (skill.global_install_state === "copied-modified") {
        const badge = document.createElement("span");
        badge.className = "badge conflict";
        badge.textContent = "Global Modified";
        badges.appendChild(badge);
      }
      if (skill.global_conflict) {
        const badge = document.createElement("span");
        badge.className = "badge conflict";
        badge.textContent = "Global Conflict";
        badges.appendChild(badge);
      }
      top.append(textWrap, badges);
      card.appendChild(top);

      if (skill.source) {
        const source = document.createElement("div");
        source.className = "skill-meta-subtle";
        source.textContent = `Source: ${skill.source}`;
        source.title = skill.path;
        card.appendChild(source);
      }

      if (state.tagEditorSkill === skill.name) {
        const tagEditor = document.createElement("div");
        tagEditor.className = "tag-editor";

        const tagInput = document.createElement("input");
        tagInput.type = "text";
        tagInput.className = "tag-editor-input";
        tagInput.value = state.tagDraft;
        tagInput.placeholder = "frontend, design, review";
        tagInput.addEventListener("input", () => {
          state.tagDraft = tagInput.value;
        });
        tagInput.addEventListener("keydown", async (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            await saveSkillTags(skill);
          }
          if (event.key === "Escape") {
            cancelTagEdit();
          }
        });

        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.className = "primary tag-editor-action";
        saveButton.textContent = "Save";
        saveButton.addEventListener("click", () => saveSkillTags(skill));

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "secondary tag-editor-action";
        cancelButton.textContent = "Cancel";
        cancelButton.addEventListener("click", cancelTagEdit);

        tagEditor.append(tagInput, saveButton, cancelButton);
        card.appendChild(tagEditor);

        if ((snapshot.allTags || []).length) {
          const suggestions = document.createElement("div");
          suggestions.className = "tag-suggestions";
          snapshot.allTags.forEach((tag) => {
            const suggestion = document.createElement("button");
            suggestion.type = "button";
            suggestion.className = `skill-tag tag-suggestion${hasDraftTag(tag) ? " selected" : ""}`;
            suggestion.textContent = `#${tag}`;
            suggestion.title = hasDraftTag(tag) ? `Remove ${tag}` : `Add ${tag}`;
            suggestion.addEventListener("click", () => {
              toggleDraftTag(tag);
              render();
            });
            suggestions.appendChild(suggestion);
          });
          card.appendChild(suggestions);
        }
      } else {
        const tags = document.createElement("div");
        tags.className = "tag-row";
        if ((skill.tags || []).length) {
          skill.tags.forEach((tag) => {
            const tagButton = document.createElement("button");
            tagButton.type = "button";
            tagButton.className = "skill-tag";
            tagButton.textContent = `#${tag}`;
            tagButton.title = `Filter by ${tag}`;
            tagButton.addEventListener("click", () => {
              state.activeTagFilters.add(tag);
              render();
            });
            tags.appendChild(tagButton);
          });
        } else {
          const emptyTags = document.createElement("button");
          emptyTags.type = "button";
          emptyTags.className = "skill-tag empty-tag";
          emptyTags.textContent = "Add tags";
          emptyTags.addEventListener("click", () => editSkillTags(skill));
          tags.appendChild(emptyTags);
        }
        card.appendChild(tags);
      }

      const repoIssue = installIssueText("repo", skill);
      const globalIssue = installIssueText("global", skill);
      if (repoIssue || globalIssue) {
        const issue = document.createElement("div");
        issue.className = "skill-meta-subtle";
        issue.textContent = repoIssue || globalIssue;
        issue.title = issue.textContent;
        card.appendChild(issue);
      }

      const actions = document.createElement("div");
      actions.className = "row wrap";
      const repoAction = repoActionMeta(skill);
      const globalAction = globalActionMeta(skill);

      const repoButton = document.createElement("button");
      repoButton.type = "button";
      repoButton.className = repoAction.className;
      repoButton.textContent = repoAction.label;
      repoButton.addEventListener("click", () => {
        enableSkill(skill.name, false);
      });

      const globalButton = document.createElement("button");
      globalButton.type = "button";
      globalButton.className = globalAction.className;
      globalButton.textContent = globalAction.label;
      globalButton.addEventListener("click", () => {
        installGlobalSkill(skill.name, false);
      });

      actions.append(repoButton, globalButton);
      card.appendChild(actions);
      skillsEl.appendChild(card);
    });
  }

  function renderPathPanel(
    titleText,
    currentPath,
    inputId,
    draftValue,
    placeholder,
    browseHandler,
    submitHandler,
    submitLabel,
    refreshHandler,
    options = {}
  ) {
    const browseClass = options.browseClass || "secondary";
    const submitClass = options.submitClass || "primary";
    sidePanelTitle.textContent = titleText;
    sidePanelBody.innerHTML = `
      <div class="panel-group">
        <div class="panel-label">Current</div>
        <div class="panel-path">${escapeHtml(currentPath || "Not configured.")}</div>
      </div>
      <div class="panel-group">
        <label class="panel-label" for="${inputId}">${escapeHtml(titleText)}</label>
        <input id="${inputId}" type="text" value="${escapeHtml(draftValue)}" placeholder="${escapeHtml(placeholder)}">
      </div>
      <div class="row wrap">
        <button type="button" class="${browseClass}" id="${inputId}-browse">Browse</button>
        <button type="button" class="${submitClass}" id="${inputId}-submit">${escapeHtml(submitLabel)}</button>
        <button type="button" class="secondary" id="${inputId}-refresh">Refresh</button>
      </div>
    `;

    const input = document.getElementById(inputId);
    const browseButton = document.getElementById(`${inputId}-browse`);
    const submitButton = document.getElementById(`${inputId}-submit`);
    const refreshButton = document.getElementById(`${inputId}-refresh`);

    browseButton.addEventListener("click", browseHandler);
    submitButton.addEventListener("click", () => submitHandler(input.value.trim()));
    refreshButton.addEventListener("click", refreshHandler);
    return { input, browseButton, submitButton };
  }

  function renderCollectionPanel(titleText, introHtml, items, emptyMessage) {
    sidePanelTitle.textContent = titleText;
    sidePanelBody.innerHTML = "";
    if (introHtml) {
      const intro = document.createElement("div");
      intro.className = "panel-group";
      intro.innerHTML = introHtml;
      sidePanelBody.appendChild(intro);
    }
    if (!items.length) {
      sidePanelBody.innerHTML += `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
      return;
    }
    items.forEach((skill) => {
      const item = document.createElement("div");
      item.className = "panel-item";
      item.innerHTML = `<strong>${escapeHtml(skill.name)}</strong><div class="meta">${escapeHtml(skill.path || "")}</div>`;
      sidePanelBody.appendChild(item);
    });
  }

  function renderSidePanel() {
    if (!state.sidePanelSection || !state.snapshot) {
      sidePanel.classList.remove("open");
      sidePanel.setAttribute("aria-hidden", "true");
      sidePanelBody.innerHTML = "";
      return;
    }

    const snapshot = state.snapshot;
    sidePanel.classList.add("open");
    sidePanel.setAttribute("aria-hidden", "false");

    if (state.sidePanelSection === "library") {
      const { input } = renderPathPanel(
        "Library Root",
        snapshot.libraryRoot || "",
        "side-root-input",
        state.rootDraft || snapshot.libraryRoot || "",
        "C:\\dev\\skills-main",
        async () => browseForPath("root", state.rootDraft || snapshot.libraryRoot || ""),
        async (nextPath) => {
          if (!nextPath) {
            setMessage("warn", "Enter a library root first.");
            return;
          }
          state.rootDraft = nextPath;
          const succeeded = await runAction(
            () => api.setRoot(nextPath, currentProject() || null),
            `Saving library root ${nextPath}...`,
            "Library root updated."
          );
          if (succeeded) {
            state.sidePanelSection = null;
            renderSidePanel();
          }
        },
        "Save Root",
        () => refreshState("Library and repo state refreshed.")
      );
      input.addEventListener("input", () => {
        state.rootDraft = input.value;
      });
      return;
    }

    if (state.sidePanelSection === "project") {
      const { input, browseButton } = renderPathPanel(
        "Project Path",
        snapshot.projectRoot || currentProject() || "",
        "side-project-input",
        state.projectDraft || snapshot.projectRoot || "",
        "C:\\dev\\my-repo",
        async () => browseForPath("project", state.projectDraft || snapshot.projectRoot || ""),
        async (nextPath) => {
          if (!nextPath) {
            setMessage("warn", "Enter a project path first.");
            return;
          }
          state.projectDraft = nextPath;
          state.projectPath = nextPath;
          const succeeded = await refreshState("Project loaded.", { refreshGit: false });
          if (succeeded) {
            state.sidePanelSection = null;
            renderSidePanel();
          }
        },
        "Load Project",
        () => refreshState("Project state refreshed.", { refreshGit: false }),
        {
          browseClass: "primary",
          submitClass: "secondary",
        }
      );
      input.addEventListener("input", () => {
        state.projectDraft = input.value;
      });
      window.requestAnimationFrame(() => browseButton.focus());
      return;
    }

    if (state.sidePanelSection === "enabled") {
      renderCollectionPanel(
        "Enabled Here",
        `<div class="panel-label">Resolved Project Root</div><div class="panel-path">${escapeHtml(snapshot.projectRoot || "No project selected.")}</div>`,
        snapshot.enabled || [],
        "No skills enabled in this repo."
      );
      return;
    }

    if (state.sidePanelSection === "global") {
      renderCollectionPanel(
        "Installed Globally",
        `<div class="panel-label">Global Skills Root</div><div class="panel-path">${escapeHtml(snapshot.globalRoot || "")}</div>`,
        snapshot.globalEnabled || [],
        "No library skills installed globally."
      );
    }
  }

  function render() {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }

    libraryTrigger.textContent = `Library: ${shortPathLabel(snapshot.libraryRoot, "Not set")}`;
    libraryTrigger.title = snapshot.libraryRoot || "Library root is not configured.";
    projectTrigger.textContent = `Project: ${shortPathLabel(snapshot.projectRoot, "No project")}`;
    projectTrigger.title = snapshot.projectRoot || "Project root is not resolved.";
    skillsMetaEl.textContent = `${buildSummaryLine(snapshot)}. Enabled skills appear first. Use chips to narrow the list.`;
    showEnabledPanelButton.textContent = `Enabled Here (${snapshot.enabledCount || 0})`;
    showGlobalPanelButton.textContent = `Installed Globally (${snapshot.globalEnabledCount || 0})`;

    renderFilterInput();
    renderFilterChips();
    renderSkills(snapshot);
    renderSidePanel();
    renderFolderBrowser();
    renderCloneModal();
  }

  async function viewSkill(skillName) {
    setBusy(true);
    try {
      const payload = await api.readSkillMarkdown(skillName);
      const popup = window.open("", `_skill_${skillName}`, "width=900,height=720,resizable=yes,scrollbars=yes");
      if (!popup) {
        throw new Error("Popup window was blocked by the browser.");
      }
      popup.document.open();
      popup.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(payload.skill)} - SKILL.md</title>
    <style>
      body {
        margin: 0;
        background: #f8f4ea;
        color: #1e1a14;
        font-family: "Bahnschrift", "Trebuchet MS", sans-serif;
      }
      main {
        max-width: 980px;
        margin: 0 auto;
        padding: 24px;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 1.6rem;
      }
      .meta {
        margin-bottom: 18px;
        color: #6c6255;
        font-size: 0.92rem;
        word-break: break-all;
      }
      pre {
        margin: 0;
        padding: 18px;
        border-radius: 18px;
        border: 1px solid rgba(30, 26, 20, 0.12);
        background: rgba(255, 255, 255, 0.88);
        font-family: "Consolas", "Courier New", monospace;
        font-size: 13px;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(payload.skill)}</h1>
      <div class="meta">${escapeHtml(payload.path)}</div>
      <pre>${escapeHtml(payload.content)}</pre>
    </main>
  </body>
</html>`);
      popup.document.close();
      popup.focus();
    } finally {
      setBusy(false);
    }
  }

  async function enableSkill(skill, force) {
    const result = await runAction(
      () => api.enableSkill(skill, currentProject() || null, force),
      force ? `Replacing ${skill} in this repo...` : `Copying ${skill} into this repo...`
    );
    if (!result || force) {
      return;
    }
    if (result.result && result.result.status === "blocked-modified") {
      const confirmed = window.confirm(
        `The repo copy of ${skill} differs from the library.\n\nReplace it with a fresh copy?`
      );
      if (confirmed) {
        await enableSkill(skill, true);
      }
    }
  }

  async function disableSkill(skill) {
    await runAction(
      () => api.disableSkill(skill, currentProject() || null),
      `Disabling ${skill} in this repo...`
    );
  }

  async function installGlobalSkill(skill, force) {
    const result = await runAction(
      () => api.installGlobalSkill(skill, currentProject() || null, force),
      force ? `Replacing global ${skill} copy...` : `Copying ${skill} into global installs...`
    );
    if (!result || force) {
      return;
    }
    if (result.result && result.result.status === "blocked-modified") {
      const confirmed = window.confirm(
        `The global copy of ${skill} differs from the library.\n\nReplace it with a fresh copy?`
      );
      if (confirmed) {
        await installGlobalSkill(skill, true);
      }
    }
  }

  async function uninstallGlobalSkill(skill) {
    await runAction(
      () => api.uninstallGlobalSkill(skill, currentProject() || null),
      `Removing ${skill} from global installs...`
    );
  }

  async function updateSkillRepo(skill) {
    const succeeded = await runAction(
      () => api.updateSkillRepo(skill, currentProject() || null),
      `Updating repo for ${skill}...`
    );
    if (succeeded) {
      refreshRepoStatusesInBackground();
    }
  }

  function editSkillTags(skill) {
    state.tagEditorSkill = skill.name;
    state.tagDraft = (skill.tags || []).join(", ");
    render();
    window.requestAnimationFrame(() => {
      const input = document.querySelector(".tag-editor-input");
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function cancelTagEdit() {
    state.tagEditorSkill = null;
    state.tagDraft = "";
    render();
  }

  async function saveSkillTags(skill) {
    const tags = tagsFromDraft(state.tagDraft);
    setBusy(true);
    setMessage("info", `Updating tags for ${skill.name}...`);
    try {
      const result = await api.setSkillTags(skill.name, tags, currentProject() || null);
      if (state.snapshot) {
        state.snapshot.skills = (state.snapshot.skills || []).map((row) =>
          row.name === result.skill ? { ...row, tags: result.tags || [] } : row
        );
        state.snapshot.allTags = result.allTags || [];
      }
      state.tagEditorSkill = null;
      state.tagDraft = "";
      render();
      setMessage("info", result.message || `Updated tags for ${skill.name}.`);
    } catch (error) {
      setMessage("error", error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteLibrarySkill(skill) {
    if (skill.installed) {
      setMessage("warn", `Disable ${skill.name} in this repo before deleting it from the library.`);
      return;
    }
    if (skill.global_installed) {
      setMessage("warn", `Uninstall ${skill.name} globally before deleting it from the library.`);
      return;
    }
    const confirmed = window.confirm(
      `Delete ${skill.name} from the library root?\n\nThis removes the skill folder from ${skill.path}.`
    );
    if (!confirmed) {
      return;
    }
    await runAction(
      () => api.deleteLibrarySkill(skill.name, currentProject() || null),
      `Deleting ${skill.name} from the library...`
    );
  }

  function openCloneModal() {
    state.cloneModalOpen = true;
    renderCloneModal();
    window.setTimeout(() => cloneUrlInput.focus(), 0);
  }

  function closeCloneModal() {
    state.cloneModalOpen = false;
    renderCloneModal();
  }

  async function cloneSkillsRepo() {
    const repoUrl = cloneUrlInput.value.trim();
    if (!repoUrl) {
      setMessage("warn", "Paste a repo URL first.");
      cloneUrlInput.focus();
      return;
    }
    closeCloneModal();
    await runAction(
      () => api.cloneSkillsRepo(repoUrl, currentProject() || null),
      `Cloning ${repoUrl}...`
    );
    cloneUrlInput.value = "";
  }

  async function openFolderBrowser(mode, startPath) {
    setBusy(true);
    try {
      const listing = await api.listDirectories(startPath || null);
      state.browser.open = true;
      state.browser.mode = mode;
      state.browser.currentPath = listing.currentPath || "";
      state.browser.entries = listing.entries || [];
      state.browser.parentPath = listing.parentPath;
      renderFolderBrowser();
      setMessage("info", "Browse folders and choose one.");
    } catch (error) {
      setMessage("error", error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  function closeFolderBrowser() {
    state.browser.open = false;
    state.browser.mode = null;
    state.browser.currentPath = "";
    state.browser.entries = [];
    state.browser.parentPath = null;
    renderFolderBrowser();
  }

  async function chooseBrowserPath() {
    const selected = state.browser.currentPath;
    if (!selected) {
      setMessage("warn", "Pick a concrete folder first.");
      return;
    }

    const mode = state.browser.mode;
    closeFolderBrowser();

    if (mode === "root") {
      state.rootDraft = selected;
      setMessage("info", `Selected library root: ${selected}`);
      renderSidePanel();
      return;
    }

    state.projectDraft = selected;
    state.projectPath = selected;
    const succeeded = await refreshState("Project loaded.", { refreshGit: false });
    if (succeeded) {
      state.sidePanelSection = null;
      renderSidePanel();
    }
  }

  async function browseForPath(mode, startPath) {
    try {
      const result = await api.pickFolder(startPath || null);
      if (result.cancelled || !result.selectedPath) {
        setMessage("info", "Folder selection cancelled.");
        return;
      }

      if (mode === "root") {
        state.rootDraft = result.selectedPath;
        setMessage("info", `Selected library root: ${result.selectedPath}`);
        renderSidePanel();
        return;
      }

      state.projectDraft = result.selectedPath;
      state.projectPath = result.selectedPath;
      const succeeded = await refreshState("Project loaded.", { refreshGit: false });
      if (succeeded) {
        state.sidePanelSection = null;
        renderSidePanel();
      }
    } catch (error) {
      setMessage("warn", `${error.message} Opening the in-app browser instead.`);
      await openFolderBrowser(mode, startPath);
    }
  }

  libraryTrigger.addEventListener("click", () => {
    state.sidePanelSection = state.sidePanelSection === "library" ? null : "library";
    renderSidePanel();
  });

  projectTrigger.addEventListener("click", () => {
    state.sidePanelSection = state.sidePanelSection === "project" ? null : "project";
    renderSidePanel();
  });

  showEnabledPanelButton.addEventListener("click", () => {
    state.sidePanelSection = state.sidePanelSection === "enabled" ? null : "enabled";
    renderSidePanel();
  });

  showGlobalPanelButton.addEventListener("click", () => {
    state.sidePanelSection = state.sidePanelSection === "global" ? null : "global";
    renderSidePanel();
  });

  sidePanelClose.addEventListener("click", () => {
    state.sidePanelSection = null;
    renderSidePanel();
  });

  filterInput.addEventListener("input", () => {
    state.filter = filterInput.value;
    render();
  });

  filterClearButton.addEventListener("click", () => {
    if (!state.filter) {
      return;
    }
    state.filter = "";
    render();
    filterInput.focus();
  });

  folderModalUp.addEventListener("click", async () => {
    if (state.browser.parentPath === null || state.browser.parentPath === undefined) {
      return;
    }
    await openFolderBrowser(state.browser.mode, state.browser.parentPath);
  });
  folderModalChoose.addEventListener("click", chooseBrowserPath);
  folderModalCancel.addEventListener("click", closeFolderBrowser);
  folderModal.addEventListener("click", (event) => {
    if (event.target === folderModal) {
      closeFolderBrowser();
    }
  });

  refreshSkillsButton.addEventListener("click", async () => {
    await refreshState("Available skills list refreshed.", {
      forceDiscovery: true,
      refreshGit: true,
    });
  });

  addSkillsButton.addEventListener("click", openCloneModal);
  cloneSubmit.addEventListener("click", cloneSkillsRepo);
  cloneCancel.addEventListener("click", closeCloneModal);
  cloneModal.addEventListener("click", (event) => {
    if (event.target === cloneModal) {
      closeCloneModal();
    }
  });
  cloneUrlInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await cloneSkillsRepo();
    }
    if (event.key === "Escape") {
      closeCloneModal();
    }
  });

  async function init() {
    try {
      const bootstrap = await api.getBootstrap();
      state.projectPath = bootstrap.initialProject || "";
      state.projectDraft = state.projectPath;
    } catch {
      state.projectPath = "";
      state.projectDraft = "";
    }
    await refreshState();
  }

  init();
})();
