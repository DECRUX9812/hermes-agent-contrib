"""A Webapp login opens the Bot Chat its own earlier web sessions stamped (overlay core-patch).

Before the gateway owned sessions, the Webapp's chat surface wrote its rows itself: ``source='tui'``
with the login stamped as ``user_id`` (``basic:<user>``, tui_gateway/session_transports.py). Those
rows then answered ``not_found`` to every caller: the browser reaches the gateway through the
dashboard mount, never natively, so ``adopt_legacy_session`` refused it, and ``login_owned_by`` only
excused Desktop rows, so ``hermes sessions adopt`` on the host skipped them as foreign too. Bot Mode
showed "Could not check <bot>'s Bot Chat registry (not_found) — not starting a new chat" for every
bot. The login whose authenticated subject spells exactly the stamp now adopts it; any other login,
an issuer-bearing login, an unstamped legacy row and a messaging stamp stay refused.
"""
from pathlib import Path

import pytest

from tests.gateway.test_session_authorities_multiplex import _reserve_homes, _runner


class _Transport:
    def write(self, frame):
        return True

    def close(self):
        pass


async def _web_lookup(tmp_path, monkeypatch, source, user_id, login=('basic', '', 'ritesh')):
    from gateway.run_runtime import initialize_gateway_runtime
    from gateway.runtime_ownership import process_ownership
    from gateway.session_authorities import authority_for_profile_id, owner_scope
    from gateway.session_controls import AuthorityConnection
    root, homes = _reserve_homes(tmp_path, monkeypatch)
    process_ownership.reserve([home for _, home in homes])
    connections, runner, replies = [], None, {}
    try:
        runner = _runner(root, homes)
        await initialize_gateway_runtime(runner)
        ids = {name: str(home.resolve()) for name, home in homes}
        authority = authority_for_profile_id(runner, ids['alpha'])
        provider, issuer, user = login
        # What hermes_cli/web_routers/chat_ws.gateway_ws hands handle_ws for a signed-in Webapp tab.
        identity = {'user_id': user, 'provider': provider, 'issuer': issuer, 'profile_id': authority.profile_id,
                    'instance_id': authority.instance_id, 'profile_scope': 'host'}
        with owner_scope(authority):
            web = AuthorityConnection(authority, _Transport(), identity, operator=True)
        connections.append(web)
        for prof in ('default', 'beta'):
            db = authority_for_profile_id(runner, ids[prof]).db
            db.create_session(prof + '-bot-chat', source=source, model='old', cwd=str(root), user_id=user_id)
            db.set_session_title(prof + '-bot-chat', 'Bot Chat')
            db.set_session_hidden(prof + '-bot-chat', True)
        for prof in ('default', 'beta'):
            with owner_scope(web.authority):
                replies[prof] = await web.dispatch({'id': 1, 'method': 'session.list', 'params': {
                    'profile': prof, 'title': 'Bot Chat', 'include_hidden': True, 'limit': 200}})
    finally:
        for connection in connections:
            with owner_scope(connection.authority):
                await connection.close()
        for authority in list(getattr(runner, 'session_authorities', []) or []):
            authority.db.close()
        for _, home in homes:
            process_ownership.release(Path(home))
    return replies


@pytest.mark.asyncio
@pytest.mark.parametrize('source', ['tui', 'desktop'])
async def test_webapp_login_opens_the_bot_chat_it_stamped(tmp_path, monkeypatch, source):
    replies = await _web_lookup(tmp_path, monkeypatch, source, 'basic:ritesh')
    for prof, reply in replies.items():
        assert 'error' not in reply, (prof, reply)
        assert [s.get('id') or s.get('session_id') for s in reply['result']['sessions']] == [prof + '-bot-chat'], (
            prof, reply)


@pytest.mark.asyncio
@pytest.mark.parametrize('user_id,login', [
    ('basic:alice', ('basic', '', 'ritesh')),       # another login's stamp
    ('basic:ritesh', ('basic', 'iss', 'ritesh')),   # an issuer-bearing login never claims a bare label
    (None, ('basic', '', 'ritesh')),                # unstamped history stays native-owner only
    ('telegram:42', ('telegram', '', '42')),        # a messaging stamp is a real foreign identity
])
async def test_other_stamps_stay_refused_for_a_webapp_login(tmp_path, monkeypatch, user_id, login):
    replies = await _web_lookup(tmp_path, monkeypatch, 'tui', user_id, login)
    for prof, reply in replies.items():
        assert reply.get('error', {}).get('message') == 'not_found', (prof, reply)


def test_login_owned_by_covers_webapp_tui_rows_only_for_that_login(tmp_path):
    from hermes_state import SessionDB
    from hermes_state_local_migration import login_owned_by, validate_legacy_row
    from hermes_state_runtime import RuntimeStoreError
    db = SessionDB(db_path=tmp_path / 'state.db')
    try:
        db.create_session('web', source='tui', user_id='basic:ritesh')
        row = db.get_session('web')
        assert login_owned_by(row, 'auth:v1:["basic","","ritesh"]')
        validate_legacy_row(db, row, subject='auth:v1:["basic","","ritesh"]')
        for other in (None, 'uid:1000', 'auth:v1:["basic","","bob"]', 'auth:v1:["basic","iss","ritesh"]'):
            assert not login_owned_by(row, other)
            with pytest.raises(RuntimeStoreError):
                validate_legacy_row(db, row, subject=other)
        db.create_session('cli', source='cli', user_id='basic:ritesh')
        assert not login_owned_by(db.get_session('cli'), 'auth:v1:["basic","","ritesh"]')
    finally:
        db.close()
