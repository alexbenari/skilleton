#!/usr/bin/env python3
"""Core operations for the local skill library manager."""

from __future__ import annotations

from dataclasses import dataclass
import difflib
import json
import os
import re
import shutil
import stat
import subprocess

CONFIG_FILENAME = "local-skill-library.json"
SKILL_FILENAME = "SKILL.md"
SCHEMA_VERSION = 1
DEFAULT_LINK_MODE = "junction"


@dataclass
class SkillRecord:
    name: str
    path: str
    description: str


class SkillLibraryError(Exception):
    pass


def codex_home() -> str:
    return os.environ.get("CODEX_HOME", os.path.expanduser("~/.codex"))


def config_path() -> str:
    return os.path.join(codex_home(), CONFIG_FILENAME)


def _norm(path: str) -> str:
    return os.path.normcase(os.path.realpath(path))


def _first_sentence(text: str) -> str:
    cleaned = " ".join(text.split()).strip()
    if not cleaned:
        return "No description provided."
    match = re.match(r"(.+?[.!?])(?:\s|$)", cleaned)
    if match:
        return match.group(1).strip()
    return cleaned


def _description_from_skill_md(skill_md_path: str) -> str:
    try:
        raw = open(skill_md_path, "r", encoding="utf-8").read()
    except OSError:
        return "No description provided."
    if not raw.startswith("---"):
        return "No description provided."
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        return "No description provided."
    frontmatter: list[str] = []
    end_index = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            end_index = index
            break
        frontmatter.append(lines[index])
    if end_index is None:
        return "No description provided."
    for line in frontmatter:
        match = re.match(r"^\s*description\s*:\s*(.+?)\s*$", line)
        if not match:
            continue
        value = match.group(1).strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        return _first_sentence(value)
    return "No description provided."


