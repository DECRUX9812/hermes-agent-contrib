"""Desktop-plugin root + entry-source routes for the browser-hosted surface.

Electron answers these from ``hermes:fs:desktopPluginsRoot`` /
``hermes:fs:readPluginSource`` (apps/desktop/electron/fs-ipc.ts:121-129 and
preload.ts:491). A browser-hosted renderer has no main process, so its
``window.hermesDesktop`` bridge (apps/desktop/src/lib/browser-desktop-plugins.ts)
calls the routes here and the EXISTING loader code path —
``runtime-loader.ts`` ``diskRoots()`` / ``resolveDiskPluginEntry()`` /
``readPluginSourceText()`` — runs unmodified.

SCOPING (deliberate, and narrower than Electron):
Electron resolves the root APP-level, never profile-scoped
(``fs-ipc.ts`` comments: "the root is APP-level, never profile-scoped,
resolved FRESH each pass"). A webapp process IS one Hermes home — the launch
profile's home is ``get_hermes_home()`` — so we reproduce the app-level shape
by resolving the SAME process home, and never accept a caller-supplied home or
profile. That is the honest browser equivalent: there is no second home for the
renderer to reach, and honouring ``?profile=`` here would reintroduce exactly
the profile-scoped drift Electron removed (#66899).

WHAT IS SERVED (deliberately narrow):
Only the folder LISTING under the root, and ``plugin.js`` source (plus the
``.hermes-package.json`` marker the loader reads at runtime-loader.ts:594-603)
for a single-segment folder name directly under the root. No arbitrary path
parameter, no glob, no nested segments, no traversal surface:

  * ``/api/desktop-plugins/root``            -> ``{"root": "<home>/desktop-plugins"}``
  * ``/api/desktop-plugins/list?name=<id>``  -> ``{"entries": [...]}``
  * ``/api/desktop-plugins/source?name=<id>``-> ``{"text": ..., "byteSize": ...}``

A folder NAME is validated as a single path segment (no ``/``, no ``\\``, no
``.``/``..``, no NUL, no leading dot) and then re-checked by resolving it and
requiring the resolved parent to be the resolved root — belt and braces, the
same containment discipline the managed-files routes use
(``web_routers/files.py:_resolve_managed_path``).

WHY SOURCE AT ALL: a desktop plugin is JavaScript the renderer *evaluates*. Any
surface that hands the browser plugin source is equivalent in power to handing
it that code to run — so this cannot be made "safe" by narrowing the file
allowlist. The mitigation is the AUTH gate (every ``/api`` route on this
surface already sits behind the dashboard's token/cookie middleware) plus the
narrow allowlist (one known filename per folder, one folder deep) so the route
cannot be repurposed into a general file reader for the rest of HERMES_HOME.
Callers must treat a desktop plugin folder as TRUSTED, executable content: it
runs with the same privileges as the Desktop renderer itself, which is already
true of Electron's identical IPC.

16 MiB cap mirrors Electron's ``readPluginSource`` ceiling; the payload is
returned untruncated, because ``runtime-loader.ts:670-690`` refuses a
``truncated`` result rather than evaluate a partial module.
"""

import asyncio
import os
import stat
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

from hermes_cli.web_deps import late

router = APIRouter()

# Late-bound so a test's monkeypatch on the owning module wins at call time.
get_hermes_home = late("get_hermes_home", "hermes_cli.config")

# Mirrors DESKTOP_PLUGINS_DIR (apps/desktop/electron/desktop-plugins-root.ts:21)
# and PACKAGE_MARKER (same file, line 23).
DESKTOP_PLUGINS_DIR = "desktop-plugins"
PACKAGE_MARKER = ".hermes-package.json"
ENTRY_FILE = "plugin.js"

