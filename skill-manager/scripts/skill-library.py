#!/usr/bin/env python3
"""Manage a local skill library and project-level copied skill installs."""

from __future__ import annotations

import argparse
import json
import sys

from skill_library_core import (
    SkillLibraryError,
    disable_skill,
    enable_skill,
    enumerate_skills,
    install_global_skill,
    list_enabled_skills,
    list_global_skills,
    read_root,
    set_root,
    uninstall_global_skill,
)
from skill_library_ui import run_ui_server


def _print_enumerate(rows: list[dict[str, object]]) -> None:
    repo_conflicts: list[str] = []
    global_conflicts: list[str] = []
    for row in rows:
        name = str(row["name"])
        desc = str(row["description"])
        markers: list[str] = []
        if bool(row.get("installed")):
            markers.append("<REPO>")
        if bool(row.get("global_installed")):
            markers.append("<GLOBAL>")
        marker_text = f" {' '.join(markers)}" if markers else ""
        print(f"[{name}]{marker_text} - {desc}")
        if row.get("conflict"):
            repo_conflicts.append(name)
        if row.get("global_conflict"):
            global_conflicts.append(name)
    if repo_conflicts:
        print(
            f"Warning: conflicting project entries for: {', '.join(repo_conflicts)}.",
            file=sys.stderr,
        )
    if global_conflicts:
        print(
            f"Warning: conflicting global entries for: {', '.join(global_conflicts)}.",
            file=sys.stderr,
        )


def _cmd_set_root(args: argparse.Namespace) -> int:
    result = set_root(args.path)
    print(f"Library root set to: {result['root_path']}")
    print(f"Config saved: {result['config_path']}")
    return 0


def _cmd_show_root(_: argparse.Namespace) -> int:
    print(read_root())
    return 0


def _cmd_enumerate(args: argparse.Namespace) -> int:
    result = enumerate_skills(args.project)
    if args.json:
        print(json.dumps(result["skills"], indent=2, sort_keys=True))
    else:
        _print_enumerate(list(result["skills"]))
    return 0


def _cmd_enable(args: argparse.Namespace) -> int:
    result = enable_skill(args.skill, project=args.project, force=args.force)
    if result["status"] == "blocked-modified":
        print(
            f"Skill copy differs from the library: {result['entry']}. "
            "Re-run with `--force` to replace it."
        )
        return 1
    print(f"Updated skill `{result['skill']}` for project: {result['project_root']}")
    print(f"Copied files into: {result['entry']}")
    return 0


def _cmd_disable(args: argparse.Namespace) -> int:
    result = disable_skill(args.skill, project=args.project)
    if result["status"] == "not-enabled":
        print(f"Skill not enabled in project: {result['skill']}")
        return 0
    print(f"Disabled skill `{result['skill']}` for project: {result['project_root']}")
    return 0


def _cmd_list_enabled(args: argparse.Namespace) -> int:
    result = list_enabled_skills(args.project)
    if args.json:
        print(json.dumps(result["skills"], indent=2, sort_keys=True))
        return 0
    if not result["skills"]:
        print("No library skills enabled in this project.")
        return 0
    for row in result["skills"]:
        print(f"[{row['name']}] <INSTALLED> - {row['description']}")
    return 0


def _cmd_install_global(args: argparse.Namespace) -> int:
    result = install_global_skill(args.skill, force=args.force)
    if result["status"] == "blocked-modified":
        print(
            f"Global skill copy differs from the library: {result['entry']}. "
            "Re-run with `--force` to replace it."
        )
        return 1
    print(f"Updated global skill `{result['skill']}` in: {result['global_root']}")
    print(f"Copied files into: {result['entry']}")
    return 0


def _cmd_uninstall_global(args: argparse.Namespace) -> int:
    result = uninstall_global_skill(args.skill)
    if result["status"] == "not-installed":
        print(f"Skill not installed globally: {result['skill']}")
        return 0
    print(f"Uninstalled global skill `{result['skill']}` from: {result['global_root']}")
    return 0


