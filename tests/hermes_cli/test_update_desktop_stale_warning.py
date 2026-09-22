"""A failed Desktop pack must not look like a successful update.

#88251: ``hermes update`` treated a failed desktop pack as non-fatal, printed
an early warning, then still ended with ``✓ Update complete!``. The Python
side moved on; the Electron app stayed on the previous build.

``_rebuild_desktop_after_update`` returns False only when a rebuild was
attempted and failed. The final banner then prints ``⚠ Update partially
complete`` instead of the success line, and gateway mode writes ``1`` to
``.update_exit_code``.

#44580: the same contract for a rebuild that cannot run at all — an installed
Desktop whose rebuild is needed but un-runnable (no resolvable npm) must set
the failure flag too — and a partial verdict must reach the process exit code
on the pulled-update paths, matching the ``--no-gateway-restart`` and
already-up-to-date repair paths that already exit 1.
"""

import contextlib
import io
from types import SimpleNamespace

import pytest

from hermes_cli import update_cmd
import hermes_cli.update_cmd_fleet as update_cmd_fleet
import hermes_cli.update_cmd_maint as update_cmd_maint
import hermes_cli.update_receipt as update_receipt
from hermes_cli.update_cmd import (
    _print_update_summary,
    _rebuild_desktop_after_update,
    _write_gateway_update_exit_code,
)


class _Result:
    def __init__(self, returncode: int, stdout: str = ""):
        self.returncode = returncode
        self.stdout = stdout


@pytest.fixture()
def desktop_env(tmp_path, monkeypatch):
    """A desktop dir that looks installed and a faked CLI main module."""
    desktop_dir = tmp_path / "apps" / "desktop"
    desktop_dir.mkdir(parents=True)
    (desktop_dir / "package.json").write_text("{}", encoding="utf-8")

    calls = {"builds": 0, "build_needed": True}

    class _FakeMain:
        PROJECT_ROOT = tmp_path

        @staticmethod
        def _resolve_node_runtime_npm():
            return "/fake/npm"

        @staticmethod
        def _desktop_build_needed(*_a, **_kw):
            return calls["build_needed"]

        @staticmethod
        def _run_logged_subprocess(cmd, cwd=None, env=None):
            calls["builds"] += 1
            return _Result(1, stdout="Error: [stage-native-deps] boom")

        @staticmethod
        def _install_rebuilt_desktop_app(_desktop_dir):
            return [], []

        @staticmethod
        def _desktop_packaged_executable(_desktop_dir):
            return None

        @staticmethod
        def _desktop_dist_exists(_desktop_dir):
            return False

        @staticmethod
        def _desktop_stamp_path():
            return tmp_path / "home" / "desktop-build-stamp.json"

    monkeypatch.setattr(update_cmd, "_m", lambda: _FakeMain)
    monkeypatch.setattr(
        "hermes_constants.with_hermes_node_path", lambda: {}, raising=False
    )
    monkeypatch.setattr(
        "hermes_constants.display_hermes_home", lambda: str(tmp_path), raising=False
    )
    return desktop_dir, calls


def _run(desktop_dir):
    return _rebuild_desktop_after_update(
        desktop_dir, had_desktop_app_before_update=True
    )


def test_failed_rebuild_returns_false_and_keeps_the_retry_hint(desktop_env, capsys):
    desktop_dir, calls = desktop_env
    assert _run(desktop_dir) is False
    assert calls["builds"] == 2
    out = capsys.readouterr().out
    assert "Desktop build failed" in out
    assert "stage-native-deps" in out
    assert "Update complete" not in out


def test_successful_rebuild_returns_true(desktop_env, monkeypatch, capsys):
    desktop_dir, _calls = desktop_env
    builds = []
    monkeypatch.setattr(
        update_cmd._m(),
        "_run_logged_subprocess",
        staticmethod(lambda cmd, cwd=None, env=None: builds.append(cmd) or _Result(0)),
    )
    assert _run(desktop_dir) is True
    assert len(builds) == 1
    assert "Desktop app up to date" in capsys.readouterr().out


def test_up_to_date_desktop_returns_true_without_spawning(desktop_env):
    desktop_dir, calls = desktop_env
    calls["build_needed"] = False
    assert _run(desktop_dir) is True
    assert calls["builds"] == 0


