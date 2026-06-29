#!/usr/bin/env python3
"""Local web UI for the skill library manager."""

from __future__ import annotations

from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any
from urllib.parse import parse_qs, urlparse
import webbrowser

from skill_library_core import (
    SkillLibraryError,
    delete_library_skill,
    disable_skill,
    enable_skill,
    install_global_skill,
    read_skill_markdown,
    set_root,
    status_snapshot,
    uninstall_global_skill,
)

UI_PATH = Path(__file__).resolve().parents[1] / "ui" / "index.html"


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")


def _bootstrap_html(initial_project: str | None) -> bytes:
    raw = UI_PATH.read_text(encoding="utf-8")
    bootstrap = {"initialProject": initial_project or ""}
    marker = "__SKILL_MANAGER_BOOTSTRAP__"
    html = raw.replace(marker, json.dumps(bootstrap))
    return html.encode("utf-8")


def _pick_directory_standard(initial_path: str | None = None) -> str | None:
    if sys.platform.startswith("win"):
        return _pick_directory_standard_windows(initial_path)
    raise SkillLibraryError("Standard folder dialog is only implemented for Windows.")


def _pick_directory_standard_windows(initial_path: str | None) -> str | None:
    script = r"""
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$root = $env:SKILL_MANAGER_INITIAL_PATH
if (-not $root) {
    $root = 0
}
$folder = $shell.BrowseForFolder(0, 'Select a folder', 0, $root)
if ($folder -and $folder.Self -and $folder.Self.Path) {
    [Console]::Out.Write($folder.Self.Path)
}
"""
    env = os.environ.copy()
    if initial_path:
        env["SKILL_MANAGER_INITIAL_PATH"] = initial_path
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            check=False,
            timeout=120,
        )
    except subprocess.TimeoutExpired as exc:
        raise SkillLibraryError(
            "Standard folder dialog timed out. If no dialog appeared, it may have opened behind another window."
        ) from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "folder picker failed"
        raise SkillLibraryError(f"Failed to open standard folder dialog: {detail}")
    chosen = completed.stdout.strip()
    return chosen or None


def _list_windows_drives() -> list[dict[str, str]]:
    bitmask = ctypes.windll.kernel32.GetLogicalDrives()
    drives: list[dict[str, str]] = []
    for index in range(26):
        if bitmask & (1 << index):
            letter = chr(ord("A") + index)
            path = f"{letter}:\\"
            drives.append({"name": path, "path": path})
    return drives


def _directory_listing(path: str | None) -> dict[str, Any]:
    if sys.platform.startswith("win") and not path:
        return {
            "current_path": "",
            "parent_path": None,
            "entries": _list_windows_drives(),
        }
    current_path = os.path.abspath(os.path.expanduser(path or os.getcwd()))
    if not os.path.isdir(current_path):
        raise SkillLibraryError(f"Folder does not exist: {current_path}")
    entries: list[dict[str, str]] = []
    try:
        with os.scandir(current_path) as iterator:
            for entry in iterator:
                if not entry.is_dir():
                    continue
                entries.append({"name": entry.name, "path": entry.path})
    except OSError as exc:
        raise SkillLibraryError(f"Failed to list {current_path}: {exc}") from exc
    entries.sort(key=lambda item: item["name"].lower())
    parent_path = os.path.dirname(current_path.rstrip("\\/"))
    if not parent_path or parent_path == current_path:
        if sys.platform.startswith("win"):
            parent_path = ""
        else:
            parent_path = current_path if current_path == "/" else os.path.dirname(current_path)
    return {
        "current_path": current_path,
        "parent_path": parent_path if parent_path != current_path else None,
        "entries": entries,
    }


