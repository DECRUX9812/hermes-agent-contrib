"""Install a desktop-only plugin from Git onto the host that serves the Webapp.

Native Desktop clones one in Electron (``apps/desktop/electron/desktop-plugin-install.ts``,
``installDesktopPluginFromGit``). A browser-hosted tab has no disk of its own, so until now the install
dialog could only *read* a repository through the gateway (``plugins_cmd_inspect``) and then had
nothing to install with: a desktop-only repository answered "nothing to install here". This is that
missing step — the same inspection, held to the commit it read, the same folder-name rules as
Electron, published atomically into the app-level root that ``/api/desktop-plugins`` serves.

Scope: **desktop-only repositories**. A repository that also ships an agent half is a package, and a
package's desktop half already reaches this folder — the host copies it out of the installed package
on every root read (``desktop_plugin_halves.reconcile_desktop_halves``). Cloning it here as well would
race that copy, so this installer refuses a package by name and says which install puts it down.

The install is a clone, a staged copy and a rename: no code is imported or run here. The plugin loads
the way any other installed plugin does, on the next scan of ``desktop-plugins/``.
"""

from __future__ import annotations

import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

from hermes_cli import desktop_plugin_halves as halves
from hermes_constants import get_default_hermes_root

DESKTOP_PLUGINS_DIR = "desktop-plugins"

#: Windows refuses these as folder names whatever the extension, and treats ``D:work`` as a path.
_RESERVED_NAMES = frozenset({"con", "prn", "aux", "nul"} |
                            {f"com{i}" for i in range(1, 10)} | {f"lpt{i}" for i in range(1, 10)})


def desktop_plugins_root() -> Path:
    """The app-level root ``desktop-plugins/``, created on demand and resolved, exactly as Electron's
    ``desktopPluginsRoot`` and the Webapp's read routes resolve it: one folder whichever profile the
    caller names."""
    root = get_default_hermes_root() / DESKTOP_PLUGINS_DIR
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _pc():
    """The facade, read at call time: tests patch ``plugins_cmd.<name>`` and sibling calls must see it."""
    from hermes_cli import plugins_cmd
    return plugins_cmd


def _failure(error: str) -> dict[str, Any]:
    return {"ok": False, "error": error}


def _checked_name(name: Optional[str]) -> str:
    """*name* when it can be exactly one direct child of the root, else raise.

    The name comes from a repository (a subdirectory's last segment, a manifest's ``name``), so it is
    never trusted: no separators, no traversal, no control characters, no leading dot (the root's
    staging folders use that prefix), no ``:`` — on Windows ``root / 'D:work'`` is a path on drive D,
    not a child of the root — and nothing Windows reserves for a device.
    """
    candidate = (name or "").strip()
    reserved = candidate.split(".")[0].strip().lower() in _RESERVED_NAMES
    if (not candidate or candidate in (".", "..") or candidate.startswith(".")
            or "/" in candidate or "\\" in candidate or ":" in candidate or "\0" in candidate
            or any(ord(char) < 32 for char in candidate) or len(candidate) > 128 or reserved):
        raise _pc().PluginOperationError(
            f"Cannot install a desktop plugin under the folder name '{name}': it must be a plain "
            "folder name, not a path or a device name."
        )
    return candidate


def _child(root: Path, folder: str) -> Path:
    """``root/folder``, refusing anything that does not resolve to a direct child of *root*."""
    target = root / folder
    if target.parent != root:
        raise _pc().PluginOperationError(
            f"Cannot use the folder name '{folder}': it does not resolve under {root}."
        )
    return target


def _source(identifier: str, catalog_name: Optional[str]) -> tuple[str, Optional[str], str, Optional[str]]:
    """``(git_url, subdir, resolved_identifier, revision)`` — the installer's own resolution, with the
    catalog's reviewed pin when *catalog_name* is given (its repository replaces *identifier*)."""
    pc = _pc()
    resolved = identifier
    revision = None
    if catalog_name:
        from hermes_cli import plugins_cmd_catalog as catalog
        entry = catalog.get_live_catalog_entry(catalog_name)
        if entry is None:
            raise pc.PluginOperationError(f"'{catalog_name}' is not in the Hermes plugin catalog.")
        resolved = entry.install_identifier
        revision = entry.sha or None
    git_url, subdir = pc._resolve_git_url(resolved)
    from hermes_cli.plugins_cmd_catalog import raise_if_removed
    raise_if_removed(resolved, git_url, *((catalog_name,) if catalog_name else ()))
    return git_url, subdir, resolved, revision


def _rmtree(path: Path) -> None:
    """``shutil.rmtree`` that survives Windows' read-only bits.

    A git clone writes ``.git/objects`` read-only, and ``rmtree`` raises ``PermissionError`` on those
    on Windows — so a cloned plugin would install and then refuse to be removed. Retry each failing
    entry once with the write bit set.
    """
    def _retry(func, target, _exc):  # onerror/onexc share this shape
        try:
            os.chmod(target, stat.S_IWRITE | stat.S_IREAD)
            func(target)
        except OSError:
            pass

    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_retry)
    else:
        shutil.rmtree(path, onerror=_retry)  # deprecated, but the only spelling before 3.12


