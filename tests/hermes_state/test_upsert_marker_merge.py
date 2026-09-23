"""The ``_insert_session_row`` upsert merge must never leave a row holding both a
listable marker (``_reset_from``) and an exclusion marker
(``_delegate_from``/``_branched_from``): every list query filters
``_delegate_from IS NULL``, so such a row vanishes from every picker while still
routing (#109073)."""

import json

import pytest

from hermes_state import SessionDB


@pytest.fixture()
def db(tmp_path):
    session_db = SessionDB(db_path=tmp_path / "state.db")
    try:
        yield session_db
    finally:
        session_db.close()


@pytest.mark.parametrize("marker", ["_delegate_from", "_branched_from"])
def test_upsert_reset_merge_strips_exclusion_markers(db: SessionDB, marker: str) -> None:
    """A reset-fork row re-upserted with a delegate/branch config keeps the
    ``_reset_from`` transplant but must drop the incoming exclusion marker —
    the listable marker wins."""
    db.create_session("s", source="webui", model_config={"_reset_from": "parent"})
    db.create_session("s", source="tool", model_config={marker: "other"})

    cfg = json.loads(db.get_session("s")["model_config"])
    assert "_delegate_from" not in cfg
    assert "_branched_from" not in cfg
    assert cfg["_reset_from"] == "parent"
    assert "s" in [row["id"] for row in db.list_sessions_rich()]
