"""Invisible/zero-width characters must not survive project-name validation."""

from __future__ import annotations

import pytest

from hermes_cli import projects_db as pdb


@pytest.fixture
def conn(tmp_path):
    c = pdb.connect(db_path=tmp_path / "projects.db")
    try:
        yield c
    finally:
        c.close()


@pytest.mark.parametrize("name", ["​", "​ ​", "﻿", "﻿​"])
def test_create_project_rejects_invisible_only_name(conn, name):
    with pytest.raises(ValueError):
        pdb.create_project(conn, name=name, folders=["/tmp/x"])


def test_create_project_strips_invisible_chars(conn):
    pid = pdb.create_project(conn, name="My ​Project", folders=["/tmp/x"])
    proj = pdb.get_project(conn, pid)
    assert proj is not None
    assert proj.name == "My Project"
    assert proj.slug == "my-project"


def test_update_project_rejects_invisible_only_name(conn):
    pid = pdb.create_project(conn, name="Real", folders=["/tmp/x"])
    with pytest.raises(ValueError):
        pdb.update_project(conn, pid, name="​")


def test_update_project_strips_invisible_chars(conn):
    pid = pdb.create_project(conn, name="Real", folders=["/tmp/x"])
    assert pdb.update_project(conn, pid, name="Renamed ﻿​Project") is True
    assert pdb.get_project(conn, pid).name == "Renamed Project"
