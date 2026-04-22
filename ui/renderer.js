(function () {
  const api = window.skillManager;

  const state = {
    snapshot: null,
    filter: "",
    enabledOnly: false,
    browser: {
      open: false,
      mode: null,
      currentPath: "",
      entries: [],
      parentPath: null,
    },
  };

  const rootInput = document.getElementById("root-input");
  const projectInput = document.getElementById("project-input");
  const configPathEl = document.getElementById("config-path");
  const projectRootEl = document.getElementById("project-root");
  const libraryRootEl = document.getElementById("library-root");
  const enabledListEl = document.getElementById("enabled-list");
  const globalRootEl = document.getElementById("global-root");
  const globalEnabledListEl = document.getElementById("global-enabled-list");
  const messageBox = document.getElementById("message-box");
  const skillsEl = document.getElementById("skills");
  const skillCountEl = document.getElementById("skill-count");
  const enabledCountEl = document.getElementById("enabled-count");
  const globalEnabledCountEl = document.getElementById("global-enabled-count");
  const conflictCountEl = document.getElementById("conflict-count");
  const globalConflictCountEl = document.getElementById("global-conflict-count");
  const filterInput = document.getElementById("filter-input");
  const enabledOnlyInput = document.getElementById("enabled-only");
  const folderModal = document.getElementById("folder-modal");
  const folderModalTitle = document.getElementById("folder-modal-title");
  const folderModalPath = document.getElementById("folder-modal-path");
  const folderModalList = document.getElementById("folder-modal-list");
  const folderModalUp = document.getElementById("folder-modal-up");
  const folderModalChoose = document.getElementById("folder-modal-choose");
  const folderModalCancel = document.getElementById("folder-modal-cancel");

  function setMessage(kind, text) {
    messageBox.className = `notice ${kind}`;
    messageBox.textContent = text;
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

  function currentProject() {
    return projectInput.value.trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function refreshState(message) {
    setBusy(true);
    try {
      state.snapshot = await api.getState(currentProject() || null);
      render();
      if (state.snapshot.error) {
        setMessage("warn", state.snapshot.error);
      } else if (message) {
        setMessage("info", enabledCountMessage(message));
      } else {
        setMessage("info", enabledCountMessage("Library and repo state refreshed."));
      }
    } catch (error) {
      setMessage("error", error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action, successMessage) {
    setBusy(true);
    try {
      const result = await action();
      state.snapshot = result.state || state.snapshot;
      render();
      setMessage("info", enabledCountMessage(result.message || successMessage || "Done."));
    } catch (error) {
      setMessage("error", error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  function renderPills(target, items, emptyMessage) {
    target.innerHTML = "";
    if (!items.length) {
      target.innerHTML = `<div class="pill">${escapeHtml(emptyMessage)}</div>`;
      return;
    }
    items.forEach((skill) => {
      const el = document.createElement("div");
      el.className = "pill";
      el.textContent = skill.name;
      target.appendChild(el);
    });
  }

  function filteredSkills(snapshot) {
    const items = snapshot.skills || [];
    const query = state.filter.trim().toLowerCase();
    return items.filter((skill) => {
      if (state.enabledOnly && !skill.installed && !skill.global_installed) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.path.toLowerCase().includes(query)
      );
    });
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

  function renderSkills(snapshot) {
    const skills = filteredSkills(snapshot);
    skillsEl.innerHTML = "";
    if (!snapshot.configured) {
      skillsEl.innerHTML = '<div class="empty">Set a valid library root to start browsing skills.</div>';
      return;
    }
    if (!skills.length) {
      skillsEl.innerHTML = '<div class="empty">No skills match the current filter.</div>';
      return;
    }
    skills.forEach((skill) => {
      const card = document.createElement("article");
      card.className = `skill-card${skill.installed ? " installed" : ""}${skill.conflict ? " conflict" : ""}`;

      const top = document.createElement("div");
      top.className = "skill-top";

      const textWrap = document.createElement("div");
      const title = document.createElement("h3");
      title.className = "skill-name";
      title.textContent = skill.name;
      const desc = document.createElement("div");
      desc.className = "meta";
      desc.textContent = skill.description;
      textWrap.append(title, desc);

      const badges = document.createElement("div");
      badges.className = "badges";
      if (skill.installed) {
        const badge = document.createElement("span");
        badge.className = "badge repo";
        badge.textContent = "Repo";
        badges.appendChild(badge);
      }
      if (skill.global_installed) {
        const badge = document.createElement("span");
        badge.className = "badge global";
        badge.textContent = "Global";
        badges.appendChild(badge);
      }
      if (skill.conflict) {
        const badge = document.createElement("span");
        badge.className = "badge conflict";
        badge.textContent = "Repo conflict";
        badges.appendChild(badge);
      }
      if (skill.global_conflict) {
        const badge = document.createElement("span");
        badge.className = "badge conflict";
        badge.textContent = "Global conflict";
        badges.appendChild(badge);
      }
      top.append(textWrap, badges);

      const skillPath = document.createElement("div");
      skillPath.className = "path";
      skillPath.textContent = skill.path;

      card.append(top, skillPath);

      if (skill.conflict) {
        const conflictPath = document.createElement("div");
        conflictPath.className = "path";
        conflictPath.textContent = `Existing entry: ${skill.project_entry_target || skill.project_entry || ""}`;
        card.appendChild(conflictPath);
      }
      if (skill.global_conflict) {
        const globalConflictPath = document.createElement("div");
        globalConflictPath.className = "path";
        globalConflictPath.textContent = `Existing global entry: ${skill.global_entry_target || skill.global_entry || ""}`;
        card.appendChild(globalConflictPath);
      }

      const actions = document.createElement("div");
      actions.className = "row wrap";

      const repoButton = document.createElement("button");
      repoButton.type = "button";
      repoButton.className = skill.installed ? "danger" : "primary";
      repoButton.textContent = skill.installed
        ? "Disable In Repo"
        : skill.conflict
          ? "Replace Repo Link"
          : "Enable In Repo";
      repoButton.addEventListener("click", () => {
        if (skill.installed) {
          disableSkill(skill.name);
          return;
        }
        enableSkill(skill.name, Boolean(skill.conflict));
      });

      const globalButton = document.createElement("button");
      globalButton.type = "button";
      globalButton.className = skill.global_installed ? "danger" : "secondary";
      globalButton.textContent = skill.global_installed
        ? "Uninstall Global"
        : skill.global_conflict
          ? "Replace Global Link"
          : "Install Globally";
      globalButton.addEventListener("click", () => {
        if (skill.global_installed) {
          uninstallGlobalSkill(skill.name);
          return;
        }
        installGlobalSkill(skill.name, Boolean(skill.global_conflict));
      });

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "secondary";
      copyButton.textContent = "Copy Path";
      copyButton.addEventListener("click", () => copyText(skill.path));

      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "secondary";
      viewButton.textContent = "View";
      viewButton.addEventListener("click", () => viewSkill(skill.name));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "danger-outline";
      deleteButton.textContent = "Delete From Library";
      deleteButton.addEventListener("click", () => deleteLibrarySkill(skill));

      actions.append(repoButton, globalButton, copyButton, viewButton, deleteButton);
      card.appendChild(actions);
      skillsEl.appendChild(card);
    });
  }

  function render() {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }
    rootInput.value = snapshot.libraryRoot || rootInput.value;
    configPathEl.textContent = `Config: ${snapshot.configPath}`;
    projectRootEl.textContent = `Resolved project root: ${snapshot.projectRoot}`;
    libraryRootEl.textContent = snapshot.libraryRoot
      ? `Library root: ${snapshot.libraryRoot}`
      : "Library root is not configured.";
    globalRootEl.textContent = `Global skills root: ${snapshot.globalRoot || ""}`;
    skillCountEl.textContent = String(snapshot.skillCount || 0);
    enabledCountEl.textContent = String(snapshot.enabledCount || 0);
    globalEnabledCountEl.textContent = String(snapshot.globalEnabledCount || 0);
    conflictCountEl.textContent = String(snapshot.conflictCount || 0);
    globalConflictCountEl.textContent = String(snapshot.globalConflictCount || 0);
    renderPills(enabledListEl, snapshot.enabled || [], "No skills enabled in this repo.");
    renderPills(
      globalEnabledListEl,
      snapshot.globalEnabled || [],
      "No library skills installed globally."
    );
    renderSkills(snapshot);
    renderFolderBrowser();
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("info", `Copied: ${value}`);
    } catch {
      setMessage("warn", "Clipboard write failed in this browser context.");
    }
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
    } catch (error) {
      setMessage("error", error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function enableSkill(skill, force) {
    await runAction(() => api.enableSkill(skill, currentProject() || null, force));
  }

  async function disableSkill(skill) {
    await runAction(() => api.disableSkill(skill, currentProject() || null));
  }

  async function installGlobalSkill(skill, force) {
    await runAction(() => api.installGlobalSkill(skill, currentProject() || null, force));
  }

  async function uninstallGlobalSkill(skill) {
    await runAction(() => api.uninstallGlobalSkill(skill, currentProject() || null));
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
    await runAction(() => api.deleteLibrarySkill(skill.name, currentProject() || null));
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

  function chooseBrowserPath() {
    const selected = state.browser.currentPath;
    if (!selected) {
      setMessage("warn", "Pick a concrete folder first.");
      return;
    }
    if (state.browser.mode === "root") {
      rootInput.value = selected;
      setMessage("info", `Selected library root: ${selected}`);
    } else {
      projectInput.value = selected;
      setMessage("info", `Selected project folder: ${selected}`);
    }
    const selectedMode = state.browser.mode;
    closeFolderBrowser();
    if (selectedMode === "project") {
      refreshState(`Loaded project: ${selected}`);
    }
  }

  document.getElementById("browse-root").addEventListener("click", async () => {
    const startPath = rootInput.value.trim() || state.snapshot?.libraryRoot || "";
    try {
      const result = await api.pickFolder(startPath || null);
      if (result.cancelled || !result.selectedPath) {
        setMessage("info", "Folder selection cancelled.");
        return;
      }
      rootInput.value = result.selectedPath;
      setMessage("info", `Selected library root: ${result.selectedPath}`);
    } catch (error) {
      setMessage("warn", `${error.message} Opening the in-app browser instead.`);
      await openFolderBrowser("root", startPath);
    }
  });

  document.getElementById("browse-project").addEventListener("click", async () => {
    const startPath = currentProject() || state.snapshot?.projectRoot || "";
    try {
      const result = await api.pickFolder(startPath || null);
      if (result.cancelled || !result.selectedPath) {
        setMessage("info", "Folder selection cancelled.");
        return;
      }
      projectInput.value = result.selectedPath;
      await refreshState(`Loaded project: ${result.selectedPath}`);
    } catch (error) {
      setMessage("warn", `${error.message} Opening the in-app browser instead.`);
      await openFolderBrowser("project", startPath);
    }
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

  document.getElementById("root-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(() => api.setRoot(rootInput.value.trim(), currentProject() || null));
  });

  document.getElementById("project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await refreshState();
  });

  document.getElementById("refresh-root").addEventListener("click", () => refreshState());
  document.getElementById("refresh-project").addEventListener("click", () => refreshState());

  filterInput.addEventListener("input", () => {
    state.filter = filterInput.value;
    render();
  });

  enabledOnlyInput.addEventListener("change", () => {
    state.enabledOnly = enabledOnlyInput.checked;
    render();
  });

  async function init() {
    try {
      const bootstrap = await api.getBootstrap();
      projectInput.value = bootstrap.initialProject || "";
    } catch {
      projectInput.value = "";
    }
    await refreshState();
  }

  init();
})();