def _cmd_list_global(args: argparse.Namespace) -> int:
    result = list_global_skills()
    if args.json:
        print(json.dumps(result["skills"], indent=2, sort_keys=True))
        return 0
    if not result["skills"]:
        print("No library skills installed globally.")
        return 0
    for row in result["skills"]:
        print(f"[{row['name']}] <GLOBAL> - {row['description']}")
    return 0


def _cmd_serve_ui(args: argparse.Namespace) -> int:
    run_ui_server(host=args.host, port=args.port, project=args.project)
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage a local skill library and per-project copied skill installs."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    set_root_parser = subparsers.add_parser(
        "set-root", help="Set the global skill library root path."
    )
    set_root_parser.add_argument(
        "--path", required=True, help="Absolute path to your local skill library."
    )
    set_root_parser.set_defaults(func=_cmd_set_root)

    show_root_parser = subparsers.add_parser(
        "show-root", help="Show configured global skill library root."
    )
    show_root_parser.set_defaults(func=_cmd_show_root)

    enumerate_parser = subparsers.add_parser(
        "enumerate", help="List discovered skills and mark those installed in current project."
    )
    enumerate_parser.add_argument(
        "--project",
        help="Project path used for install-state checks. Default: nearest git root from cwd.",
    )
    enumerate_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    enumerate_parser.set_defaults(func=_cmd_enumerate)

    enable_parser = subparsers.add_parser("enable", help="Enable one library skill for a project.")
    enable_parser.add_argument("--skill", required=True, help="Skill name (folder basename).")
    enable_parser.add_argument(
        "--project",
        help="Project path. Default: nearest git root from cwd.",
    )
    enable_parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing conflicting project entry.",
    )
    enable_parser.set_defaults(func=_cmd_enable)

    disable_parser = subparsers.add_parser("disable", help="Remove one copied project skill.")
    disable_parser.add_argument("--skill", required=True, help="Skill name (folder basename).")
    disable_parser.add_argument(
        "--project",
        help="Project path. Default: nearest git root from cwd.",
    )
    disable_parser.set_defaults(func=_cmd_disable)

    list_enabled_parser = subparsers.add_parser(
        "list-enabled", help="List skills from the library that are enabled in a project."
    )
    list_enabled_parser.add_argument(
        "--project",
        help="Project path. Default: nearest git root from cwd.",
    )
    list_enabled_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    list_enabled_parser.set_defaults(func=_cmd_list_enabled)

    install_global_parser = subparsers.add_parser(
        "install-global", help="Install one library skill into the global Codex skills directory."
    )
    install_global_parser.add_argument(
        "--skill", required=True, help="Skill name (folder basename)."
    )
    install_global_parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing conflicting global entry.",
    )
    install_global_parser.set_defaults(func=_cmd_install_global)

    uninstall_global_parser = subparsers.add_parser(
        "uninstall-global", help="Remove one copied global skill."
    )
    uninstall_global_parser.add_argument(
        "--skill", required=True, help="Skill name (folder basename)."
    )
    uninstall_global_parser.set_defaults(func=_cmd_uninstall_global)

    list_global_parser = subparsers.add_parser(
        "list-global", help="List skills from the library that are installed globally."
    )
    list_global_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    list_global_parser.set_defaults(func=_cmd_list_global)

    serve_ui_parser = subparsers.add_parser(
        "serve-ui", help="Start a local web UI for managing skills."
    )
    serve_ui_parser.add_argument(
        "--host", default="127.0.0.1", help="Host to bind the local UI server."
    )
    serve_ui_parser.add_argument(
        "--port", default=8765, type=int, help="Port to bind the local UI server."
    )
    serve_ui_parser.add_argument(
        "--project",
        help="Initial project path shown in the UI. Default: current directory resolution.",
    )
    serve_ui_parser.set_defaults(func=_cmd_serve_ui)

    return parser


def main(argv: list[str]) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except SkillLibraryError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
