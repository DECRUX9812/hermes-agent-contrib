#!/usr/bin/env python3
"""Draw on (and read) a shared .excalidraw canvas without hand-writing element JSON.

    python canvas.py draw  <file.excalidraw> <spec.json | ->   # add a laid-out diagram
    python canvas.py read  <file.excalidraw>                   # what is on the canvas

`draw` takes a small spec and appends a tidy, auto-laid-out diagram to the
RIGHT of whatever is already on the canvas (the person's own strokes are never
moved or edited):

    {"direction": "right",                      # or "down"
     "nodes": [{"id": "idea", "label": "Idea", "shape": "box", "color": "blue"}, ...],
     "edges": [{"from": "idea", "to": "draft", "label": "writes"}],
     "notes": ["Launch on Tuesday"]}             # optional sticky notes

shape: box | ellipse | diamond.  color: blue | violet | green | amber | red | gray.
Hermes Desktop re-reads the file when it changes, so the drawing appears live.
Stdlib only.
"""

import json
import random
import sys
from pathlib import Path

PALETTE = {
    'blue': ('#1e40af', '#dbe4ff'),
    'violet': ('#6d28d9', '#ede4ff'),
    'green': ('#047857', '#d3f9d8'),
    'amber': ('#b45309', '#fff3bf'),
    'red': ('#b91c1c', '#ffe3e3'),
    'gray': ('#374151', '#f1f3f5'),
}
SHAPES = {'box': 'rectangle', 'ellipse': 'ellipse', 'diamond': 'diamond'}
NODE_W, NODE_H, GAP_MAJOR, GAP_MINOR, MARGIN = 200, 90, 110, 50, 140
FONT_HAND = 5  # Excalifont


def _base(kind, x, y, w, h, stroke='#1e1e1e', bg='transparent', **extra):
    return {
        'id': f'hermes-{random.getrandbits(48):012x}', 'type': kind, 'x': x, 'y': y, 'width': w, 'height': h,
        'angle': 0, 'strokeColor': stroke, 'backgroundColor': bg, 'fillStyle': 'solid', 'strokeWidth': 2,
        'strokeStyle': 'solid', 'roughness': 1, 'opacity': 100, 'groupIds': [], 'frameId': None,
        'roundness': {'type': 3} if kind == 'rectangle' else None, 'seed': random.getrandbits(31),
        'version': 1, 'versionNonce': random.getrandbits(31), 'isDeleted': False, 'boundElements': [],
        'updated': 1, 'link': None, 'locked': False, **extra,
    }


def _text(label, x, y, w, h, container=None, size=20, color='#1e1e1e'):
    return _base('text', x, y, w, h, stroke=color, text=label, originalText=label, fontSize=size,
                 fontFamily=FONT_HAND, textAlign='center', verticalAlign='middle',
                 containerId=container, autoResize=True, lineHeight=1.25)


def load(path):
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8') or '{}')
    except (OSError, ValueError):
        data = {}
    data.setdefault('type', 'excalidraw')
    data.setdefault('version', 2)
    data.setdefault('source', 'hermes-agent')
    data.setdefault('elements', [])
    data.setdefault('appState', {})
    data.setdefault('files', {})
    return data


def ranks(nodes, edges):
    """Longest-path layering: a node sits one step after its latest parent."""
    ids = [n['id'] for n in nodes]
    rank = {i: 0 for i in ids}
    for _ in range(len(ids)):
        changed = False
        for e in edges:
            a, b = e.get('from'), e.get('to')
            if a in rank and b in rank and rank[b] < rank[a] + 1 and rank[a] + 1 < len(ids):
                rank[b] = rank[a] + 1
                changed = True
        if not changed:
            break
    return rank


