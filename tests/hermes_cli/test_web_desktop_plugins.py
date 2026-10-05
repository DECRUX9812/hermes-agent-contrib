"""Live check of the desktop-plugin routes: real FastAPI app, real filesystem.

Proves the security posture the renderer capability depends on — traversal,
nesting, dotfiles and non-allowlisted filenames are refused, and a real plugin
folder's plugin.js is served untruncated — by calling the routes, not by
reading them.

Run:  python3 -m pytest tests/hermes_cli/test_web_desktop_plugins.py -q
"""

import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from hermes_cli.web_routers import desktop_plugins as routes  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A real app mounting the router, with the plugin root in a temp home."""
    home = tmp_path / "home"
    plugins = home / "desktop-plugins"
    (plugins / "backdrops").mkdir(parents=True)
    (plugins / "backdrops" / "plugin.js").write_text(
        "export default { id: 'backdrops', register(ctx) { ctx.register({ id: 'picker', area: 'statusBar.right' }) } }",
        encoding="utf-8",
    )
    (plugins / "backdrops" / "secrets.env").write_text("TOKEN=do-not-serve", encoding="utf-8")
    (plugins / "backdrops" / "assets").mkdir()
    (plugins / "backdrops" / "assets" / "logo.js").write_text("export default {}", encoding="utf-8")
    (plugins / "unified").mkdir()
    (plugins / "unified" / "plugin.js").write_text("export default { id: 'unified', register() {} }", encoding="utf-8")
    (plugins / "unified" / ".hermes-package.json").write_text(
        json.dumps({"package": "unified", "source": "/x/plugins/unified/desktop"}), encoding="utf-8"
    )
    (plugins / "not-a-plugin").mkdir()
    (plugins / "not-a-plugin" / "README.md").write_text("no entry point", encoding="utf-8")
    # A credential file that must never be reachable through this router.
    (home / "auth.json").write_text('{"token":"nope"}', encoding="utf-8")

    monkeypatch.setattr(routes, "get_hermes_home", lambda: str(home))

    app = FastAPI()
    app.include_router(routes.router)

    return TestClient(app)


def test_root_is_app_level_and_under_the_home(client):
    body = client.get("/api/desktop-plugins/root").json()

    assert body["root"].endswith("/home/desktop-plugins")
    assert "/home/desktop-plugins" in body["root"]


def test_root_lists_only_directories(client):
    entries = client.get("/api/desktop-plugins/list").json()["entries"]
    names = sorted(entry["name"] for entry in entries)

    assert names == ["backdrops", "not-a-plugin", "unified"]
    assert all(entry["isDirectory"] for entry in entries)


def test_source_serves_plugin_js_untruncated(client):
    body = client.get("/api/desktop-plugins/source", params={"name": "backdrops"}).json()

    assert body["name"] == "plugin.js"
    assert body["text"].startswith("export default { id: 'backdrops'")
    assert body["byteSize"] == len(body["text"].encode("utf-8"))


def test_source_serves_the_package_marker(client):
    body = client.get(
        "/api/desktop-plugins/source", params={"name": "unified", "file": ".hermes-package.json"}
    ).json()

    assert json.loads(body["text"])["package"] == "unified"


def test_folder_listing_is_one_level_and_names_files(client):
    entries = client.get("/api/desktop-plugins/list", params={"name": "backdrops"}).json()["entries"]
    names = sorted(entry["name"] for entry in entries)

    assert "plugin.js" in names
    assert ".hermes-package.json" not in names  # not this folder's file


@pytest.mark.parametrize(
    "name",
    [
        "../config",
        "..",
        ".",
        "backdrops/../..",
        "/etc",
        "backdrops/nested",
        ".hidden",
        "",
    ],
)
def test_rejects_anything_but_one_plain_folder_segment(client, name):
    assert client.get("/api/desktop-plugins/source", params={"name": name}).status_code in (400, 403, 404)


@pytest.mark.parametrize("file", ["secrets.env", "auth.json", "assets/logo.js", "plugin.js.bak", "../auth.json"])
def test_rejects_any_file_outside_the_allowlist(client, file):
    response = client.get("/api/desktop-plugins/source", params={"name": "backdrops", "file": file})

    assert response.status_code in (403, 400, 404)
    assert "do-not-serve" not in response.text


def test_symlinked_entry_point_out_of_the_root_is_refused(client, tmp_path):
    outside = tmp_path / "outside.js"
    outside.write_text("export default {}", encoding="utf-8")

    plugins = tmp_path / "home" / "desktop-plugins"
    (plugins / "linked").mkdir()
    (plugins / "linked" / "plugin.js").symlink_to(outside)

    response = client.get("/api/desktop-plugins/source", params={"name": "linked"})

    assert response.status_code == 403
    assert "export default" not in response.text


def test_missing_root_degrades_to_an_empty_listing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(routes, "get_hermes_home", lambda: str(tmp_path / "no-such-home"))

    assert client.get("/api/desktop-plugins/list").json() == {"entries": []}
    assert client.get("/api/desktop-plugins/root").json()["root"].endswith("/no-such-home/desktop-plugins")


def test_oversize_source_is_refused_not_truncated(client, monkeypatch):
    monkeypatch.setattr(routes, "PLUGIN_SOURCE_MAX_BYTES", 10)

    assert client.get("/api/desktop-plugins/source", params={"name": "backdrops"}).status_code == 413
