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

CONFIG_FILENAME = "local-skill-library.json"
LIBRARY_CONFIG_FILENAME = ".skill-library-manager.json"
SKILL_FILENAME = "SKILL.md"
SCHEMA_VERSION = 1
DEFAULT_LINK_MODE = "junction"
PACKAGED_SKILL_LOCATIONS = [
    (".agents", "skills"),
    ("plugin", "skills"),
    (".claude", "skills"),
    (".cursor", "skills"),
    (".gemini", "skills"),
    (".github", "skills"),
    (".kiro", "skills"),
    (".opencode", "skills"),
    (".pi", "skills"),
    (".qoder", "skills"),
    (".rovodev", "skills"),
    (".trae", "skills"),
    (".trae-cn", "skills"),
]


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


def library_config_path(library_root: str) -> str:
    return os.path.join(library_root, LIBRARY_CONFIG_FILENAME)


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


def _read_json_file(path: str) -> dict[str, object]:
    try:
        data = json.load(open(path, "r", encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SkillLibraryError(f"Failed to read config {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SkillLibraryError(f"Invalid config format in {path}.")
    return data


def _write_json_file(path: str, payload: dict[str, object]) -> None:
    _ensure_parent_dir(path)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(tmp, path)
    except OSError as exc:
        raise SkillLibraryError(f"Failed to write config {path}: {exc}") from exc
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _read_config() -> dict[str, object]:
    pointer_path = config_path()
    if not os.path.isfile(pointer_path):
        raise SkillLibraryError(
            f"Config file not found: {pointer_path}. Run `set-root --path <absolute_path>` first."
        )
    pointer_data = _read_json_file(pointer_path)
    root = pointer_data.get("library_root")
    if not isinstance(root, str) or not root.strip():
        raise SkillLibraryError(f"Invalid or missing `library_root` in {pointer_path}.")
    normalized_root = os.path.abspath(os.path.expanduser(root))
    if not os.path.isdir(normalized_root):
        raise SkillLibraryError(
            f"Configured library root does not exist: {normalized_root}. "
            "Run `set-root --path <absolute_path>`."
        )
    cfg_path = library_config_path(normalized_root)
    if os.path.isfile(cfg_path):
        data = _read_json_file(cfg_path)
    else:
        data = {
            "schema_version": SCHEMA_VERSION,
            "link_mode": pointer_data.get("link_mode", DEFAULT_LINK_MODE),
        }
        _write_library_config(normalized_root, data)
    link_mode = data.get("link_mode")
    if link_mode != DEFAULT_LINK_MODE:
        raise SkillLibraryError(
            f"Invalid or unsupported `link_mode` in {cfg_path}. Expected `{DEFAULT_LINK_MODE}`."
        )
    data["library_root"] = normalized_root
    data["config_path"] = cfg_path
    data["pointer_path"] = pointer_path
    return data


def _write_library_pointer(root_path: str) -> str:
    pointer_path = config_path()
    payload = {
        "schema_version": SCHEMA_VERSION,
        "library_root": root_path,
    }
    _write_json_file(pointer_path, payload)
    return pointer_path


def _write_library_config(root_path: str, overrides: dict[str, object] | None = None) -> str:
    cfg_path = library_config_path(root_path)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "link_mode": DEFAULT_LINK_MODE,
    }
    if overrides:
        payload.update(overrides)
    _write_json_file(cfg_path, payload)
    return cfg_path


def _write_config(root_path: str) -> str:
    _write_library_pointer(root_path)
    return _write_library_config(root_path)


def _discover_skills(root: str) -> tuple[dict[str, SkillRecord], dict[str, list[str]]]:
    candidates_by_name: dict[str, list[SkillRecord]] = {}
    for current_root, dirs, files in os.walk(root):
        dirs.sort()
        files.sort()
        if SKILL_FILENAME not in files:
            continue
        name = os.path.basename(current_root)
        skill_md_path = os.path.join(current_root, SKILL_FILENAME)
        desc = _description_from_skill_md(skill_md_path)
        record = SkillRecord(name=name, path=current_root, description=desc)
        candidates_by_name.setdefault(name, []).append(record)
    return _resolve_skill_candidates(root, candidates_by_name)


def _packaged_skill_info(root: str, skill_path: str, skill_name: str) -> tuple[int, str] | None:
    relative_path = os.path.relpath(skill_path, root)
    if relative_path == os.curdir or relative_path.startswith(os.pardir + os.sep):
        return None
    parts = relative_path.split(os.sep)
    if not parts or parts[-1] != skill_name:
        return None
    for priority, location in enumerate(PACKAGED_SKILL_LOCATIONS):
        location_start = len(parts) - len(location) - 1
        if location_start < 0:
            continue
        if tuple(parts[location_start : location_start + len(location)]) == location:
            source_root = os.path.abspath(os.path.join(root, *parts[:location_start]))
            return priority, source_root
    return None


def _collapse_packaged_variants(
    root: str, name: str, candidates: list[SkillRecord]
) -> SkillRecord | None:
    variants: list[tuple[SkillRecord, tuple[int, str]]] = []
    for candidate in candidates:
        info = _packaged_skill_info(root, candidate.path, name)
        if info is None:
            return None
        variants.append((candidate, info))
    source_roots = {_norm(info[1]) for _, info in variants}
    if len(source_roots) != 1:
        return None
    variants.sort(key=lambda variant: (variant[1][0], variant[0].path))
    return variants[0][0]


def _resolve_skill_candidates(
    root: str, candidates_by_name: dict[str, list[SkillRecord]]
) -> tuple[dict[str, SkillRecord], dict[str, list[str]]]:
    found: dict[str, SkillRecord] = {}
    collisions: dict[str, list[str]] = {}
    for name, candidates in candidates_by_name.items():
        if len(candidates) == 1:
            found[name] = candidates[0]
            continue
        collapsed = _collapse_packaged_variants(root, name, candidates)
        if collapsed is not None:
            found[name] = collapsed
        else:
            collisions[name] = [candidate.path for candidate in candidates]
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


def _list_relative_entries(root_path: str) -> list[tuple[str, str, str | None]]:
    entries: list[tuple[str, str, str | None]] = []
    for current_root, dirs, files in os.walk(root_path, topdown=True, followlinks=False):
        dirs.sort()
        files.sort()
        for dir_name in dirs:
            absolute_path = os.path.join(current_root, dir_name)
            relative_path = os.path.relpath(absolute_path, root_path)
            if os.path.islink(absolute_path):
                entries.append((relative_path, "symlink", os.readlink(absolute_path)))
            else:
                entries.append((relative_path, "directory", None))
        for file_name in files:
            absolute_path = os.path.join(current_root, file_name)
            relative_path = os.path.relpath(absolute_path, root_path)
            if os.path.islink(absolute_path):
                entries.append((relative_path, "symlink", os.readlink(absolute_path)))
            else:
                entries.append((relative_path, "file", None))
    entries.sort(key=lambda item: item[0])
    return entries


def _compare_directory_trees(source_path: str, target_path: str) -> bool:
    source_entries = _list_relative_entries(source_path)
    target_entries = _list_relative_entries(target_path)
    if len(source_entries) != len(target_entries):
        return False
    for source_entry, target_entry in zip(source_entries, target_entries):
        if source_entry != target_entry:
            return False
        relative_path, entry_kind, _ = source_entry
        if entry_kind != "file":
            continue
        with open(os.path.join(source_path, relative_path), "rb") as source_handle:
            source_bytes = source_handle.read()
        with open(os.path.join(target_path, relative_path), "rb") as target_handle:
            target_bytes = target_handle.read()
        if source_bytes != target_bytes:
            return False
    return True


def _is_installed_state(state: str) -> bool:
    return state in {"copied-match", "copied-modified", "linked-match"}


def _is_conflict_state(state: str) -> bool:
    return state == "foreign-conflict"


def _copy_tree(source_path: str, target_path: str) -> None:
    if os.path.lexists(target_path):
        _remove_path(target_path)
    _ensure_parent_dir(target_path)
    try:
        shutil.copytree(source_path, target_path, symlinks=True)
    except OSError as exc:
        raise SkillLibraryError(
            f"Failed to copy {source_path} to {target_path}: {exc}"
        ) from exc


def _install_state(entry_path: str, skill_path: str) -> str:
    if not os.path.lexists(entry_path):
        return "missing"
    try:
        if os.path.islink(entry_path):
            try:
                equivalent = _norm(entry_path) == _norm(skill_path)
            except OSError:
                equivalent = False
            return "linked-match" if equivalent else "foreign-conflict"
        if not os.path.isdir(entry_path):
            return "foreign-conflict"
        if not os.path.isfile(os.path.join(entry_path, SKILL_FILENAME)):
            return "foreign-conflict"
        return (
            "copied-match"
            if _compare_directory_trees(skill_path, entry_path)
            else "copied-modified"
        )
    except OSError as exc:
        raise SkillLibraryError(f"Failed to inspect {entry_path}: {exc}") from exc


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
    state_key: str,
) -> None:
    state = _install_state(entry_path, skill_path)
    row[state_key] = state
    row[installed_key] = _is_installed_state(state)
    if _is_conflict_state(state):
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
            "project_install_state",
        )
        _apply_scope_state(
            row,
            global_skill_path(name),
            skill.path,
            "global_installed",
            "global_conflict",
            "global_entry",
            "global_entry_target",
            "global_install_state",
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
    repo_installed = _is_installed_state(_install_state(repo_entry, skill.path))
    global_installed = _is_installed_state(_install_state(global_entry, skill.path))
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
    cfg = _read_config()
    library_root = str(cfg["library_root"])
    skills, collisions = _discover_skills(library_root)
    _fail_on_collisions(collisions)
    project_root = resolve_project_root(project)
    rows = enumerate_rows(project_root, skills)
    enabled = [row for row in rows if bool(row.get("installed"))]
    conflicts = [row for row in rows if bool(row.get("conflict"))]
    global_enabled = [row for row in rows if bool(row.get("global_installed"))]
    global_conflicts = [row for row in rows if bool(row.get("global_conflict"))]
    return {
        "config_path": str(cfg["config_path"]),
        "pointer_path": str(cfg["pointer_path"]),
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
    current = _install_state(entry, skill.path)
    if current == "missing":
        _copy_tree(skill.path, entry)
        return {
            "skill": skill.name,
            "project_root": project_root,
            "entry": entry,
            "path": skill.path,
            "status": "enabled",
        }
    if current == "linked-match":
        _copy_tree(skill.path, entry)
        return {
            "skill": skill.name,
            "project_root": project_root,
            "entry": entry,
            "path": skill.path,
            "status": "migrated-link",
        }
    if current == "copied-match":
        _copy_tree(skill.path, entry)
        return {
            "skill": skill.name,
            "project_root": project_root,
            "entry": entry,
            "path": skill.path,
            "status": "refreshed",
        }
    if current in {"copied-modified", "foreign-conflict"} and not force:
        return {
            "skill": skill.name,
            "project_root": project_root,
            "entry": entry,
            "path": skill.path,
            "status": "blocked-modified",
        }
    _copy_tree(skill.path, entry)
    return {
        "skill": skill.name,
        "project_root": project_root,
        "entry": entry,
        "path": skill.path,
        "status": "replaced",
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
    current = _install_state(entry, skill.path)
    if current == "missing":
        _copy_tree(skill.path, entry)
        return {
            "skill": skill.name,
            "entry": entry,
            "path": skill.path,
            "global_root": global_skills_root(),
            "status": "installed",
        }
    if current == "linked-match":
        _copy_tree(skill.path, entry)
        return {
            "skill": skill.name,
            "entry": entry,
            "path": skill.path,
            "global_root": global_skills_root(),
            "status": "migrated-link",
        }
    if current == "copied-match":
        _copy_tree(skill.path, entry)
        return {
            "skill": skill.name,
            "entry": entry,
            "path": skill.path,
            "global_root": global_skills_root(),
            "status": "refreshed",
        }
    if current in {"copied-modified", "foreign-conflict"} and not force:
        return {
            "skill": skill.name,
            "entry": entry,
            "path": skill.path,
            "global_root": global_skills_root(),
            "status": "blocked-modified",
        }
    _copy_tree(skill.path, entry)
    return {
        "skill": skill.name,
        "entry": entry,
        "path": skill.path,
        "global_root": global_skills_root(),
        "status": "replaced",
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
    snapshot["config_path"] = overview["config_path"]
    snapshot["pointer_path"] = overview["pointer_path"]
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