def test_lost_desktop_with_surviving_build_stamp_is_rebuilt(desktop_env, monkeypatch):
    """#90495: a swap that lost release/ and dist/ in an EARLIER run leaves both presence terms false
    forever; the build stamp under HERMES_HOME survived and is the proof Desktop was installed here."""
    desktop_dir, calls = desktop_env
    monkeypatch.setattr(
        update_cmd._m(), "_run_logged_subprocess",
        staticmethod(lambda cmd, cwd=None, env=None: calls.__setitem__("builds", calls["builds"] + 1) or _Result(0)),
    )
    stamp = update_cmd._m()._desktop_stamp_path()
    stamp.parent.mkdir(parents=True)
    stamp.write_text('{"commit": "old"}', encoding="utf-8")

    assert _rebuild_desktop_after_update(desktop_dir, had_desktop_app_before_update=False) is True
    assert calls["builds"] == 1

    # Control: no stamp and no artifacts = Desktop was never installed here; nothing is built.
    stamp.unlink()
    assert _rebuild_desktop_after_update(desktop_dir, had_desktop_app_before_update=False) is True
    assert calls["builds"] == 1


def test_desktop_never_installed_returns_true(tmp_path, monkeypatch):
    spawned = []
    monkeypatch.setattr(
        update_cmd,
        "_m",
        lambda: type(
            "_M",
            (),
            {
                "PROJECT_ROOT": tmp_path,
                "_resolve_node_runtime_npm": staticmethod(lambda: "/fake/npm"),
                "_run_logged_subprocess": staticmethod(
                    lambda *a, **k: spawned.append(1) or _Result(0)
                ),
            },
        ),
    )
    missing = tmp_path / "apps" / "desktop"
    missing.mkdir(parents=True)
    assert _run(missing) is True
    assert spawned == []


def test_summary_omits_success_banner_when_desktop_rebuild_failed(capsys):
    _print_update_summary(
        node_failures=[],
        desktop_build_ok=False,
        pre_update_version="0.20.1",
    )
    out = capsys.readouterr().out
    assert "Update complete" not in out
    assert "partially complete" in out
    assert "desktop app was not rebuilt" in out
    assert "hermes desktop" in out


def test_summary_keeps_success_banner_when_desktop_ok(capsys, monkeypatch):
    monkeypatch.setattr(
        update_cmd, "_update_complete_message", lambda _v: "✓ Update complete! (v0.20.2)"
    )
    monkeypatch.setattr(
        update_cmd_maint, "_update_complete_message", lambda _v: "✓ Update complete! (v0.20.2)"
    )
    monkeypatch.setattr(update_cmd, "_branch_head_suffix", lambda *a, **k: "")
    monkeypatch.setattr(
        update_cmd, "_post_update_sqlite_runtime_status", lambda: (True, None)
    )
    monkeypatch.setattr(
        update_cmd_maint, "_post_update_sqlite_runtime_status", lambda: (True, None)
    )
    _print_update_summary(
        node_failures=[],
        desktop_build_ok=True,
        pre_update_version="0.20.1",
    )
    out = capsys.readouterr().out
    assert "✓ Update complete!" in out
    assert "partially complete" not in out


def test_summary_combines_node_and_desktop_failures(capsys):
    _print_update_summary(
        node_failures=["dashboard"],
        desktop_build_ok=False,
        pre_update_version="0.20.1",
    )
    out = capsys.readouterr().out
    assert "Update complete" not in out
    assert "dashboard" in out
    assert "desktop app was not rebuilt" in out


def test_gateway_exit_code_file_tracks_desktop_rebuild(tmp_path, monkeypatch):
    monkeypatch.setattr(update_cmd, "get_hermes_home", lambda: tmp_path)
    _write_gateway_update_exit_code(True)
    assert (tmp_path / ".update_exit_code").read_text(encoding="utf-8") == "0"
    _write_gateway_update_exit_code(False)
    assert (tmp_path / ".update_exit_code").read_text(encoding="utf-8") == "1"


# ─── #44580: a rebuild that cannot run is a failed rebuild ──────────────────


def test_unresolvable_npm_with_stale_desktop_is_a_failed_rebuild(
    desktop_env, monkeypatch, capsys
):
    """Desktop installed + rebuild needed + no usable npm: the old early-return
    reported success over an app that can never be rebuilt here."""
    desktop_dir, calls = desktop_env
    monkeypatch.setattr(
        update_cmd._m(), "_resolve_node_runtime_npm", staticmethod(lambda: None)
    )
    assert _run(desktop_dir) is False
    assert calls["builds"] == 0  # spawning the build cannot help — npm is gone
    out = capsys.readouterr().out
    assert "npm" in out
    assert "Update complete" not in out


