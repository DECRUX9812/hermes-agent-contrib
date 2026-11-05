"""Tests for recovering sessions with broken, wiped, or respelled provider routes (#140290)."""
import json
from pathlib import Path
from types import SimpleNamespace
import pytest

from gateway.config import GatewayConfig
from gateway.session import SessionStore
from gateway.session_authority import SessionAuthority
from gateway.session_controls import AuthorityConnection
from gateway.session_policy import build_policy, bind_launch_key, restore_policy
from gateway.run_turn_prepare import GatewayTurnPrepareMixin
import hermes_state_runtime as rt
from hermes_state_runtime import RuntimeStoreError


def _setup_owner(home, profile_id='coder'):
    store = SessionStore(home, GatewayConfig())
    db = store._db
    runner = SimpleNamespace(
        session_store=store, _session_db=db, adapters={}, _draining=False,
        _evict_cached_agent=lambda route: None, _cached_agent_for=lambda route: None,
        _handle_message=None, _peek_session_state=lambda key: None,
    )
    runner._adapter_for_source = lambda source: runner.adapters.get(source.platform)
    authority = SessionAuthority(
        runner, profile_id=profile_id, instance_id='test-owner', db=db,
        epoch=rt.begin_runtime_epoch(db, instance_id='test-owner'),
    )
    runner.session_authority = authority
    runner._resolve_session_agent_runtime = GatewayTurnPrepareMixin._resolve_session_agent_runtime.__get__(runner)
    return store, runner, authority, AuthorityConnection(authority, object(), {'user_id': 'human'})


@pytest.fixture
def home(monkeypatch):
    from agent import models_dev
    from gateway import run
    from hermes_constants import get_hermes_home
    h = get_hermes_home()
    h.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(run, '_hermes_home', h)
    catalog = {'custom': {'id': 'custom', 'models': {
        'default-model': {'id': 'default-model', 'name': 'default-model', 'tool_call': True, 'cost': {'input': 0, 'output': 0}},
        'new-model': {'id': 'new-model', 'name': 'new-model', 'tool_call': True, 'cost': {'input': 0, 'output': 0}},
    }}}
    monkeypatch.setattr(models_dev, 'fetch_models_dev', lambda *args, **kwargs: catalog)
    return h


