"""A failed Desktop pack must not look like a successful update.

#88251: ``hermes update`` treated a failed desktop pack as non-fatal, printed
an early warning, then still ended with ``✓ Update complete!``. The Python
side moved on; the Electron app stayed on the previous build.

``_rebuild_desktop_after_update`` returns False only when a rebuild was
attempted and failed. The final banner then prints ``⚠ Update partially
complete`` instead of the success line, and gateway mode writes ``1`` to
``.update_exit_code``.
"""

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


def _post_swap_opts(**overrides):
    base = dict(
        assume_yes=True, gw_input_fn=None, active_lazy_features=[],
        active_tool_dependencies=[], pre_update_version="0.20.1",
        discard_local_changes=False, keep_stash=False, switch_branch=False,
        no_gateway_restart=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _clean_restart():
    return SimpleNamespace(
        incomplete=False, phase_errors=[], pre_restart_gateway_pids=[],
        restarted_services=[], failed_or_stale_units=[], relaunched_profiles=[],
        externally_supervised_profiles=[], killed_pids=set(),
        fleet_probe_signals=lambda: ([], set()),
    )


def _stub_fleet_verify_internals(tmp_path, monkeypatch):
    """Let the real ``_verify_fleet_after_update`` run without touching the host fleet."""
    monkeypatch.setattr(update_cmd_fleet, "_print_legacy_units_warning", lambda: None)
    monkeypatch.setattr(update_cmd, "_finish_dashboard_update_cleanup", lambda *a, **k: None)
    monkeypatch.setattr(update_cmd, "_surviving_pre_update_serve_runtimes", lambda *a, **k: [])
    monkeypatch.setattr(update_cmd, "_warn_stale_serve_runtimes", lambda *a, **k: None)
    monkeypatch.setattr(
        "hermes_cli.update_receipt.collect_fleet_versions", lambda **k: [])
    monkeypatch.setattr(
        "hermes_cli.gateway_migrate.maybe_auto_migrate_after_update", lambda: None,
        raising=False)
    monkeypatch.setattr(update_cmd_fleet, "_clear_fleet_restart_pending_marker", lambda: None)


def _stub_maintenance_internals(monkeypatch):
    """Let the real ``_run_post_update_maintenance``/``_print_update_summary`` run."""
    monkeypatch.setattr(
        "hermes_cli.macos_tcc_anchor.ensure_tcc_anchor", lambda: None, raising=False)
    monkeypatch.setattr(
        update_cmd_maint, "_verify_and_restore_state_dbs_post_update", lambda: None)
    monkeypatch.setattr(
        "hermes_cli.model_catalog.seed_cache_from_checkout", lambda *a, **k: False,
        raising=False)
    monkeypatch.setattr(update_cmd_maint, "_print_bundled_skills_sync_report", lambda: None)
    monkeypatch.setattr(update_cmd_maint, "_sync_profiles_after_update", lambda: None)
    monkeypatch.setattr(
        update_cmd, "_check_and_apply_config_migration", lambda *a, **k: None)
    monkeypatch.setattr(
        update_cmd_maint, "_print_post_update_notices_and_self_heals", lambda: None)
    monkeypatch.setattr(
        update_cmd, "_post_update_sqlite_runtime_status", lambda: (True, None))


def test_pulled_update_exits_nonzero_when_desktop_rebuild_fails(tmp_path, monkeypatch, capsys):
    """#88251 follow-up: a partial update must not exit 0 — automation reads the exit code.

    The already-current and ``--no-gateway-restart`` paths exit 1 on a partial update;
    the pulled post-swap tail must too.
    """
    monkeypatch.setattr(update_cmd, "_m", lambda: SimpleNamespace(
        PROJECT_ROOT=tmp_path,
        _build_web_ui=lambda *a, **k: None,
        _fleet_probe_expected_runtimes=lambda *a, **k: False,
    ))
    monkeypatch.setattr(update_cmd, "_sync_python_dependencies_after_pull", lambda *a, **k: None)
    monkeypatch.setattr(update_cmd, "_update_node_dependencies", lambda: [])
    monkeypatch.setattr(update_cmd, "_rebuild_desktop_after_update", lambda *a, **k: False)
    monkeypatch.setattr(update_cmd, "_branch_head_suffix", lambda *a, **k: "")
    monkeypatch.setattr(
        update_cmd, "_restart_gateway_fleet_after_update", lambda *a, **k: _clean_restart())
    monkeypatch.setattr(
        update_cmd, "_resume_windows_gateways_and_merge_outcome", lambda *a, **k: None)
    _stub_maintenance_internals(monkeypatch)
    _stub_fleet_verify_internals(tmp_path, monkeypatch)
    update_receipt._current = None

    with pytest.raises(SystemExit) as excinfo:
        update_cmd._finish_pulled_update(
            ["git"], "main", "oldsha", _post_swap_opts(), gateway_mode=False,
            is_fork=False, desktop_dir=tmp_path / "apps" / "desktop",
            had_desktop_app_before_update=True, pre_update_snapshot_id=None,
            _pre_update_plan=None, _windows_gateway_resume=None)

    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "partially complete" in out
    assert "Update complete!" not in out


def test_pulled_update_partial_in_gateway_mode_writes_exit_code_not_exit(
        tmp_path, monkeypatch, capsys):
    """Under --gateway the verdict rides in ``.update_exit_code`` (the process can be
    SIGKILLed by its own fleet restart); the desktop updater scripts read the output."""
    exit_codes = []
    monkeypatch.setattr(update_cmd, "_m", lambda: SimpleNamespace(
        PROJECT_ROOT=tmp_path,
        _build_web_ui=lambda *a, **k: None,
        _fleet_probe_expected_runtimes=lambda *a, **k: False,
    ))
    monkeypatch.setattr(update_cmd, "_sync_python_dependencies_after_pull", lambda *a, **k: None)
    monkeypatch.setattr(update_cmd, "_update_node_dependencies", lambda: [])
    monkeypatch.setattr(update_cmd, "_rebuild_desktop_after_update", lambda *a, **k: False)
    monkeypatch.setattr(update_cmd, "_branch_head_suffix", lambda *a, **k: "")
    monkeypatch.setattr(
        update_cmd, "_restart_gateway_fleet_after_update", lambda *a, **k: _clean_restart())
    monkeypatch.setattr(
        update_cmd, "_resume_windows_gateways_and_merge_outcome", lambda *a, **k: None)
    monkeypatch.setattr(
        update_cmd, "_write_gateway_update_exit_code", lambda ok: exit_codes.append(ok))
    _stub_maintenance_internals(monkeypatch)
    _stub_fleet_verify_internals(tmp_path, monkeypatch)
    update_receipt._current = None

    update_cmd._finish_pulled_update(
        ["git"], "main", "oldsha", _post_swap_opts(), gateway_mode=True,
        is_fork=False, desktop_dir=tmp_path / "apps" / "desktop",
        had_desktop_app_before_update=True, pre_update_snapshot_id=None,
        _pre_update_plan=None, _windows_gateway_resume=None)

    assert exit_codes == [False]
    assert "Update complete!" not in capsys.readouterr().out


def test_zip_post_swap_exits_nonzero_when_desktop_rebuild_fails(tmp_path, monkeypatch):
    """The ZIP post-swap tail must fail the process on a partial update, same as git."""
    monkeypatch.setattr(update_cmd, "_m", lambda: SimpleNamespace(PROJECT_ROOT=tmp_path))
    monkeypatch.setattr(
        update_cmd, "_resolve_update_options",
        lambda *a: update_cmd._UpdateOptions(
            active_lazy_features=[], active_tool_dependencies=[], pre_update_version="0.20.1",
            gw_input_fn=None, assume_yes=True, keep_stash=False, switch_branch=False,
            discard_local_changes=False))
    monkeypatch.setattr(update_cmd, "_finish_zip_update", lambda **k: False)

    payload = {
        "swap": "zip", "branch": "main", "plan": None, "windows_gateway_resume": None,
        "sibling_snapshots": {}, "pre_update_version": "0.20.1",
        "had_desktop_app_before_update": True,
    }
    with pytest.raises(SystemExit) as excinfo:
        update_cmd._execute_post_swap(payload, SimpleNamespace(), gateway_mode=False)

    assert excinfo.value.code == 1