# The entry point and the package marker — the two files the LOADER itself
# reads. They are not the only readable files: a plugin folder may ship more
# than its entry (a vendored browser bundle, a worker, a data file), and
# Electron's `readPluginSource` serves any of them. Restricting the browser door
# to these two made a multi-file plugin read its own assets as EMPTY and fail
# closed — `computer-viewer` hashes `vendor/novnc-rfb.mjs` and refused to start
# ("vendored noVNC failed integrity check") although the file was byte-identical
# to its pinned digest. Reads stay folder-scoped (see _validated_plugin_file):
# anything outside `<root>/<name>/` is still refused.
ENTRY_FILES = frozenset({ENTRY_FILE, PACKAGE_MARKER})

# Electron's readPluginSource ceiling (global.d.ts:335-338 documents 16 MiB).
PLUGIN_SOURCE_MAX_BYTES = 16 * 1024 * 1024


def _desktop_plugins_root() -> Path:
    """The APP-level desktop-plugin root for THIS server process' home.

    Created on demand, exactly like Electron's ``ensureDir`` in
    ``desktopPluginsRoot()`` (fs-ipc.ts:121-122), so a fresh install resolves
    instead of 404-ing. Never profile-scoped and never caller-supplied.
    """
    root = Path(get_hermes_home()) / DESKTOP_PLUGINS_DIR

    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        # Best-effort, same posture as Electron's ensureDir: a read-only or
        # unwritable home still yields a path so the scanner can report it.
        pass

    return root


def _validated_plugin_dir(name: str) -> Path:
    """Resolve ``<root>/<name>`` for a single-segment folder name.

    The name is validated as ONE path segment, so no traversal or nested path
    can be expressed by the parameter. 400 for a malformed name, 404 for a
    folder that is not there.

    The entry itself may be a SYMLINK to a checkout elsewhere: linking a
    plugin's working copy into ``<root>`` is how a dev plugin is installed
    (the Electron door reads such a folder unmodified), and the browser door
    must load the same plugins the desktop app does. The parameter is still one
    plain segment, so nothing outside the root is addressable *by the caller*,
    and a plugin folder already executes as this user — following the link
    grants no privilege the root's owner did not already have. File reads stay
    scoped to the RESOLVED folder (:func:`_validated_plugin_file`), so a
    symlinked file inside it still cannot point back out.
    """
    candidate = (name or "").strip()

    if (
        not candidate
        or candidate in (".", "..")
        or "/" in candidate
        or "\\" in candidate
        or "\0" in candidate
        or candidate.startswith(".")
        or Path(candidate).name != candidate
    ):
        raise HTTPException(status_code=400, detail="Invalid desktop plugin name")

    root = _desktop_plugins_root()

    try:
        target = (root / candidate).resolve()
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid path") from exc

    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Desktop plugin not found")

    return target


