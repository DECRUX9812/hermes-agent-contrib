#!/usr/bin/env python3
"""Standalone driver for tests/hermes_cli/test_web_desktop_plugins.py.

No pytest is installed in any env on this host, so this runs the SAME
assertions against a real FastAPI app + real filesystem, calling the routes
rather than reading them. Kept next to the test file it mirrors.
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, "/home/decrux/.hermes/cache/scratch/hermes-webapp")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hermes_cli.web_routers import desktop_plugins as routes  # noqa: E402

PASSED = []
FAILED = []


def check(name, condition, detail=""):
    (PASSED if condition else FAILED).append(name)
    suffix = "" if condition else f"  <- {detail}"

    print(f"{'PASS' if condition else 'FAIL'}  {name}{suffix}")


def build(tmp: Path):
    home = tmp / "home"
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
    (home / "auth.json").write_text('{"token":"nope"}', encoding="utf-8")
    return home


def main():
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        home = build(tmp)
        routes.get_hermes_home = lambda: str(home)

        app = FastAPI()
        app.include_router(routes.router)
        client = TestClient(app)

        root = client.get("/api/desktop-plugins/root").json()["root"]
        check("root is the app-level <home>/desktop-plugins",
              root == str(home / "desktop-plugins"), root)

        entries = client.get("/api/desktop-plugins/list").json()["entries"]
        check("root listing has only the three plugin folders",
              sorted(e["name"] for e in entries) == ["backdrops", "not-a-plugin", "unified"],
              [e["name"] for e in entries])
        check("root listing marks every entry a directory", all(e["isDirectory"] for e in entries))

        body = client.get("/api/desktop-plugins/source", params={"name": "backdrops"}).json()
        check("plugin.js source is served",
              body["name"] == "plugin.js" and body["text"].startswith("export default { id: 'backdrops'"))
        check("byteSize matches the served text", body["byteSize"] == len(body["text"].encode()))

        marker = client.get(
            "/api/desktop-plugins/source", params={"name": "unified", "file": ".hermes-package.json"}
        ).json()
        check(".hermes-package.json marker is served", json.loads(marker["text"])["package"] == "unified")

        folder = client.get("/api/desktop-plugins/list", params={"name": "backdrops"}).json()["entries"]
        names = sorted(e["name"] for e in folder)
        check("folder listing includes plugin.js", "plugin.js" in names, names)

        for bad in ["../config", "..", ".", "backdrops/../..", "/etc", "backdrops/nested", ".hidden", "", "backdrops%00x"]:
            r = client.get("/api/desktop-plugins/source", params={"name": bad})
            check(f"refuses folder name {bad!r}", r.status_code in (400, 403, 404), r.status_code)

        for bad_file in ["secrets.env", "auth.json", "assets/logo.js", "plugin.js.bak", "../auth.json", "README.md"]:
            r = client.get("/api/desktop-plugins/source", params={"name": "backdrops", "file": bad_file})
            check(f"refuses file {bad_file!r}",
                  r.status_code in (400, 403, 404) and "do-not-serve" not in r.text, r.status_code)

        # A symlinked plugin.js pointing outside the root must not become a
        # general file reader.
        outside = tmp / "outside.js"
        outside.write_text("export default { secret: 1 }", encoding="utf-8")
        (home / "desktop-plugins" / "linked").mkdir()
        (home / "desktop-plugins" / "linked" / "plugin.js").symlink_to(outside)
        r = client.get("/api/desktop-plugins/source", params={"name": "linked"})
        check("refuses a symlinked plugin.js escaping the root",
              r.status_code == 403 and "secret" not in r.text, r.text[:120])

        # Oversize is refused, never truncated (the loader refuses truncation).
        saved = routes.PLUGIN_SOURCE_MAX_BYTES
        routes.PLUGIN_SOURCE_MAX_BYTES = 10
        r = client.get("/api/desktop-plugins/source", params={"name": "backdrops"})
        check("an oversize plugin.js is 413, not truncated", r.status_code == 413, r.status_code)
        routes.PLUGIN_SOURCE_MAX_BYTES = saved

    # A home that cannot host the directory degrades to "no plugins".
    with tempfile.TemporaryDirectory() as raw:
        routes.get_hermes_home = lambda: str(Path(raw) / "nope")
        app2 = FastAPI()
        app2.include_router(routes.router)
        c2 = TestClient(app2)
        check("a missing root lists as empty, not an error",
              c2.get("/api/desktop-plugins/list").json() == {"entries": []})
        check("root still resolves for a fresh install",
              c2.get("/api/desktop-plugins/root").json()["root"].endswith("/nope/desktop-plugins"))

    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
