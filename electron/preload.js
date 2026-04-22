const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("skillManager", {
  getBootstrap: () => invoke("skill-manager:get-bootstrap"),
  getState: (project) => invoke("skill-manager:get-state", project),
  setRoot: (rootPath, project) => invoke("skill-manager:set-root", rootPath, project),
  enableSkill: (skill, project, force) =>
    invoke("skill-manager:enable-skill", skill, project, force),
  disableSkill: (skill, project) => invoke("skill-manager:disable-skill", skill, project),
  installGlobalSkill: (skill, project, force) =>
    invoke("skill-manager:install-global", skill, project, force),
  uninstallGlobalSkill: (skill, project) =>
    invoke("skill-manager:uninstall-global", skill, project),
  deleteLibrarySkill: (skill, project) =>
    invoke("skill-manager:delete-library-skill", skill, project),
  readSkillMarkdown: (skill) => invoke("skill-manager:read-skill-markdown", skill),
  listDirectories: (targetPath) => invoke("skill-manager:list-directories", targetPath),
  pickFolder: (defaultPath) => invoke("skill-manager:pick-folder", defaultPath),
});