def test_unresolvable_npm_with_current_desktop_is_not_a_failure(
    desktop_env, monkeypatch
):
    """No npm but nothing to rebuild (stamp current) stays a clean True — a
    missing toolchain must not fail an update that owed no rebuild."""
    desktop_dir, calls = desktop_env
    calls["build_needed"] = False
    monkeypatch.setattr(
        update_cmd._m(), "_resolve_node_runtime_npm", staticmethod(lambda: None)
    )
    assert _run(desktop_dir) is True
    assert calls["builds"] == 0


# ─── #44580: a partial verdict reaches the process exit code ────────────────


def _healthy_fleet_restart():
    return SimpleNamespace(
        incomplete=False,
        phase_errors=[],
        pre_restart_gateway_pids=[],
        restarted_services=[],
        failed_or_stale_units=[],
        relaunched_profiles=[],
        externally_supervised_profiles=[],
        killed_pids=set(),
        fleet_probe_signals=lambda: ([], set()),
    )


def _stub_fleet_verify_externals(monkeypatch):
    """Everything _verify_fleet_after_update touches, faked healthy."""
    monkeypatch.setattr(update_cmd_fleet, "_print_legacy_units_warning", lambda: None)
    monkeypatch.setattr(
        update_cmd, "_finish_dashboard_update_cleanup", lambda *a, **k: None
    )
    monkeypatch.setattr(
        update_cmd, "_surviving_pre_update_serve_runtimes", lambda _plan: []
    )
    monkeypatch.setattr(update_cmd, "_warn_stale_serve_runtimes", lambda _rows: None)
    monkeypatch.setattr(
        update_cmd,
        "_m",
        lambda: SimpleNamespace(_fleet_probe_expected_runtimes=lambda *a: False),
    )
    monkeypatch.setattr(update_cmd_fleet, "_collect_fleet_snapshot", lambda *a: [])
    monkeypatch.setattr(update_receipt, "print_fleet_version_matrix", lambda _f: False)
    monkeypatch.setattr(
        update_receipt, "finalize_update_receipt", lambda *a, **k: None
    )
    monkeypatch.setattr(
        update_cmd_fleet, "_clear_fleet_restart_pending_marker", lambda: None
    )
    monkeypatch.setattr(
        "hermes_cli.gateway_migrate.maybe_auto_migrate_after_update", lambda: None
    )


def test_partial_update_exits_nonzero_when_fleet_is_healthy(monkeypatch):
    """A failed Desktop rebuild makes the run partial; the banner, receipt and
    gateway file already said so — the process exit code must agree (#44580)."""
    _stub_fleet_verify_externals(monkeypatch)
    with contextlib.redirect_stdout(io.StringIO()), pytest.raises(SystemExit) as exc:
        update_cmd_fleet._verify_fleet_after_update(
            _healthy_fleet_restart(),
            _pre_update_plan=None,
            _windows_gateway_resume=None,
            node_failures=[],
            update_complete=False,
        )
    assert exc.value.code == 1


def test_complete_update_still_exits_clean_when_fleet_is_healthy(monkeypatch):
    """Control: a fully-completed update keeps returning normally."""
    _stub_fleet_verify_externals(monkeypatch)
    with contextlib.redirect_stdout(io.StringIO()):
        update_cmd_fleet._verify_fleet_after_update(
            _healthy_fleet_restart(),
            _pre_update_plan=None,
            _windows_gateway_resume=None,
            node_failures=[],
            update_complete=True,
        )


def _zip_post_swap_payload():
    return {
        "swap": "zip",
        "plan": None,
        "windows_gateway_resume": None,
        "had_desktop_app_before_update": True,
        "sibling_snapshots": {},
        "pre_update_version": "0.20.0",
        "active_lazy_features": (),
        "active_tool_dependencies": (),
        "receipt": None,
    }


def test_zip_post_swap_partial_update_exits_nonzero(monkeypatch):
    """The ZIP post-swap child must relay a partial outcome as exit 1 so the
    parent (which relays the child's code) does not report success (#44580)."""
    monkeypatch.setattr(update_cmd, "_finish_zip_update", lambda **kw: False)
    with pytest.raises(SystemExit) as exc:
        update_cmd._execute_post_swap(
            _zip_post_swap_payload(), SimpleNamespace(), gateway_mode=False
        )
    assert exc.value.code == 1


def test_zip_post_swap_complete_update_returns_normally(monkeypatch):
    monkeypatch.setattr(update_cmd, "_finish_zip_update", lambda **kw: True)
    update_cmd._execute_post_swap(
        _zip_post_swap_payload(), SimpleNamespace(), gateway_mode=False
    )