def _ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def _read_config() -> dict[str, object]:
    cfg_path = config_path()
    if not os.path.isfile(cfg_path):
        raise SkillLibraryError(
            f"Config file not found: {cfg_path}. Run `set-root --path <absolute_path>` first."
        )
    try:
        data = json.load(open(cfg_path, "r", encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SkillLibraryError(f"Failed to read config {cfg_path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SkillLibraryError(f"Invalid config format in {cfg_path}.")
    root = data.get("library_root")
    if not isinstance(root, str) or not root.strip():
        raise SkillLibraryError(f"Invalid or missing `library_root` in {cfg_path}.")
    link_mode = data.get("link_mode")
    if link_mode != DEFAULT_LINK_MODE:
        raise SkillLibraryError(
            f"Invalid or unsupported `link_mode` in {cfg_path}. Expected `{DEFAULT_LINK_MODE}`."
        )
    normalized_root = os.path.abspath(os.path.expanduser(root))
    if not os.path.isdir(normalized_root):
        raise SkillLibraryError(
            f"Configured library root does not exist: {normalized_root}. "
            "Run `set-root --path <absolute_path>`."
        )
    data["library_root"] = normalized_root
    return data


def _write_config(root_path: str) -> str:
    cfg_path = config_path()
    payload = {
        "schema_version": SCHEMA_VERSION,
        "library_root": root_path,
        "link_mode": DEFAULT_LINK_MODE,
    }
    _ensure_parent_dir(cfg_path)
    tmp = cfg_path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(tmp, cfg_path)
    except OSError as exc:
        raise SkillLibraryError(f"Failed to write config {cfg_path}: {exc}") from exc
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return cfg_path


def _discover_skills(root: str) -> tuple[dict[str, SkillRecord], dict[str, list[str]]]:
    found: dict[str, SkillRecord] = {}
    collisions: dict[str, list[str]] = {}
    for current_root, dirs, files in os.walk(root):
        dirs.sort()
        files.sort()
        if SKILL_FILENAME not in files:
            continue
        name = os.path.basename(current_root)
        skill_md_path = os.path.join(current_root, SKILL_FILENAME)
        desc = _description_from_skill_md(skill_md_path)
        record = SkillRecord(name=name, path=current_root, description=desc)
        if name in found:
            collisions.setdefault(name, [found[name].path]).append(current_root)
        else:
            found[name] = record
    return found, collisions


def resolve_project_root(project: str | None) -> str:
    if project:
        start = os.path.abspath(os.path.expanduser(project))
    else:
        start = os.getcwd()
    if os.path.isfile(start):
        start = os.path.dirname(start)
    current = start
    while True:
        git_path = os.path.join(current, ".git")
        if os.path.isdir(git_path) or os.path.isfile(git_path):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return start
        current = parent


def project_skill_path(project_root: str, skill_name: str) -> str:
    return os.path.join(project_root, ".agents", "skills", skill_name)


def global_skills_root() -> str:
    return os.path.join(codex_home(), "skills")


def global_skill_path(skill_name: str) -> str:
    return os.path.join(global_skills_root(), skill_name)


def _entry_state(entry_path: str, skill_path: str) -> tuple[bool, bool]:
    if not os.path.lexists(entry_path):
        return False, False
    try:
        equivalent = _norm(entry_path) == _norm(skill_path)
    except OSError:
        equivalent = False
    if equivalent:
        return True, False
    return False, True


def _remove_path(path: str) -> None:
    if not os.path.lexists(path):
        return
    try:
        if os.path.islink(path):
            os.unlink(path)
            return
        if os.path.isdir(path):
            st = os.lstat(path)
            attrs = getattr(st, "st_file_attributes", 0)
            is_reparse_point = bool(
                attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
            )
            if is_reparse_point:
                os.rmdir(path)
                return
            shutil.rmtree(path)
            return
        os.unlink(path)
    except OSError as exc:
        raise SkillLibraryError(f"Failed to remove {path}: {exc}") from exc


def _create_junction(link_path: str, target_path: str) -> None:
    _ensure_parent_dir(link_path)
    if os.name == "nt":
        cmd = ["cmd", "/c", "mklink", "/J", link_path, target_path]
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if result.returncode != 0:
            msg = result.stderr.strip() or result.stdout.strip() or "mklink failed"
            raise SkillLibraryError(f"Failed to create junction {link_path}: {msg}")
        return
    try:
        os.symlink(target_path, link_path, target_is_directory=True)
    except OSError as exc:
        raise SkillLibraryError(f"Failed to create symlink {link_path}: {exc}") from exc


def _closest_skill_names(name: str, choices: list[str]) -> list[str]:
    return difflib.get_close_matches(name, choices, n=3, cutoff=0.4)


def _get_skill_or_error(skill_name: str, skills: dict[str, SkillRecord]) -> SkillRecord:
    if skill_name in skills:
        return skills[skill_name]
    suggestions = _closest_skill_names(skill_name, sorted(skills.keys()))
    if suggestions:
        raise SkillLibraryError(
            f"Skill `{skill_name}` not found. Closest matches: {', '.join(suggestions)}."
        )
    raise SkillLibraryError(f"Skill `{skill_name}` not found.")


def _fail_on_collisions(collisions: dict[str, list[str]]) -> None:
    if not collisions:
        return
    lines = ["Duplicate skill names found in library:"]
    for name in sorted(collisions):
        lines.append(f"- {name}")
        for path in sorted(collisions[name]):
            lines.append(f"  {path}")
    raise SkillLibraryError("\n".join(lines))


def load_skills_from_config() -> tuple[dict[str, SkillRecord], str]:
    cfg = _read_config()
    root = str(cfg["library_root"])
    skills, collisions = _discover_skills(root)
    _fail_on_collisions(collisions)
    return skills, root


def _apply_scope_state(
    row: dict[str, object],
    entry_path: str,
    skill_path: str,
    installed_key: str,
    conflict_key: str,
    entry_key: str,
    target_key: str,
) -> None:
    installed, conflict = _entry_state(entry_path, skill_path)
    row[installed_key] = installed
    if conflict:
        row[conflict_key] = True
        row[entry_key] = entry_path
        try:
            row[target_key] = os.path.realpath(entry_path)
        except OSError:
            pass


def enumerate_rows(project_root: str, skills: dict[str, SkillRecord]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for name in sorted(skills.keys()):
        skill = skills[name]
        row: dict[str, object] = {
            "name": name,
            "path": skill.path,
            "description": skill.description,
        }
        _apply_scope_state(
            row,
            project_skill_path(project_root, name),
            skill.path,
            "installed",
            "conflict",
            "project_entry",
            "project_entry_target",
        )
        _apply_scope_state(
            row,
            global_skill_path(name),
            skill.path,
            "global_installed",
            "global_conflict",
            "global_entry",
            "global_entry_target",
        )
        rows.append(row)
    return rows


def read_root() -> str:
    cfg = _read_config()
    return str(cfg["library_root"])


def set_root(path: str) -> dict[str, str]:
    root_path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isabs(root_path):
        raise SkillLibraryError("`--path` must be an absolute path.")
    if not os.path.isdir(root_path):
        raise SkillLibraryError(
            f"Library root does not exist or is not a directory: {root_path}"
        )
    cfg_path = _write_config(root_path)
    return {"root_path": root_path, "config_path": cfg_path}


def delete_library_skill(skill_name: str, project: str | None = None) -> dict[str, str]:
    skills, library_root = load_skills_from_config()
    skill = _get_skill_or_error(skill_name, skills)
    project_root = resolve_project_root(project)
    repo_entry = project_skill_path(project_root, skill.name)
    global_entry = global_skill_path(skill.name)
    repo_installed, _ = _entry_state(repo_entry, skill.path)
    global_installed, _ = _entry_state(global_entry, skill.path)
    if repo_installed:
        raise SkillLibraryError(
            f"Skill `{skill.name}` is enabled in the current project. Disable it before deleting it from the library."
        )
    if global_installed:
        raise SkillLibraryError(
            f"Skill `{skill.name}` is installed globally. Uninstall it before deleting it from the library."
        )
    normalized_library_root = _norm(library_root)
    normalized_skill_path = _norm(skill.path)
    try:
        inside_library = os.path.commonpath([normalized_library_root, normalized_skill_path]) == normalized_library_root
    except ValueError:
        inside_library = False
    if not inside_library:
        raise SkillLibraryError(
            f"Refusing to delete skill outside the configured library root: {skill.path}"
        )
    _remove_path(skill.path)
    return {
        "skill": skill.name,
        "path": skill.path,
        "project_root": project_root,
        "library_root": library_root,
        "status": "deleted",
    }


def read_skill_markdown(skill_name: str) -> dict[str, str]:
    skills, _ = load_skills_from_config()
    skill = _get_skill_or_error(skill_name, skills)
    skill_md_path = os.path.join(skill.path, SKILL_FILENAME)
    try:
        content = open(skill_md_path, "r", encoding="utf-8").read()
    except OSError as exc:
        raise SkillLibraryError(f"Failed to read {skill_md_path}: {exc}") from exc
    return {
        "skill": skill.name,
        "path": skill_md_path,
        "content": content,
    }


def enumerate_skills(project: str | None = None) -> dict[str, object]:
    skills, library_root = load_skills_from_config()
    project_root = resolve_project_root(project)
    rows = enumerate_rows(project_root, skills)
    enabled = [row for row in rows if bool(row.get("installed"))]
    conflicts = [row for row in rows if bool(row.get("conflict"))]
    global_enabled = [row for row in rows if bool(row.get("global_installed"))]
    global_conflicts = [row for row in rows if bool(row.get("global_conflict"))]
    return {
        "config_path": config_path(),
        "codex_home": codex_home(),
        "global_root": global_skills_root(),
        "library_root": library_root,
        "project_root": project_root,
        "skills": rows,
        "enabled": enabled,
        "conflicts": conflicts,
        "global_enabled": global_enabled,
        "global_conflicts": global_conflicts,
    }


def enable_skill(
    skill_name: str, project: str | None = None, force: bool = False
) -> dict[str, str]:
    skills, _ = load_skills_from_config()
    skill = _get_skill_or_error(skill_name, skills)
    project_root = resolve_project_root(project)
    entry = project_skill_path(project_root, skill.name)
    installed, conflict = _entry_state(entry, skill.path)
    if installed:
        return {
            "skill": skill.name,
            "project_root": project_root,
            "entry": entry,
            "path": skill.path,
            "status": "already-enabled",
        }
    if conflict and not force:
        raise SkillLibraryError(
            f"Conflicting entry exists at {entry}. Use `--force` to replace it."
        )
    if conflict and force:
        _remove_path(entry)
    elif os.path.lexists(entry):
        if force:
            _remove_path(entry)
        else:
            raise SkillLibraryError(
                f"Path already exists at {entry}. Use `--force` to replace it."
            )
    _create_junction(entry, skill.path)
    return {
        "skill": skill.name,
        "project_root": project_root,
        "entry": entry,
        "path": skill.path,
        "status": "enabled",
    }


def disable_skill(skill_name: str, project: str | None = None) -> dict[str, str]:
    load_skills_from_config()
    project_root = resolve_project_root(project)
    entry = project_skill_path(project_root, skill_name)
    if not os.path.lexists(entry):
        return {
            "skill": skill_name,
            "project_root": project_root,
            "entry": entry,
            "status": "not-enabled",
        }
    _remove_path(entry)
    return {
        "skill": skill_name,
        "project_root": project_root,
        "entry": entry,
        "status": "disabled",
    }


def install_global_skill(skill_name: str, force: bool = False) -> dict[str, str]:
    skills, _ = load_skills_from_config()
    skill = _get_skill_or_error(skill_name, skills)
    entry = global_skill_path(skill.name)
    installed, conflict = _entry_state(entry, skill.path)
    if installed:
        return {
            "skill": skill.name,
            "entry": entry,
            "path": skill.path,
            "global_root": global_skills_root(),
            "status": "already-installed",
        }
    if conflict and not force:
        raise SkillLibraryError(
            f"Conflicting global entry exists at {entry}. Use `--force` to replace it."
        )
    if conflict and force:
        _remove_path(entry)
    elif os.path.lexists(entry):
        if force:
            _remove_path(entry)
        else:
            raise SkillLibraryError(
                f"Path already exists at {entry}. Use `--force` to replace it."
            )
    _create_junction(entry, skill.path)
    return {
        "skill": skill.name,
        "entry": entry,
        "path": skill.path,
        "global_root": global_skills_root(),
        "status": "installed",
    }


def uninstall_global_skill(skill_name: str) -> dict[str, str]:
    load_skills_from_config()
    entry = global_skill_path(skill_name)
    if not os.path.lexists(entry):
        return {
            "skill": skill_name,
            "entry": entry,
            "global_root": global_skills_root(),
            "status": "not-installed",
        }
    _remove_path(entry)
    return {
        "skill": skill_name,
        "entry": entry,
        "global_root": global_skills_root(),
        "status": "uninstalled",
    }


def list_enabled_skills(project: str | None = None) -> dict[str, object]:
    overview = enumerate_skills(project)
    return {
        "config_path": str(overview["config_path"]),
        "library_root": str(overview["library_root"]),
        "project_root": str(overview["project_root"]),
        "skills": list(overview["enabled"]),
    }


def list_global_skills() -> dict[str, object]:
    overview = enumerate_skills()
    return {
        "config_path": str(overview["config_path"]),
        "library_root": str(overview["library_root"]),
        "global_root": str(overview["global_root"]),
        "skills": list(overview["global_enabled"]),
    }


def status_snapshot(project: str | None = None) -> dict[str, object]:
    project_root = resolve_project_root(project)
    snapshot: dict[str, object] = {
        "configured": False,
        "config_path": config_path(),
        "codex_home": codex_home(),
        "global_root": global_skills_root(),
        "project_root": project_root,
    }
    try:
        overview = enumerate_skills(project_root)
    except SkillLibraryError as exc:
        snapshot["error"] = str(exc)
        return snapshot
    snapshot["configured"] = True
    snapshot["library_root"] = overview["library_root"]
    snapshot["skills"] = overview["skills"]
    snapshot["enabled"] = overview["enabled"]
    snapshot["conflicts"] = overview["conflicts"]
    snapshot["global_enabled"] = overview["global_enabled"]
    snapshot["global_conflicts"] = overview["global_conflicts"]
    snapshot["skill_count"] = len(overview["skills"])
    snapshot["enabled_count"] = len(overview["enabled"])
    snapshot["conflict_count"] = len(overview["conflicts"])
    snapshot["global_enabled_count"] = len(overview["global_enabled"])
    snapshot["global_conflict_count"] = len(overview["global_conflicts"])
    return snapshot