class SkillManagerHandler(BaseHTTPRequestHandler):
    server_version = "SkillLibraryUI/1.0"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            self._respond_bytes(
                HTTPStatus.OK,
                _bootstrap_html(getattr(self.server, "initial_project", None)),
                "text/html; charset=utf-8",
            )
            return
        if parsed.path == "/api/state":
            query = parse_qs(parsed.query)
            project = query.get("project", [""])[0] or None
            snapshot = status_snapshot(project)
            self._respond_json(HTTPStatus.OK, {"ok": True, "state": snapshot})
            return
        if parsed.path == "/api/skill-content":
            query = parse_qs(parsed.query)
            skill = query.get("skill", [""])[0].strip()
            if not skill:
                self._respond_json(
                    HTTPStatus.BAD_REQUEST,
                    {"ok": False, "error": "Missing required query parameter `skill`."},
                )
                return
            result = read_skill_markdown(skill)
            self._respond_json(HTTPStatus.OK, {"ok": True, **result})
            return
        if parsed.path == "/api/pick-folder-standard":
            query = parse_qs(parsed.query)
            initial_path = query.get("path", [""])[0] or None
            chosen = _pick_directory_standard(initial_path)
            self._respond_json(
                HTTPStatus.OK,
                {"ok": True, "selected_path": chosen, "cancelled": chosen is None},
            )
            return
        if parsed.path == "/api/list-directories":
            query = parse_qs(parsed.query)
            path = query.get("path", [""])[0] or None
            listing = _directory_listing(path)
            self._respond_json(HTTPStatus.OK, {"ok": True, **listing})
            return
        self._respond_json(
            HTTPStatus.NOT_FOUND, {"ok": False, "error": f"Unknown path: {parsed.path}"}
        )

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            payload = self._read_json_body()
            if parsed.path == "/api/set-root":
                path = self._require_string(payload, "path")
                result = set_root(path)
                state = status_snapshot(payload.get("project") or None)
                self._respond_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "message": f"Library root set to {result['root_path']}",
                        "state": state,
                    },
                )
                return
            if parsed.path == "/api/enable":
                skill = self._require_string(payload, "skill")
                force = bool(payload.get("force"))
                result = enable_skill(skill, project=payload.get("project") or None, force=force)
                state = status_snapshot(payload.get("project") or None)
                message = (
                    f"Project copy differs from the library for {result['skill']}"
                    if result["status"] == "blocked-modified"
                    else f"Updated {result['skill']} in {result['project_root']}"
                )
                self._respond_json(
                    HTTPStatus.OK, {"ok": True, "message": message, "state": state}
                )
                return
            if parsed.path == "/api/disable":
                skill = self._require_string(payload, "skill")
                result = disable_skill(skill, project=payload.get("project") or None)
                state = status_snapshot(payload.get("project") or None)
                message = (
                    f"Skill not enabled: {result['skill']}"
                    if result["status"] == "not-enabled"
                    else f"Disabled {result['skill']} in {result['project_root']}"
                )
                self._respond_json(
                    HTTPStatus.OK, {"ok": True, "message": message, "state": state}
                )
                return
            if parsed.path == "/api/delete-library-skill":
                skill = self._require_string(payload, "skill")
                result = delete_library_skill(skill, project=payload.get("project") or None)
                state = status_snapshot(payload.get("project") or None)
                message = f"Deleted {result['skill']} from {result['library_root']}"
                self._respond_json(
                    HTTPStatus.OK, {"ok": True, "message": message, "state": state}
                )
                return
            if parsed.path == "/api/install-global":
                skill = self._require_string(payload, "skill")
                force = bool(payload.get("force"))
                result = install_global_skill(skill, force=force)
                state = status_snapshot(payload.get("project") or None)
                message = (
                    f"Global copy differs from the library for {result['skill']}"
                    if result["status"] == "blocked-modified"
                    else f"Updated {result['skill']} globally in {result['global_root']}"
                )
                self._respond_json(
                    HTTPStatus.OK, {"ok": True, "message": message, "state": state}
                )
                return
            if parsed.path == "/api/uninstall-global":
                skill = self._require_string(payload, "skill")
                result = uninstall_global_skill(skill)
                state = status_snapshot(payload.get("project") or None)
                message = (
                    f"Skill not installed globally: {result['skill']}"
                    if result["status"] == "not-installed"
                    else f"Uninstalled {result['skill']} from {result['global_root']}"
                )
                self._respond_json(
                    HTTPStatus.OK, {"ok": True, "message": message, "state": state}
                )
                return
        except SkillLibraryError as exc:
            self._respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
            return
        except ValueError as exc:
            self._respond_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
            return
        self._respond_json(
            HTTPStatus.NOT_FOUND, {"ok": False, "error": f"Unknown path: {parsed.path}"}
        )

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _read_json_body(self) -> dict[str, Any]:
        header = self.headers.get("Content-Length")
        length = int(header) if header else 0
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON payload: {exc}") from exc
        if not isinstance(payload, dict):
            raise ValueError("JSON payload must be an object.")
        return payload

    def _require_string(self, payload: dict[str, Any], key: str) -> str:
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Missing required field `{key}`.")
        return value.strip()

    def _respond_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        self._respond_bytes(status, _json_bytes(payload), "application/json; charset=utf-8")

    def _respond_bytes(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_ui_server(host: str, port: int, project: str | None = None) -> None:
    server = ThreadingHTTPServer((host, port), SkillManagerHandler)
    server.initial_project = project  # type: ignore[attr-defined]
    url = f"http://{host}:{port}/"
    print(f"Skill manager UI running at {url}")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping UI server.")
    finally:
        server.server_close()