def _regular_entry(folder: Path) -> bool:
    """Whether ``plugin.js`` in *folder* is a regular file.

    A link would install and then never load: ``/api/desktop-plugins/read`` refuses a linked entry by
    design, so the browser loader would see nothing. Electron publishes a copy; here an entry that is
    a link is refused before anything is written.
    """
    try:
        return stat.S_ISREG(os.lstat(folder / "plugin.js").st_mode)
    except OSError:
        return False


def install_desktop_plugin(identifier: str, *, catalog_name: Optional[str] = None,
                           force: bool = False, ref: Optional[str] = None) -> dict[str, Any]:
    """Clone a desktop-only repository into ``desktop-plugins/<name>`` on this host.

    Returns ``{ok, plugin_name, path, sha, warnings}``, or ``ok: False`` with ``error``.

    *ref* is the commit the dialog showed, so the install lands exactly the tree that was reviewed;
    without it the inspection's own answer is used (the catalog pin, or the commit that check read —
    which a cached answer can name from up to ten minutes earlier).
    """
    from hermes_cli.plugins_cmd_inspect import forget_inspection, inspect_plugin_source

    if force:
        # A forced reinstall means "the repository moved": answer from a fresh clone, not the check
        # that named the tree now being replaced.
        forget_inspection(identifier, catalog_name=catalog_name)
    probe = inspect_plugin_source(identifier, catalog_name=catalog_name)
    if not probe.get("ok"):
        return _failure(probe.get("error") or "Could not read this plugin repository.")
    if not probe.get("desktop"):
        return _failure("This package ships no desktop plugin to install here.")
    if probe.get("agent"):
        return _failure(
            "This repository also ships an agent half: install it as a package and the host copies "
            "its desktop half across. install_desktop is for desktop-only plugins."
        )

    expected = (ref or "").strip().lower() or None
    try:
        folder = _checked_name(probe.get("desktop_name"))
        git_url, subdir, _resolved, revision = _source(identifier, catalog_name)
        root = desktop_plugins_root()
        target = _child(root, folder)
    except _pc().PluginOperationError as exc:
        return _failure(str(exc))

    try:
        with tempfile.TemporaryDirectory(prefix="hermes-plugin-install-") as tmp:
            clone = Path(tmp) / "plugin"
            sha = _pc()._clone_plugin_repo(
                clone, git_url, expected or probe.get("sha") or revision, subdir)
            if expected and sha and sha.lower() != expected:
                return _failure(
                    f"The repository no longer answers commit {expected[:12]}; inspect it again "
                    "before installing."
                )
            plugin_root = _pc()._resolve_subdir_within(clone, subdir) if subdir else clone
            source_dir = _desktop_tree(plugin_root)

            if source_dir is None:
                return _failure("No desktop plugin.js found in this repository.")
            if not _regular_entry(source_dir):
                return _failure(
                    "This plugin's plugin.js is a link, not a file. The Webapp serves only a regular "
                    "entry file, so it would install and never load."
                )

            # Under the root's writer lock: the exists check and the publish must not interleave with
            # a reconcile pass copying a folder under the same name. No marker is passed, and
            # `_publish` strips any the repository shipped: a standalone plugin carries none.
            with halves.ROOT_WRITER:
                if target.is_symlink() or target.exists():
                    if not force:
                        return _failure(
                            f"Desktop plugin '{folder}' already exists. Enable force reinstall to replace it."
                        )
                halves.publish_desktop_tree(source_dir, target, None)
    except _pc().PluginOperationError as exc:
        return _failure(str(exc))
    except OSError as exc:
        return _failure(f"Could not install the desktop plugin: {exc}")

    return {"ok": True, "plugin_name": folder, "path": str(target), "sha": sha,
            "warnings": list(probe.get("warnings") or [])}


def _desktop_tree(plugin_root: Path) -> Optional[Path]:
    """The folder that is the desktop plugin: the repository root when ``plugin.js`` sits there, else
    its ``desktop/`` subfolder — Electron's ``findDesktopEntry`` search, narrowed to those two. A
    symlinked entry is returned too, so the caller can refuse it with a reason worth reading."""
    for candidate in (plugin_root, plugin_root / "desktop"):
        if (candidate / "plugin.js").is_file() or (candidate / "plugin.js").is_symlink():
            return candidate
    return None


def remove_desktop_plugin(name: str, *, force: bool = False) -> dict[str, Any]:
    """Delete one installed desktop plugin folder from this host.

    A folder carrying the package marker is the desktop half of an installed agent plugin: removing it
    alone would leave the Plugins page pairing a row with nothing behind it, and the next reconcile
    would copy it straight back, so it is refused unless *force* says the caller means it.
    """
    try:
        folder = _checked_name(name)
        target = _child(desktop_plugins_root(), folder)
    except _pc().PluginOperationError as exc:
        return _failure(str(exc))
    if target.is_symlink():
        return _failure(
            f"'{folder}' is linked from somewhere else on this host; remove that link where it lives."
        )
    if not target.is_dir():
        return _failure(f"No desktop plugin named '{folder}' is installed.")

    with halves.ROOT_WRITER:
        marker = halves.read_package_marker(target)
        if marker and not force:
            return _failure(
                f"'{folder}' is the desktop half of an agent plugin — uninstall that plugin instead."
            )
        try:
            _rmtree(target)
        except OSError as exc:
            return _failure(f"Could not remove the desktop plugin: {exc}")

    return {"ok": True, "plugin_name": folder, "path": str(target), "unpaired_from": (marker or {}).get("package")}