@pytest.mark.asyncio
async def test_stranded_receipt_falls_back_to_profile_default(home):
    """Fixture repro from #140290: receipt frozen on claude-opus-4.6 / provider=auto with providers={}.
    When the profile has a configured default route, turn preparation falls back to that default
    instead of raising ProviderNotConfiguredError."""
    # Profile has a working custom route
    (home / 'config.yaml').write_text(json.dumps({
        'model': {'provider': 'custom', 'default': 'default-model', 'base_url': 'http://127.0.0.1:9099/v1', 'api_key': 'key-default'},
    }), encoding='utf-8')

    fixture_path = Path('/home/decrux/Code/stranded-receipt-fixture/stranded_receipt.json')
    receipt = json.loads(fixture_path.read_text(encoding='utf-8'))

    store, runner, authority, owner = _setup_owner(home, profile_id=receipt['profile_id'])
    try:
        policy_data = dict(receipt['policy'], cwd=str(home), toolsets=['bot_room'],
                           terminal_json=json.dumps({'TERMINAL_CWD': str(home)}))
        policy = restore_policy(policy_data)
        from gateway.run_turn_prepare import _resolve_policy_agent_runtime
        model, runtime = _resolve_policy_agent_runtime(runner, policy, fallback=True)
        # Should cleanly resolve to the profile's working default instead of failing
        assert model == 'default-model'
        assert runtime.get('provider') == 'custom'
        assert runtime.get('api_key') == 'key-default'
    finally:
        await owner.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_model_mutation_succeeds_even_when_old_route_secrets_unrecoverable(home):
    """When a session's old route provider has disappeared from config.yaml, /model mutation must
    not raise launch_credentials_unavailable and must successfully switch to the new model."""
    # Initial config with provider-a
    (home / 'config.yaml').write_text(json.dumps({
        'model': {'provider': 'custom', 'default': 'default-model', 'base_url': 'http://127.0.0.1:8001/v1', 'api_key': 'key-a'},
        'providers': {
            'prov-b': {'base_url': 'http://127.0.0.1:8002/v1', 'api_key': 'key-b'},
        }
    }), encoding='utf-8')

    store, runner, authority, owner = _setup_owner(home)
    try:
        res = await owner.dispatch({
            'id': 'create', 'method': 'session.create',
            'params': {'request_id': 'c1', 'source': 'gui', 'cwd': str(home), 'toolsets': []}
        })
        sid = res['result']['session_id']

        # Clear RAM cache so it reads from disk
        if hasattr(authority, '_local_config_secrets'):
            authority._local_config_secrets.clear()

        # Now simulate a profile reset: wipe out the original model block so old secrets can't be recovered
        (home / 'config.yaml').write_text(json.dumps({
            'model': {'provider': 'auto', 'default': 'anthropic/claude-opus-4.6'},
            'providers': {
                'prov-b': {'base_url': 'http://127.0.0.1:8002/v1', 'api_key': 'key-b'},
            }
        }), encoding='utf-8')

        row = authority.db.get_session(sid)
        mutate_res = await owner.dispatch({
            'id': 'mut', 'method': 'session.mutate',
            'params': {
                'session_id': sid, 'request_id': 'm1',
                'expected_revision': row['runtime_revision'],
                'expected_generation': row['runtime_generation'],
                'operation': 'model',
                'payload': {'model': 'new-model', 'provider': 'prov-b'}
            }
        })
        assert 'result' in mutate_res, mutate_res
        live = authority.sessions[sid]
        model, runtime = runner._resolve_session_agent_runtime(source=live.source)
        assert model == 'new-model'
        assert runtime.get('api_key') == 'key-b'
    finally:
        await owner.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_non_credential_field_removal_does_not_strand_session(home):
    """Removing non-credential fields like extra_headers from a provider does not trigger
    launch_credentials_unavailable."""
    (home / 'config.yaml').write_text(json.dumps({
        'model': {'provider': 'custom', 'default': 'default-model', 'base_url': 'http://127.0.0.1:8001/v1',
                  'api_key': 'key-a', 'extra_headers': {'X-Custom': 'meta'}}
    }), encoding='utf-8')

    store, runner, authority, owner = _setup_owner(home)
    try:
        res = await owner.dispatch({
            'id': 'create', 'method': 'session.create',
            'params': {'request_id': 'c1', 'source': 'gui', 'cwd': str(home), 'toolsets': []}
        })
        sid = res['result']['session_id']

        # Clear RAM cache
        if hasattr(authority, '_local_config_secrets'):
            authority._local_config_secrets.clear()

        # Remove extra_headers from config.yaml
        (home / 'config.yaml').write_text(json.dumps({
            'model': {'provider': 'custom', 'default': 'default-model', 'base_url': 'http://127.0.0.1:8001/v1',
                      'api_key': 'key-a'}
        }), encoding='utf-8')

        live = authority.sessions[sid]
        model, runtime = runner._resolve_session_agent_runtime(source=live.source)
        assert model == 'default-model'
        assert runtime.get('api_key') == 'key-a'
    finally:
        await owner.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_credential_respelling_between_api_key_and_key_env(home, monkeypatch):
    """Rewriting inline api_key to sibling key_env with the same secret value preserves session recovery."""
    (home / 'config.yaml').write_text(json.dumps({
        'model': {'provider': 'custom', 'default': 'default-model', 'base_url': 'http://127.0.0.1:8001/v1',
                  'api_key': 'secret-123'}
    }), encoding='utf-8')

    store, runner, authority, owner = _setup_owner(home)
    try:
        res = await owner.dispatch({
            'id': 'create', 'method': 'session.create',
            'params': {'request_id': 'c1', 'source': 'gui', 'cwd': str(home), 'toolsets': []}
        })
        sid = res['result']['session_id']

        # Clear RAM cache
        if hasattr(authority, '_local_config_secrets'):
            authority._local_config_secrets.clear()

        # Rewrite config to use key_env pointing to .env
        monkeypatch.setenv('MY_KEY', 'secret-123')
        (home / '.env').write_text('MY_KEY=secret-123\n', encoding='utf-8')
        (home / 'config.yaml').write_text(json.dumps({
            'model': {'provider': 'custom', 'default': 'default-model', 'base_url': 'http://127.0.0.1:8001/v1',
                      'key_env': 'MY_KEY'}
        }), encoding='utf-8')

        live = authority.sessions[sid]
        model, runtime = runner._resolve_session_agent_runtime(source=live.source)
        assert model == 'default-model'
        assert runtime.get('api_key') == 'secret-123'
    finally:
        await owner.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_revoked_credentials_still_refuse(home):
    """Actual credential change (key rotation/revocation) on a frozen policy session without re-binding still refuses."""
    cfg = {
        'model': {'provider': 'custom', 'default': 'default-model', 'base_url': 'http://127.0.0.1:8001/v1',
                  'api_key': 'original-secret'},
        'platform_toolsets': {'cli': []}
    }
    (home / 'config.yaml').write_text(json.dumps(cfg), encoding='utf-8')

    store, runner, authority, owner = _setup_owner(home)
    try:
        private = {}
        policy = build_policy({'cwd': str(home), 'model': 'default-model', 'follow_profile_config': False},
                              cfg, private_secrets=private)
        policy = bind_launch_key(authority, 'test-sid', policy, None, config_secrets=private)

        # Clear RAM cache so it must read and verify fingerprints against disk
        if hasattr(authority, '_local_config_secrets'):
            authority._local_config_secrets.clear()

        # Verify initial config recovers key
        recovered_cfg, _ = policy.effective(authority)
        assert recovered_cfg['model']['api_key'] == 'original-secret'

        # Revoke/change the secret in config.yaml
        if hasattr(authority, '_local_config_secrets'):
            authority._local_config_secrets.clear()
        cfg['model']['api_key'] = 'changed-wrong-secret'
        (home / 'config.yaml').write_text(json.dumps(cfg), encoding='utf-8')

        with pytest.raises(RuntimeStoreError) as exc_info:
            policy.effective(authority)
        assert exc_info.value.reason == 'launch_credentials_unavailable'
    finally:
        await owner.close()
        store.close_all_db_handles()
