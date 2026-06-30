---
name: skill-library-manager
description: Manage a local skill library and enable or disable skills per project without making them globally available by default. Use when setting the skill library location, enumerating available skills with install status and one-sentence descriptions, or copying/removing skills in `.agents/skills` for the current project.
---

# Skill Library Manager

Use the Electron app for the desktop UI and `scripts/skill-library.py` if you want the legacy CLI.

## Workflow

1. Configure the library root once:

```bash
python scripts/skill-library.py set-root --path C:\dev\skills-main
```

2. Enumerate skills for the current project, including install markers and one-sentence descriptions:

```bash
python scripts/skill-library.py enumerate
```

3. Enable a skill in the current project (`.agents/skills/<skill-name>`):

```bash
python scripts/skill-library.py enable --skill brainstorming
```

4. Install a skill globally for all projects (`~/.codex/skills/<skill-name>`):

```bash
python scripts/skill-library.py install-global --skill brainstorming
```

5. Disable a project skill copy:

```bash
python scripts/skill-library.py disable --skill brainstorming
```

6. Remove a global skill copy:

```bash
python scripts/skill-library.py uninstall-global --skill brainstorming
```

7. Install desktop dependencies once:

```bash
npm install
```

8. Launch the Electron app:

```bash
npm start -- --project=C:\dev\my-repo
```

9. In the app, use `Add Skills` to paste a repo URL and clone it into the configured library root. Any folders inside that repo containing `SKILL.md` will then appear automatically.

## Commands

- `set-root --path <absolute-path>`
- `show-root`
- `enumerate [--project <path>] [--json]`
- `enable --skill <name> [--project <path>] [--force]`
- `disable --skill <name> [--project <path>]`
- `list-enabled [--project <path>] [--json]`
- `install-global --skill <name> [--force]`
- `uninstall-global --skill <name>`
- `list-global [--json]`
- Electron app entrypoint: `npm start [-- --project=<path>]`
- Legacy CLI UI: `serve-ui [--host <host>] [--port <port>] [--project <path>]`

## Notes

- Library config file location: `<library-root>/.skill-library-manager.json`
- Root pointer file location: `~/.codex/local-skill-library.json`
- Library skill discovery is recursive and uses folders containing `SKILL.md`.
- Duplicate skill names are treated as an error to avoid ambiguous installs.
- Project installs are copied into `.agents/skills/<skill-name>`.
- Global installs are copied into `~/.codex/skills/<skill-name>`.
- The Electron UI uses a native folder picker and runs filesystem operations through the Electron main process rather than the old Python HTTP server.
- The Electron UI opens on a compact command strip with short `Library` and `Project` labels, search, filter chips, a summary line, and a small visible status area.
- `Enabled Here` and `Installed Globally` are available from the right-side panel, while skill cards remain the main working surface.
- The UI lets you set the library root, inspect a target repo, filter available skills, manage both repo-local and global installs, and delete a skill from the library root after it has been removed from the current repo and global scope.
- `Add Skills` clones a pasted Git repo URL into the configured library root, then refreshes the discovered skills.
