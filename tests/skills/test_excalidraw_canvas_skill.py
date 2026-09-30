"""The excalidraw skill's canvas helper: a spec becomes a laid-out, bound diagram
added beside the person's own strokes (never on top of or instead of them), and
`read` reports what is on the canvas, whoever drew it."""

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'optional-skills' / 'creative' / 'excalidraw' / 'scripts' / 'canvas.py'
spec_ = importlib.util.spec_from_file_location('excalidraw_canvas', SCRIPT)
canvas = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(canvas)


def test_draw_lays_out_beside_existing_strokes_and_binds_labels(tmp_path):
    path = tmp_path / 'canvas.excalidraw'
    mine = {'id': 'person-rect', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 300, 'height': 100, 'version': 3}
    path.write_text(json.dumps({'elements': [mine]}))

    spec = {'nodes': [{'id': 'a', 'label': 'Idea'}, {'id': 'b', 'label': 'Ship', 'shape': 'ellipse'}],
            'edges': [{'from': 'a', 'to': 'b', 'label': 'go'}], 'notes': ['Tuesday']}
    assert canvas.main(['canvas.py', 'draw', str(path), str(_write(tmp_path, spec))]) == 0

    data = json.loads(path.read_text())
    assert data['elements'][0] == mine  # untouched, still first
    added = data['elements'][1:]
    shapes = {e['id']: e for e in added if e['type'] in ('rectangle', 'ellipse')}
    assert all(e['x'] >= mine['x'] + mine['width'] for e in added)  # to the right of their drawing
    for text in (e for e in added if e['type'] == 'text' and e.get('containerId')):
        assert {'type': 'text', 'id': text['id']} in shapes[text['containerId']]['boundElements']
    arrow = next(e for e in added if e['type'] == 'arrow')
    assert {arrow['startBinding']['elementId'], arrow['endBinding']['elementId']} <= set(shapes)
    ranks = sorted(e['x'] for e in added if e['type'] in ('rectangle', 'ellipse') and e['backgroundColor'] != '#fff3bf')
    assert ranks[0] < ranks[1]  # edge direction reads left to right

    lines = canvas.read(data)
    assert any("person" in line and line.startswith('rectangle') for line in lines)
    assert any("'Idea'" in line and 'agent' in line for line in lines)


def _write(tmp_path, spec):
    p = tmp_path / 'spec.json'
    p.write_text(json.dumps(spec))
    return p
