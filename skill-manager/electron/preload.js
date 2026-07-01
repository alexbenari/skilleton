const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("skillManager", {
  getBootstrap: () => invoke("skill-manager:get-bootstrap"),
  getState: (project, options) => invoke("skill-manager:get-state", project, options),
  refreshRepoStatuses: (project, options) =>
    invoke("skill-manager:refresh-repo-statuses", project, options),
  setRoot: (rootPath, project) => invoke("skill-manager:set-root", rootPath, project),
  listLibraries: () => invoke("skill-manager:list-libraries"),
  selectLibrary: (libraryId, project) =>
    invoke("skill-manager:select-library", libraryId, project),
  refreshLibrary: (libraryId, project) =>
    invoke("skill-manager:refresh-library", libraryId, project),
  deleteLibrary: (libraryId, project) =>
    invoke("skill-manager:delete-library", libraryId, project),
  cloneSkillsRepo: (repoUrl, project) =>
    invoke("skill-manager:clone-skills-repo", repoUrl, project),
  cleanupImportedRepository: (destination, project) =>
    invoke("skill-manager:cleanup-imported-repository", destination, project),
  enableSkill: (skill, project, force) =>
    invoke("skill-manager:enable-skill", skill, project, force),
  disableSkill: (skill, project) => invoke("skill-manager:disable-skill", skill, project),
  installGlobalSkill: (skill, project, force) =>
    invoke("skill-manager:install-global", skill, project, force),
  uninstallGlobalSkill: (skill, project) =>
    invoke("skill-manager:uninstall-global", skill, project),
  updateSkillRepo: (skill, project) =>
    invoke("skill-manager:update-skill-repo", skill, project),
  setSkillTags: (skill, tags, project) =>
    invoke("skill-manager:set-skill-tags", skill, tags, project),
  deleteLibrarySkill: (skill, project) =>
    invoke("skill-manager:delete-library-skill", skill, project),
  readSkillMarkdown: (skill) => invoke("skill-manager:read-skill-markdown", skill),
  listDirectories: (targetPath) => invoke("skill-manager:list-directories", targetPath),
  pickFolder: (defaultPath) => invoke("skill-manager:pick-folder", defaultPath),
  openExternal: (targetUrl) => invoke("skill-manager:open-external", targetUrl),
});