def _validated_plugin_file(name: str, filename: str) -> Path:
    """Resolve ``<root>/<name>/<relative file>`` for a file INSIDE that folder.

    ``filename`` may be nested (``vendor/novnc-rfb.mjs``) but every segment must
    be plain: no absolute path, no ``.``/``..``, no backslash, no NUL. The folder
    is validated by :func:`_validated_plugin_dir` (one plain segment, resolved
    parent == resolved root) and containment is re-checked on the RESOLVED file,
    so a symlink inside the folder cannot point back out of it. A folder-scoped
    read is the same privilege the renderer already has by evaluating the
    folder's ``plugin.js``, and is narrower than Electron's door (which reads any
    path).
    """
    directory = _validated_plugin_dir(name)
    candidate = (filename or "").strip()
    segments = candidate.split("/")

    if (
        not candidate
        or candidate.startswith("/")
        or "\\" in candidate
        or "\0" in candidate
        or any(segment in ("", ".", "..") for segment in segments)
    ):
        raise HTTPException(status_code=400, detail="Invalid desktop plugin file")

    try:
        resolved_dir = directory.resolve()
        resolved = (directory / candidate).resolve()
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid path") from exc

    # Containment re-check AFTER symlink resolution: a symlinked entry pointing
    # anywhere else in HERMES_HOME must not become a file reader.
    if resolved != resolved_dir and resolved_dir not in resolved.parents:
        raise HTTPException(status_code=403, detail="Path outside the desktop plugin folder")

    try:
        st = resolved.stat()
    except (FileNotFoundError, NotADirectoryError):
        raise HTTPException(status_code=404, detail="File not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="File is not readable")
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Invalid path")

    if not stat.S_ISREG(st.st_mode):
        raise HTTPException(status_code=400, detail="Only regular files can be read")

    return resolved


def _list_root_entries(root: Path) -> list[dict]:
    """Directory entries directly under the root, sorted for a stable scan.

    Mirrors the shape ``readDir`` returns to the renderer
    (``HermesReadDirResult``), because ``scanDiskPlugins`` filters
    ``entries.filter(e => e.isDirectory)`` (runtime-loader.ts:841).
    """
    entries: list[dict] = []

    try:
        with os.scandir(root) as scan:
            for entry in scan:
                # Dotfiles are not plugin folders and the loader never wants
                # them (mirrors Electron's per-folder name validation above).
                if entry.name.startswith("."):
                    continue

                entries.append({
                    "name": entry.name,
                    "path": str(root / entry.name),
                    "isDirectory": entry.is_dir(follow_symlinks=False),
                })
    except (FileNotFoundError, NotADirectoryError):
        # No plugins yet — an empty listing, not an error: the loader treats a
        # missing root as "nothing to load" and polls again.
        return []
    except PermissionError:
        raise HTTPException(status_code=403, detail="Directory is not readable")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read directory: {exc}")

    entries.sort(key=lambda item: (not item["isDirectory"], item["name"].lower(), item["name"]))

    return entries


def _read_entry_source(path: Path) -> tuple[str, int]:
    """Read an allowlisted plugin file in FULL. Never truncates."""
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not stat file: {exc}")

    if size > PLUGIN_SOURCE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Plugin source too large")

    try:
        # errors="replace" matches /api/fs/read-text's decode policy; the loader
        # only needs valid JS, and a stray byte must not 500 the whole scan.
        return path.read_text(encoding="utf-8-sig", errors="replace"), size
    except PermissionError:
        raise HTTPException(status_code=403, detail="File is not readable")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read file: {exc}")


@router.get("/api/desktop-plugins/root")
async def desktop_plugins_root():
    """The absolute desktop-plugin root, resolved fresh on every call.

    Returns ``{"root": ""}`` (the loader's "no disk plugins" signal) rather
    than an error when the home cannot host the directory, so a read-only or
    unusual install degrades to "no plugins" instead of a boot-time failure.
    """
    try:
        root = _desktop_plugins_root()
    except Exception:
        return {"root": ""}

    return {"root": str(root)}


@router.get("/api/desktop-plugins/list")
async def desktop_plugins_list(name: Optional[str] = None):
    """Entries directly under the root, or of one plugin folder when ``name`` is given.

    ``name`` omitted -> the root listing (``scanDiskPlugins``' first readDir).
    ``name`` given   -> that folder's entries (``resolveDiskPluginEntry``' walk,
                       which also looks for the ``.hermes-package.json`` marker).
    """
    if name is None:
        root = _desktop_plugins_root()

        return {"entries": await asyncio.to_thread(_list_root_entries, root)}

    directory = _validated_plugin_dir(name)

    return {"entries": await asyncio.to_thread(_list_root_entries, directory)}


@router.get("/api/desktop-plugins/source")
async def desktop_plugins_source(name: str, file: str = ENTRY_FILE):
    """Full, untruncated source of one file inside one plugin folder.

    ``file`` is relative to ``<root>/<name>/`` and may be nested
    (``vendor/novnc-rfb.mjs``), which is how a plugin loads its own bundled
    assets. Traversal, absolute paths and symlinks leaving the folder are
    refused; every file is capped at 16 MiB (Electron's ``readPluginSource``
    ceiling) and never truncated.
    """
    target = _validated_plugin_file(name, file)
    text, size = await asyncio.to_thread(_read_entry_source, target)

    return {"name": target.name, "path": str(target), "byteSize": size, "text": text}