def draw(data, spec):
    live = [e for e in data['elements'] if not e.get('isDeleted')]
    right = max((e['x'] + e.get('width', 0) for e in live), default=0)
    top = min((e['y'] for e in live), default=0)
    ox, oy = (right + MARGIN if live else 0), top
    nodes, edges = spec.get('nodes', []), spec.get('edges', [])
    down = spec.get('direction') == 'down'
    rank = ranks(nodes, edges)
    slot, pos, out = {}, {}, []

    for node in nodes:
        r = rank[node['id']]
        k = slot.get(r, 0)
        slot[r] = k + 1
        major, minor = r * (NODE_W + GAP_MAJOR if not down else NODE_H + GAP_MAJOR), k * (NODE_H + GAP_MINOR if not down else NODE_W + GAP_MINOR)
        x, y = (ox + minor, oy + major) if down else (ox + major, oy + minor)
        stroke, bg = PALETTE.get(node.get('color', 'blue'), PALETTE['blue'])
        shape = _base(SHAPES.get(node.get('shape', 'box'), 'rectangle'), x, y, NODE_W, NODE_H, stroke, bg)
        label = _text(str(node.get('label', node['id'])), x + 10, y + NODE_H / 2 - 13, NODE_W - 20, 26, shape['id'], color=stroke)
        shape['boundElements'].append({'type': 'text', 'id': label['id']})
        pos[node['id']] = shape
        out += [shape, label]

    for edge in edges:
        a, b = pos.get(edge.get('from')), pos.get(edge.get('to'))
        if not a or not b:
            continue
        sx, sy = (a['x'] + NODE_W / 2, a['y'] + NODE_H) if down else (a['x'] + NODE_W, a['y'] + NODE_H / 2)
        tx, ty = (b['x'] + NODE_W / 2, b['y']) if down else (b['x'], b['y'] + NODE_H / 2)
        arrow = _base('arrow', sx, sy, tx - sx, ty - sy, points=[[0, 0], [tx - sx, ty - sy]],
                      startBinding={'elementId': a['id'], 'focus': 0, 'gap': 6},
                      endBinding={'elementId': b['id'], 'focus': 0, 'gap': 6},
                      startArrowhead=None, endArrowhead='arrow', elbowed=False)
        a['boundElements'].append({'type': 'arrow', 'id': arrow['id']})
        b['boundElements'].append({'type': 'arrow', 'id': arrow['id']})
        out.append(arrow)
        if edge.get('label'):
            out.append(_text(str(edge['label']), (sx + tx) / 2 - 60, (sy + ty) / 2 - 30, 120, 22, size=16, color='#495057'))

    bottom = max((e['y'] + e['height'] for e in out), default=oy)
    for i, note in enumerate(spec.get('notes', [])):
        nx, ny = ox + i * 240, bottom + 60
        card = _base('rectangle', nx, ny, 220, 110, '#b08900', '#fff3bf')
        text = _text(str(note), nx + 10, ny + 40, 200, 30, card['id'], size=18, color='#5c4400')
        card['boundElements'].append({'type': 'text', 'id': text['id']})
        out += [card, text]

    data['elements'].extend(out)
    return len(out)


def read(data):
    """One line per live element: kind, text (own or bound), and position."""
    live = [e for e in data['elements'] if not e.get('isDeleted')]
    by_id = {e['id']: e for e in live}
    bound = {e['containerId']: e.get('text', '') for e in live if e.get('type') == 'text' and e.get('containerId')}
    lines = []
    for e in live:
        if e.get('type') == 'text' and e.get('containerId') in by_id:
            continue
        label = e.get('text') or bound.get(e['id'], '')
        mine = 'agent' if str(e['id']).startswith('hermes-') else 'person'
        lines.append(f"{e['type']:<10} {mine:<6} @({round(e['x'])},{round(e['y'])}) {label!r}" if label else f"{e['type']:<10} {mine:<6} @({round(e['x'])},{round(e['y'])})")
    return lines


def main(argv):
    if len(argv) < 3 or argv[1] not in ('draw', 'read'):
        print(__doc__.strip())
        return 2
    path = Path(argv[2]).expanduser()
    data = load(path)
    if argv[1] == 'read':
        lines = read(data)
        print('\n'.join(lines) if lines else '(empty canvas)')
        return 0
    raw = sys.stdin.read() if len(argv) < 4 or argv[3] == '-' else Path(argv[3]).read_text(encoding='utf-8')
    added = draw(data, json.loads(raw))
    path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    print(f'added {added} elements to {path}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
