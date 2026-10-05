"""Regenerate the vanilla-style block textures the AgentCraft Studio needs.

The AgentCraft mod never ships Mojang assets: vanilla blocks come from the
player's own Minecraft install at runtime. This studio rebuild can't do that,
so this script writes *replicas* — same palette and layout family per vanilla
texture, with noise re-rolled from our own RNG. Output lands in
`apps/desktop/src/plugins/agentcraft/assets/vanilla/` and is loaded by the
three.js texture atlas alongside the MIT-licensed `ac:*` PNGs.

    python3 gen_vanilla.py            # write every PNG
    python3 gen_vanilla.py --sheet    # + contact sheet vs /tmp/mc/block refs
"""

from __future__ import annotations

import os
import random
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    raise SystemExit('pip install pillow')

OUT = Path(__file__).resolve().parents[3] / 'apps/desktop/src/plugins/agentcraft/assets/vanilla'
REF = Path(os.environ.get('GEN_VANILLA_REF', Path(tempfile.gettempdir()) / 'mc' / 'block'))


class Img:
    def __init__(self, w: int = 16, h: int = 16):
        self.im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        self.px = self.im.load()

    def put(self, x: int, y: int, c):
        if 0 <= x < self.im.width and 0 <= y < self.im.height:
            if len(c) == 3:
                c = (*c, 255)
            self.px[x, y] = c

    def get(self, x: int, y: int):
        return self.px[x, y]


def C(hexs: str):
    return tuple(int(hexs[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def rng(seed: int):
    return random.Random(seed)


def noise(im: Img, tones, seed: int, jit: int = 1, base=None):
    r = rng(seed)
    if base is None:
        base = len(tones) // 2
    for y in range(16):
        for x in range(16):
            j = round((r.random() - 0.5) * 2 * jit)
            im.put(x, y, tones[max(0, min(len(tones) - 1, base + j))])


def planks(tones, seam, seed: int, knots=True):
    """Vanilla planks: 4 boards of 4px, vertical seams staggered per board.
    Each board sticks to its own tone with only ±1-neighbour jitter — vanilla
    boards read as clean fields, not per-pixel checker noise."""
    im = Img()
    r = rng(seed)
    for row in range(4):
        y0 = row * 4
        bi = r.randrange(len(tones))
        base = tones[bi]
        near = [tones[max(0, bi - 1)], tones[min(len(tones) - 1, bi + 1)]]
        vseam = 2 + r.randrange(10)
        for y in range(y0, y0 + 4):
            for x in range(16):
                t = base
                if r.random() < 0.18:
                    t = near[r.randrange(len(near))]
                if y == y0 + 3:
                    t = seam
                if x == vseam and y > y0:
                    t = seam
                im.put(x, y, t)
        if knots and r.random() < 0.5:
            kx, ky = r.randrange(3, 13), y0 + 1
            im.put(kx, ky, seam)
            im.put(kx + 1, ky, seam)
            im.put(kx, ky + 1, seam)
    return im


def log_side(base, dark, light, seed: int):
    """Vertical bark: columnar streaks in a tight tonal range."""
    im = Img()
    r = rng(seed)
    col_t = []
    for _ in range(16):
        v = r.random()
        col_t.append(base if v < 0.55 else dark if v < 0.8 else light)
    for x in range(16):
        for y in range(16):
            t = col_t[x]
            v = r.random()
            if v < 0.10:
                t = dark
            elif v < 0.16:
                t = light
            im.put(x, y, t)
    return im


def birch_side(seed: int):
    """Birch bark: white field with dark horizontal dashes."""
    im = Img()
    r = rng(seed)
    base = C('#f0eeeb')
    alt = C('#d8d8ce')
    dash = C('#3a342c')
    for y in range(16):
        for x in range(16):
            im.put(x, y, base if r.random() < 0.8 else alt)
    for _ in range(9):
        y = r.randrange(1, 15)
        x0 = r.randrange(0, 12)
        w = r.randrange(2, 5)
        for x in range(x0, min(15, x0 + w)):
            im.put(x, y, dash)
            if r.random() < 0.4 and y + 1 < 16:
                im.put(x, y + 1, dash)
    return im


def stripped_side(base, hi, lo, seed: int):
    """Stripped log: smooth vertical grain."""
    im = Img()
    r = rng(seed)
    for x in range(16):
        for y in range(16):
            t = base
            v = r.random()
            if v < 0.09:
                t = hi
            elif v < 0.15:
                t = lo
            im.put(x, y, t)
    return im


def log_top(edge, ring_a, ring_b, center, seed: int):
    """Log end grain: dark bark edge, low-contrast concentric rings."""
    im = Img()
    r = rng(seed)
    cx = cy = 7.5
    for y in range(16):
        for x in range(16):
            d = max(abs(x - cx), abs(y - cy))
            if d >= 7.0:
                t = edge
            elif d <= 1.5:
                t = center
            else:
                t = ring_a if int(d / 2) % 2 == 0 else ring_b
                if r.random() < 0.08:
                    t = ring_b if t == ring_a else ring_a
            im.put(x, y, t)
    return im


def brick(brick, mortar, hi, seed: int):
    """Vanilla bricks: 4x4 bricks, staggered, 1px mortar."""
    im = Img()
    r = rng(seed)
    for y in range(16):
        row = y // 4
        off = 2 if row % 2 else 0
        mortar_row = y % 4 == 3
        for x in range(16):
            if mortar_row or (x + off) % 4 == 3:
                im.put(x, y, mortar)
            else:
                t = brick
                if r.random() < 0.15:
                    t = hi
                if r.random() < 0.1:
                    t = mortar
                im.put(x, y, t)
    return im


def stone_bricks(tones, _crack, seed: int):
    """2x2 brick grid per 8px cell with carved border + edge highlights."""
    im = Img()
    r = rng(seed)
    frame, main, hi, shadow = tones
    for y in range(16):
        for x in range(16):
            lx, ly = x % 8, y % 8
            if lx in (0, 7) or ly in (0, 7):
                t = frame
            elif lx == 3 or ly == 3:
                t = shadow
            else:
                t = main
            if r.random() < 0.12:
                t = hi if r.random() < 0.5 else shadow
            im.put(x, y, t)
    return im


def cobble(tones, gap, seed: int, moss=None):
    """Rounded cobble lumps."""
    im = Img()
    r = rng(seed)
    cells = [(1, 1, 5, 5), (9, 0, 6, 5), (0, 7, 6, 5), (7, 6, 6, 5), (1, 12, 6, 3), (10, 12, 5, 3), (12, 5, 4, 5), (6, 8, 0, 0)]
    tone = {}
    for i, _ in enumerate(cells):
        tone[i] = tones[r.randrange(len(tones))]
    for y in range(16):
        for x in range(16):
            t = gap
            for i, (cx, cy, w, h) in enumerate(cells):
                if w and cx <= x < cx + w and cy <= y < cy + h:
                    lx, ly = x - cx, y - cy
                    t = tone[i]
                    if lx == 0 or ly == 0 or lx == w - 1 or ly == h - 1:
                        t = tones[0] if r.random() < 0.6 else t
                    elif r.random() < 0.15:
                        t = tones[min(len(tones) - 1, tones.index(tone[i]) + 1)]
            if moss and r.random() < 0.18:
                t = moss[r.randrange(len(moss))]
            im.put(x, y, t)
    return im


def grass_top(tones, seed: int):
    im = Img()
    r = rng(seed)
    for y in range(16):
        for x in range(16):
            v = r.random()
            im.put(x, y, tones[0] if v < 0.55 else tones[1] if v < 0.9 else tones[2])
    return im


def grass_side(dirt, green, seed: int):
    im = Img()
    r = rng(seed)
    edge = [3 + (1 if r.random() < 0.45 else 0) - (1 if r.random() < 0.15 else 0) for _ in range(16)]
    for x in range(16):
        for y in range(16):
            if y < edge[x]:
                t = green[r.randrange(len(green))]
            else:
                t = dirt[r.randrange(len(dirt))]
            im.put(x, y, t)
    return im


def dirt_path_top(tones, seed: int):
    im = Img()
    r = rng(seed)
    for y in range(16):
        for x in range(16):
            v = r.random()
            t = tones[0] if v < 0.6 else tones[1] if v < 0.9 else tones[-1]
            im.put(x, y, t)
    for _ in range(9):
        x, y = r.randrange(16), r.randrange(16)
        im.put(x, y, tones[-1])
    return im


def leaves(tones, seed: int, holes=0.05, flowers=None):
    """Solid leaf mass: base tone + darker speckle + a few gaps (MC 'fancy' look)."""
    im = Img()
    r = rng(seed)
    dark = tuple(max(0, int(c * 0.62)) for c in tones[0][:3]) + (tones[0][3],)
    for y in range(16):
        for x in range(16):
            if r.random() < holes:
                continue
            v = r.random()
            t = tones[0] if v < 0.55 else dark if v < 0.8 else tones[1] if len(tones) > 1 else tones[-1]
            im.put(x, y, t)
    if flowers:
        for _ in range(flowers[1]):
            x, y = r.randrange(1, 15), r.randrange(1, 15)
            im.put(x, y, flowers[0])
            if r.random() < 0.5:
                im.put(x + (1 if r.random() < 0.5 else -1), y, flowers[0])
    return im


def glass(seed: int):
    """Border streaks + diagonal glint."""
    im = Img()
    frame = C('#d0eae9')
    shade = C('#a8d0d9')
    for x in range(16):
        im.put(x, 0, frame if x < 15 else shade)
        im.put(x, 15, shade)
        im.put(0, x, frame if x < 15 else shade)
        im.put(15, x, shade)
    for i in range(8):
        im.put(2 + i, 9 - i, frame)
        im.put(5 + i, 13 - i, frame)
    return im


def bookshelf(seed: int):
    im = Img()
    r = rng(seed)
    plank = C('#b8945f')
    plank_d = C('#7e6237')
    spine_cols = [C('#8f2b21'), C('#3b5e2b'), C('#2b4a8f'), C('#7a5a1e'), C('#e0d6bd'), C('#4a2b6e'), C('#6e2b2b')]
    for y in range(16):
        for x in range(16):
            if y in (0, 7, 8, 15):
                im.put(x, y, plank if r.random() < 0.8 else plank_d)
            elif y in (1, 9):
                im.put(x, y, plank)
            else:
                if r.random() < 0.08:
                    im.put(x, y, plank_d)
                else:
                    h = 4 + (1 if r.random() < 0.3 else 0)
                    row = y in range(2, 7) and y - 2 < h or y in range(10, 15) and y - 10 < h
                    im.put(x, y, spine_cols[x % len(spine_cols)] if row else C('#362a15'))
    return im


def lantern(seed: int):
    im = Img()
    frame = C('#252c3d')
    frame2 = C('#3e4453')
    lit = C('#f9c966')
    lit2 = C('#f09149')
    r = rng(seed)
    # top cap
    for x in range(6, 10):
        im.put(x, 0, frame2)
        im.put(x, 1, frame)
    for x in range(5, 11):
        im.put(x, 2, frame)
    # body
    for y in range(3, 13):
        for x in range(3, 13):
            if x in (3, 12) or y in (3, 12):
                im.put(x, y, frame if (x + y) % 3 else frame2)
            else:
                t = lit if r.random() < 0.7 else lit2
                if x in (4, 11) or y in (4, 11):
                    t = frame2 if r.random() < 0.4 else lit2
                im.put(x, y, t)
    for x in range(4, 12):
        im.put(x, 13, frame2)
        im.put(x, 14, frame)
    return im


def chain(seed: int):
    im = Img()
    a = C('#39404d')
    b = C('#272d38')
    pat = [
        '  ab  ab  ',
        ' a      a ',
        ' b      b ',
        'a        a',
        'ab      ba',
        ' a      a ',
        '  ab  ab  ',
        ' b      b ',
        'a        a',
        'ab      ba',
        ' a      a ',
        '  ab  ab  ',
        ' b      b ',
        'a        a',
        'ab      ba',
        ' a      a ',
    ]
    for y, row in enumerate(pat):
        for x, ch in enumerate(row[:16]):
            if ch == 'a':
                im.put(x, y, a)
            elif ch == 'b':
                im.put(x, y, b)
    return im


def candle(seed: int, n=4, lit=True):
    im = Img()
    wax = C('#e8d8b0')
    wax_d = C('#c8b380')
    flame = C('#ffd75e')
    flame2 = C('#f09149')
    xs = {1: [8], 2: [5, 11], 3: [3, 8, 13], 4: [2, 6, 10, 14]}[n]
    hs = [7, 5, 8, 6]
    for i, cx in enumerate(xs):
        h = hs[i % len(hs)]
        for y in range(16 - h, 16):
            for dx in (-1, 0):
                im.put(cx + dx, y, wax if y < 15 else wax_d)
        im.put(cx, 15, wax_d)
        if lit:
            fy = 15 - h
            im.put(cx, fy - 1, flame)
            im.put(cx, fy - 2, flame2 if h % 2 else flame)
    return im


def trapdoor(planks_t, seam, seed: int):
    im = planks(planks_t, seam, seed)
    frame = seam
    for x in range(16):
        im.put(x, 0, frame)
        im.put(x, 15, frame)
        im.put(0, x, frame)
        im.put(15, x, frame)
    for x in range(6, 10):
        for y in range(7, 9):
            im.put(x, y, frame)
    return im


def blade_im(seed: int, height, tones, base_y=15, spread=3):
    im = Img()
    r = rng(seed)
    cx = 8
    for _ in range(6):
        x = cx + r.randrange(-spread, spread + 1)
        h = height + r.randrange(-2, 3)
        dx = r.choice([-2, -1, 0, 1, 2])
        for i in range(h):
            y = base_y - i
            xx = x + (i * dx // max(1, h))
            t = tones[0] if r.random() < 0.7 else tones[min(1, len(tones) - 1)]
            im.put(xx, y, t)
            if r.random() < 0.3:
                im.put(xx + 1, y, t)
    return im


def flower_head(im, x, y, petal, center=None, kind='cross'):
    if kind == 'cross':
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            im.put(x + dx, y + dy, petal)
        im.put(x, y, center or petal)
    elif kind == 'ball':
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if abs(dx) + abs(dy) < 3:
                    im.put(x + dx, y + dy, petal)
    elif kind == 'dots':
        for dx, dy in [(0, 0), (2, 1), (-2, 0), (1, 2), (-1, 2)]:
            im.put(x + dx, y + dy, petal)


def flower(seed: int, stem, petal, center=None, hy=6, kind='cross', two_heads=False):
    im = Img()
    r = rng(seed)
    leaf = stem
    for y in range(hy + 1, 16):
        im.put(8, y, stem)
        if r.random() < 0.5:
            im.put(9, y, stem)
    im.put(7, 12, leaf)
    im.put(6, 11, leaf)
    im.put(9, 10, leaf)
    flower_head(im, 8, hy, petal, center, kind)
    if two_heads:
        flower_head(im, 5, hy + 4, petal, center, kind)
        for y in range(hy + 4, 16):
            im.put(5, y, stem)
    return im


def bush_im(seed: int, tones, flowers=None):
    im = Img()
    r = rng(seed)
    for y in range(4, 16):
        for x in range(2, 14):
            if abs(x - 8) + abs(y - 10) < 9 and r.random() < 0.8:
                t = tones[0] if r.random() < 0.6 else tones[1]
                im.put(x, y, t)
    if flowers:
        for _ in range(6):
            x, y = 3 + r.randrange(10), 5 + r.randrange(9)
            im.put(x, y, flowers[0])
    return im


def bedcover(seed: int, petals, leaf):
    im = Img()
    r = rng(seed)
    clusters = [(4, 4), (11, 5), (6, 10), (12, 12), (3, 13)]
    for cx, cy in clusters:
        for dx, dy in [(0, 0), (1, 0), (0, 1), (-1, 0), (0, -1)]:
            if r.random() < 0.8:
                im.put(cx + dx, cy + dy, petals[r.randrange(len(petals))])
        im.put(cx, cy, petals[0])
        if r.random() < 0.5:
            im.put(cx, cy + 1, leaf)
    return im


def barrel_side(seed: int):
    im = Img()
    r = rng(seed)
    stave = C('#7a5532')
    stave_d = C('#5d3f24')
    hoop = C('#3f3a34')
    for y in range(16):
        for x in range(16):
            if y in (0, 1, 14, 15):
                im.put(x, y, hoop if r.random() < 0.8 else C('#4a4a4a'))
            else:
                t = stave if x % 4 else stave_d
                if r.random() < 0.12:
                    t = stave_d
                im.put(x, y, t)
    return im


def barrel_top(seed: int):
    im = Img()
    rim = C('#4a3a28')
    top = C('#8a6238')
    r = rng(seed)
    for y in range(16):
        for x in range(16):
            if x in (0, 15) or y in (0, 15):
                im.put(x, y, rim)
            else:
                t = top
                if (x + y) % 4 == 0:
                    t = C('#8b6238')
                if r.random() < 0.08:
                    t = rim
                im.put(x, y, t)
    for cx in (4, 11):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                im.put(cx + dx, 7 + dy, rim)
    return im


def glowstone(seed: int):
    im = Img()
    r = rng(seed)
    base = C('#c89a5a')
    hi = C('#dcb878')
    lo = C('#96703a')
    for y in range(16):
        for x in range(16):
            v = r.random()
            t = hi if v < 0.4 else base if v < 0.85 else lo
            im.put(x, y, t)
    for _ in range(4):
        x, y = r.randrange(2, 14), r.randrange(2, 14)
        im.put(x, y, lo)
        im.put(x + 1, y, lo)
    return im


def water(seed: int):
    im = Img()
    r = rng(seed)
    a = (59, 115, 200, 210)
    b = (45, 95, 175, 210)
    c = (80, 140, 215, 210)
    for y in range(16):
        for x in range(16):
            v = r.random()
            t = a if v < 0.75 else b if v < 0.9 else c
            im.put(x, y, t)
    return im


def campfire(seed: int):
    im = Img()
    logc = C('#6b4a2a')
    logd = C('#523a20')
    fire = C('#f09149')
    fire2 = C('#ffd75e')
    r = rng(seed)
    for x in range(16):
        for y in (12, 13, 14, 15):
            im.put(x, y, logc if (x + y) % 3 else logd)
    for y in range(4, 12):
        for x in range(4, 12):
            if abs(x - 8) < (12 - y) // 2 + 1 and r.random() < 0.85:
                im.put(x, y, fire if r.random() < 0.6 else fire2)
    return im


def lectern(seed: int):
    im = Img()
    wood = C('#8a6238')
    wood_d = C('#6b4a2a')
    page = C('#e8e0c8')
    ink = C('#3a2f1e')
    for x in range(16):
        for y in range(16):
            if y < 3 and x > y * 2 - 2:
                im.put(x, y, page if (x // 2) % 2 else ink)
            elif 3 <= y < 6:
                im.put(x, y, wood if x % 4 else wood_d)
            elif 6 <= y < 9 and x in (7, 8):
                im.put(x, y, wood_d)
            elif y >= 9 and y < 11 and 3 <= x <= 12:
                im.put(x, y, wood)
            elif y == 11 and 5 <= x <= 10:
                im.put(x, y, wood_d)
    return im


def brewing(seed: int):
    im = Img()
    rod = C('#7a5a1e')
    base = C('#4a4a4a')
    glass_c = C('#9ac1c9')
    for y in range(0, 10):
        im.put(8, y, rod)
    for x in range(3, 13):
        im.put(x, 10, base)
    for x in range(5, 11):
        for y in range(11, 15):
            im.put(x, y, glass_c if x in (5, 10) else rod)
    for x in range(4, 12):
        im.put(x, 15, base)
    return im


def copper_bulb(seed: int, lit=True):
    im = Img()
    frame = C('#a05a38')
    core = C('#e8a860') if lit else C('#7a4a38')
    hi = C('#f0c88e') if lit else C('#965844')
    r = rng(seed)
    for y in range(16):
        for x in range(16):
            if x in (0, 15) or y in (0, 15) or x in (3, 12) or y in (3, 12):
                im.put(x, y, frame)
            else:
                t = core if r.random() < 0.8 else hi
                im.put(x, y, t)
    return im


def cut_copper(seed: int):
    """Weathered cut copper: salmon-brick 2x2 tiles — real texture ~(191,106,80)."""
    im = Img()
    frame = C('#a85f48')
    tile = C('#b2684e')
    hi = C('#c47c5c')
    lo = C('#7e4834')
    r = rng(seed)
    for y in range(16):
        for x in range(16):
            if x % 8 == 0 or y % 8 == 0:
                im.put(x, y, lo)
            else:
                q = r.random()
                t = tile if q < 0.72 else (hi if q < 0.9 else frame)
                im.put(x, y, t)
    for x in range(4, 12):
        for y in range(4, 12):
            if x % 8 in (3, 4, 5, 6, 7) and y % 8 in (3, 4, 5, 6, 7):
                pass
    return im


def lightning_rod(seed: int):
    im = Img()
    rod = C('#8a4a34')
    tip = C('#b06a4a')
    for y in range(16):
        im.put(8, y, rod if y > 2 else tip)
        im.put(7, y, rod)
        if y in (9, 10):
            im.put(6, y, rod)
            im.put(9, y, rod)
    return im


def bell(seed: int):
    im = Img()
    metal = C('#c9a83f')
    metal_d = C('#9a7f2a')
    for y in range(6, 13):
        for x in range(4, 12):
            if y in (6, 12) or x in (4, 11):
                im.put(x, y, metal_d)
            else:
                im.put(x, y, metal)
    for x in range(6, 10):
        im.put(x, 4, metal_d)
        im.put(x, 5, metal)
    im.put(8, 13, metal_d)
    im.put(7, 14, metal)
    im.put(8, 14, metal)
    return im


def ladder_grate(seed: int, bar, bg):
    im = Img()
    for x in range(16):
        for y in range(16):
            if x % 4 == 0 or y % 4 == 0:
                im.put(x, y, bg)
            else:
                im.put(x, y, bar)
    return im


# ------------------------------------------------------------------ palettes
# Vanilla-accurate tone lists (sampled structure, re-rolled noise).

PAL = {
    'oak': [C('#8a6a38'), C('#b08c50'), C('#c29f61'), C('#d2b075')],
    'spruce': [C('#523a1c'), C('#6e4f2a'), C('#8a6838'), C('#9a7848')],
    'birch': [C('#a8996a'), C('#c2b078'), C('#d4c289'), C('#e2d29a')],
    'dark_oak': [C('#2c1a0c'), C('#41291a'), C('#4f3520'), C('#5d4028')],
    'pale_oak': [C('#c4b9ac'), C('#ddd4c8'), C('#ede6de'), C('#f8f3ec')],
    'dirt': [C('#5d3a22'), C('#7a4f2e'), C('#956a42'), C('#a87e52')],
    'stone': [C('#5a5a5a'), C('#707070'), C('#8c8c8c'), C('#a5a5a5')],
    'grass_top': [C('#5c8240'), C('#6f9a4d'), C('#83ad58'), C('#94bd68')],
    'grass_side_top': [C('#6f9a4d'), C('#83ad58')],
    'sand': [C('#cdb98a'), C('#e0cf9e'), C('#ecdcae'), C('#f4e8bc')],
    'gravel': [C('#5a5653'), C('#8a8482'), C('#a5a09e'), C('#c0bab6')],
    'mud': [C('#2e2a2e'), C('#423c40'), C('#565054'), C('#6a6468')],
    'moss': [C('#4a6624'), C('#5f8034'), C('#749645'), C('#8aa855')],
    'mortar': [C('#9c9c9c'), C('#b0b0b0'), C('#c4c4c4')],
    'brick': [C('#8a5040'), C('#a86450'), C('#b87860'), C('#c88a72')],
    'mud_brick': [C('#6e4a36'), C('#8a5f46'), C('#a07055'), C('#af8064')],
    'wool_white': [C('#dcdcdc'), C('#ececec'), C('#f4f4f4')],
    'wool_brown': [C('#5a3a22'), C('#6e4a2e'), C('#825a3a'), C('#926842')],
    'wool_gray': [C('#8f8f88'), C('#a3a39c'), C('#b6b6ae')],
    'copper': [C('#a2593a'), C('#b56b44'), C('#c57a52'), C('#cf8a64')],
    'log_oak': [C('#4a3120'), C('#5d4023'), C('#6e5230')],
    'log_dark': [C('#1e1209'), C('#2c1a0d'), C('#3d2915'), C('#4a3319')],
    'log_spruce': [C('#241305'), C('#3a2311'), C('#4a3018')],
    'log_birch': [C('#d8d0c0'), C('#efe8d8'), C('#30291f')],
    'log_cherry': [C('#3c1c1c'), C('#542a26'), C('#6e3a34')],
    'stripped_dark': [C('#2e1f10'), C('#3f2c18'), C('#4e3a20')],
    'ring_oak': [C('#4a3120'), C('#b8945f'), C('#9f844d')],
    'ring_dark': [C('#1a1108'), C('#5a4528'), C('#4a3319')],
    'ring_birch': [C('#30291f'), C('#d8d0c0'), C('#c8bfa8')],
    'ring_spruce': [C('#241305'), C('#6e5230'), C('#5d4023')],
    'ring_cherry': [C('#3c1c1c'), C('#8a5a50'), C('#7a4a42')],
    'leaves_oak': [C('#2e5e1e'), C('#3d7230'), C('#4a8a3a')],
    'leaves_birch': [C('#4a7230'), C('#5e8f3a'), C('#6fa548')],
    'leaves_spruce': [C('#2a4a2a'), C('#3a5e3a'), C('#4a7048')],
    'leaves_azalea': [C('#3d6234'), C('#4f7a42'), C('#619552')],
    'leaves_cherry': [C('#c98fb5'), C('#e0a8cc'), C('#f0c4e0')],
    'leaves_poplar_y': [C('#b8943a'), C('#d4a84a'), C('#e8c45e')],
    'leaves_poplar_o': [C('#a86428'), C('#c88038'), C('#e09a48')],
    'stem': [C('#5a8040'), C('#6e9c4e'), C('#7fb45c')],
    'tulip_white': [C('#e8e8e8'), C('#f5f5f5')],
    'poppy': [C('#a81e1e'), C('#cc2b2b'), C('#e84040')],
    'dandelion': [C('#e8c42a'), C('#f5d94a'), C('#fce86a')],
    'cornflower': [C('#4a68c8'), C('#5a7ee0'), C('#6f96f5')],
    'daisy': [C('#e8e8e8'), C('#f8f8f8')],
    'allium': [C('#8f5ac8'), C('#a86ee0'), C('#c488f5')],
    'lilac': [C('#b88fd0'), C('#d0a8e0'), C('#e0c0f0')],
    'peony': [C('#d88fa8'), C('#e8a8c0'), C('#f5c4d4')],
    'rose': [C('#a81e2a'), C('#cc2b38'), C('#e84050')],
    'pink': [C('#f5a8c0'), C('#f8c0d4'), C('#fcd8e4')],
    'white_petal': [C('#f0f0e8'), C('#f8f8f0')],
    'yellow_petal': [C('#e8d85a'), C('#f5ea7a')],
    'leaf_litter_c': [C('#4a3a20'), C('#5d4a2a'), C('#6e5838')],
    'lilypad': [C('#3a6e2a'), C('#4a8a3a')],
    'azalea_flower': [C('#d478b8'), C('#e89ccc')],
}

def build():
    OUT.mkdir(parents=True, exist_ok=True)
    out = {}

    # terrain
    out['stone'] = noise(Img(), PAL['stone'], 11).im if False else None

    def save(name, im: Img):
        im.im.save(OUT / f'{name}.png')
        out[name] = im

    n = lambda tones, seed, jit=1: _noise_img(tones, seed, jit)

    def _noise_img(tones, seed, jit):
        im = Img(); noise(im, tones, seed, jit); return im

    save('stone', n(PAL['stone'], 11))
    save('dirt', n(PAL['dirt'], 12, 2))
    save('sand', n(PAL['sand'], 13))
    save('gravel', n(PAL['gravel'], 14, 2))
    save('mud', n(PAL['mud'], 15))
    save('moss', n(PAL['moss'], 16))
    save('moss_block', n(PAL['moss'], 16))
    save('grass_top', grass_top(PAL['grass_top'], 17))
    save('grass_side', grass_side(PAL['dirt'], PAL['grass_side_top'], 18))
    save('dirt_path', dirt_path_top([C('#7a5c34'), C('#907540'), C('#aa8d4a'), C('#5d4a28')], 19))
    save('dirt_path_side', grass_side(PAL['dirt'], PAL['dirt'][-1:], 20))
    save('dirt_path_top', out['dirt_path'])
    save('podzol_top', dirt_path_top([C('#54351a'), C('#6e4d24'), C('#7a5a2e')], 21))
    save('farmland', n(PAL['dirt'], 22, 2))
    save('andesite', n([C('#7f7f7f'), C('#969696'), C('#ababab')], 23))
    save('smooth_stone', n([C('#9a9a9a'), C('#a8a8a8'), C('#b8b8b8')], 24))
    save('coarse_dirt', n([C('#6a4526'), C('#805631'), C('#97683e'), C('#a87b4d')], 25, 2))
    save('rooted_dirt', n(PAL['dirt'], 26, 2))
    save('water', water(27))
    save('seagrass', blade_im(28, 10, [C('#3a6e4a'), C('#4a8a5a')]))

    # wood
    save('oak_planks', planks(PAL['oak'][1:], PAL['oak'][0], 30))
    save('spruce_planks', planks(PAL['spruce'][1:], PAL['spruce'][0], 31))
    save('birch_planks', planks(PAL['birch'][1:], PAL['birch'][0], 32))
    save('dark_oak_planks', planks(PAL['dark_oak'][1:], PAL['dark_oak'][0], 33))
    save('pale_oak_planks', planks(PAL['pale_oak'][1:], PAL['pale_oak'][0], 34))
    save('oak_log', log_side(C('#745a36'), C('#5f4a2b'), C('#917142'), 40))
    save('oak_log_top', log_top(C('#5f4a2b'), C('#af8f55'), C('#967441'), C('#b8945f'), 41))
    save('spruce_log', log_side(C('#3b2713'), C('#2e1c0a'), C('#4d3317'), 42))
    save('spruce_log_top', log_top(C('#311e0b'), C('#7a5a34'), C('#614b2e'), C('#82613a'), 43))
    save('birch_log', birch_side(44))
    save('birch_log_top', log_top(C('#54401e'), C('#c8b77a'), C('#ae9f76'), C('#d7c185'), 45))
    save('dark_oak_log', log_side(C('#3f311d'), C('#302513'), C('#4a381e'), 46))
    save('dark_oak_log_top', log_top(C('#302513'), C('#4f3218'), C('#3a2411'), C('#492f17'), 47))
    save('cherry_log', log_side(C('#301d29'), C('#271620'), C('#462c39'), 48))
    save('cherry_log_top', log_top(C('#3b232d'), C('#e6b5ad'), C('#dd9d97'), C('#e7beb4'), 49))
    save('stripped_dark_oak_log', stripped_side(C('#453623'), C('#523f27'), C('#3b3020'), 50))
    save('stripped_dark_oak_log_top', log_top(C('#302513'), C('#4f3218'), C('#3a2411'), C('#492f17'), 51))
    save('stripped_spruce_log', stripped_side(C('#4d3317'), C('#5e4123'), C('#311e0b'), 52))
    save('stripped_spruce_log_top', log_top(C('#311e0b'), C('#7a5a34'), C('#614b2e'), C('#82613a'), 53))
    save('poplar_log', stripped_side(C('#8a8078'), C('#a89e94'), C('#6e665e'), 54))
    save('poplar_log_top', log_top(C('#6e665e'), C('#c9c0b4'), C('#a89e94'), C('#d4ccc0'), 55))

    # masonry
    save('bricks', brick(PAL['brick'][1], PAL['mortar'][1], PAL['brick'][3], 60))
    save('stone_bricks', stone_bricks([PAL['stone'][3], PAL['stone'][2], PAL['stone'][1], PAL['stone'][0]], None, 61))
    save('mossy_stone_bricks', stone_bricks([PAL['stone'][3], PAL['stone'][2], PAL['moss'][2], PAL['stone'][0]], None, 62))
    save('cobblestone', cobble(PAL['stone'][1:], PAL['stone'][0], 63))
    save('mossy_cobblestone', cobble(PAL['stone'][1:], PAL['stone'][0], 64, PAL['moss'][:2]))
    save('mossy_cobble', cobble(PAL['stone'][1:], PAL['stone'][0], 64, PAL['moss'][:2]))
    save('mud_bricks', brick(PAL['mud_brick'][1], PAL['mud_brick'][0], PAL['mud_brick'][2], 65))
    save('mangrove_roots_side', n([C('#4a3018'), C('#5d4020'), C('#6e4f2a')], 66, 2))

    # fabric
    save('wool_white', n(PAL['wool_white'], 70))
    save('wool_brown', n(PAL['wool_brown'], 71))
    save('wool_light_gray', n(PAL['wool_gray'], 72))
    save('white_wool', n(PAL['wool_white'], 70))
    save('brown_wool', n(PAL['wool_brown'], 71))
    save('light_gray_wool', n(PAL['wool_gray'], 72))
    save('white_concrete', n([C('#cfd5d8'), C('#dee3e6'), C('#c5cbcf')], 73))
    save('carpet_white', n(PAL['wool_white'], 74))
    save('carpet_brown', n(PAL['wool_brown'], 75))
    save('carpet_light_gray', n(PAL['wool_gray'], 76))

    # functional
    save('glass', glass(80))
    save('bookshelf', bookshelf(81))
    save('chiseled_bookshelf', _chiseled())
    save('chiseled_bookshelf_side', planks(PAL['pale_oak'][1:], PAL['pale_oak'][0], 82))
    save('barrel_side', barrel_side(83))
    save('barrel_top', barrel_top(84))
    save('lectern', lectern(85))
    save('lectern_front', lectern(85))
    save('brewing_stand', brewing(86))
    save('lantern', lantern(87))
    save('iron_chain', chain(88))
    save('chain', chain(88))
    save('copper_chain', chain(89))
    save('candle', candle(90, 4, True))
    save('candle_lit', candle(90, 4, True))
    save('bell', bell(91))
    save('copper_bulb', copper_bulb(92, lit=False))
    save('copper_bulb_lit', copper_bulb(92, lit=True))
    save('copper_rod', lightning_rod(93))
    save('lightning_rod_on', lightning_rod(93))
    save('copper_block', n(PAL['copper'], 94))
    save('cut_copper', cut_copper(95))
    save('copper_grate', ladder_grate(96, C('#b06040'), C('#5f3020')))
    save('campfire', campfire(97))
    save('campfire_log', campfire(97))
    save('glowstone', glowstone(98))
    save('shroomlight', n([C('#e08a44'), C('#f09a50'), C('#f8aa5e')], 99))
    save('sea_lantern', n([C('#b8d8cc'), C('#cce0d6'), C('#a0c4ba')], 100))
    save('redstone_lamp_on', n([C('#96683c'), C('#a87848'), C('#ba8a54')], 101))
    save('spruce_trapdoor', trapdoor(PAL['spruce'][1:], PAL['spruce'][0], 102))
    save('oak_trapdoor', trapdoor(PAL['oak'][1:], PAL['oak'][0], 103))
    save('dark_oak_trapdoor', trapdoor(PAL['dark_oak'][1:], PAL['dark_oak'][0], 104))
    save('spruce_fence', planks(PAL['spruce'][1:], PAL['spruce'][0], 105))
    save('oak_fence', planks(PAL['oak'][1:], PAL['oak'][0], 106))

    # leaves
    save('oak_leaves', leaves(PAL['leaves_oak'], 110))
    save('birch_leaves', leaves(PAL['leaves_birch'], 111))
    save('spruce_leaves', leaves(PAL['leaves_spruce'], 112))
    save('azalea_leaves', leaves(PAL['leaves_azalea'], 113))
    save('flowering_azalea_leaves', leaves(PAL['leaves_azalea'], 114, 0.28, (PAL['azalea_flower'][1], 14)))
    save('cherry_leaves', leaves(PAL['leaves_cherry'], 115))
    save('yellow_poplar_leaves', leaves(PAL['leaves_poplar_y'], 116))
    save('orange_poplar_leaves', leaves(PAL['leaves_poplar_o'], 117))
    save('bush', leaves(PAL['leaves_azalea'], 118, 0.15))
    save('azalea_plant', bush_im(119, PAL['leaves_azalea']))
    save('flowering_azalea_plant', bush_im(120, PAL['leaves_azalea'], PAL['azalea_flower']))
    save('azalea_side', bush_im(121, PAL['leaves_azalea']))
    save('azalea_top', bush_im(122, PAL['leaves_azalea']))
    save('flowering_azalea_side', bush_im(123, PAL['leaves_azalea'], PAL['azalea_flower']))
    save('flowering_azalea_top', bush_im(124, PAL['leaves_azalea'], PAL['azalea_flower']))
    save('leaf_litter', bedcover(125, PAL['leaf_litter_c'], C('#3a5e2a')))

    # vegetation
    save('short_grass', blade_im(130, 8, PAL['stem'], 15, 4))
    save('grass', blade_im(130, 8, PAL['stem'], 15, 4))
    save('tall_grass', blade_im(131, 13, PAL['stem'], 15, 4))
    save('tall_grass_top', blade_im(131, 13, PAL['stem'], 15, 4))
    save('tall_grass_bottom', blade_im(131, 13, PAL['stem'], 15, 4))
    save('fern', blade_im(132, 11, [C('#3d6e33'), C('#4f8a44')], 15, 5))
    save('large_fern', blade_im(133, 15, [C('#3d6e33'), C('#4f8a44')], 15, 5))
    save('large_fern_top', blade_im(133, 15, [C('#3d6e33'), C('#4f8a44')], 15, 5))
    save('large_fern_bottom', blade_im(133, 15, [C('#3d6e33'), C('#4f8a44')], 15, 5))
    save('potted_fern', blade_im(134, 9, [C('#3d6e33'), C('#4f8a44')], 15, 3))

    # flowers
    save('poppy', flower(140, PAL['stem'][0], PAL['poppy'][1], C('#3a2a1a'), 5, 'cross'))
    save('dandelion', flower(141, PAL['stem'][0], PAL['dandelion'][1], PAL['dandelion'][0], 5, 'ball'))
    save('cornflower', flower(142, PAL['stem'][0], PAL['cornflower'][1], PAL['cornflower'][0], 5, 'dots'))
    save('oxeye_daisy', flower(143, PAL['stem'][0], PAL['daisy'][1], PAL['dandelion'][0], 5, 'cross'))
    save('azure_bluet', flower(144, PAL['stem'][0], PAL['daisy'][0], PAL['dandelion'][0], 6, 'dots'))
    save('lily_of_the_valley', flower(145, PAL['stem'][0], PAL['daisy'][0], PAL['daisy'][0], 4, 'dots'))
    save('allium', flower(146, PAL['stem'][0], PAL['allium'][1], PAL['allium'][0], 4, 'ball'))
    save('lilac', flower(147, PAL['stem'][0], PAL['lilac'][1], PAL['lilac'][0], 4, 'dots', True))
    save('lilac_top', flower(147, PAL['stem'][0], PAL['lilac'][1], PAL['lilac'][0], 4, 'dots', True))
    save('lilac_bottom', flower(147, PAL['stem'][0], PAL['lilac'][1], PAL['lilac'][0], 4, 'dots', True))
    save('peony', flower(148, PAL['stem'][0], PAL['peony'][1], PAL['peony'][0], 4, 'dots', True))
    save('peony_top', flower(148, PAL['stem'][0], PAL['peony'][1], PAL['peony'][0], 4, 'dots', True))
    save('peony_bottom', flower(148, PAL['stem'][0], PAL['peony'][1], PAL['peony'][0], 4, 'dots', True))
    save('rose_bush', bush_im(149, PAL['stem'], PAL['rose']))
    save('rose_bush_top', bush_im(149, PAL['stem'], PAL['rose']))
    save('rose_bush_bottom', bush_im(149, PAL['stem'], PAL['rose']))
    save('pink_petals', bedcover(150, PAL['pink'], PAL['stem'][0]))
    save('wildflowers', bedcover(151, PAL['white_petal'] + PAL['yellow_petal'], PAL['stem'][0]))
    save('firefly_bush', bush_im(152, [C('#2a4a2a'), C('#3a5e3a')], [C('#e8d85a')]))
    save('firefly_bush_emissive', bedcover(153, [C('#f5ea7a'), C('#e8d85a'), C('#fdf6c0')], (0, 0, 0, 0)))
    save('lily_pad', _lilypad())

    print(f'wrote {len(out)} textures -> {OUT}')


def _chiseled():
    im = Img()
    r = rng(88)
    frame = C('#a89e94')
    dark = C('#6e665e')
    wood = C('#8a8078')
    for y in range(16):
        for x in range(16):
            if x in (0, 15) or y in (0, 15):
                im.put(x, y, dark)
            elif (x % 5 == 0) or (y % 5 == 0):
                im.put(x, y, frame)
            else:
                t = wood if r.random() < 0.85 else frame
                im.put(x, y, t)
    return im


def _lilypad():
    im = Img()
    pad = C('#3a6e2a')
    pad2 = C('#4a8a3a')
    r = rng(154)
    for y in range(3, 15):
        for x in range(3, 15):
            if abs(x - 8) + abs(y - 8) < 9:
                t = pad if r.random() < 0.7 else pad2
                im.put(x, y, t)
    # notch
    for d in range(5):
        im.put(8 + d, 8 - d + 1, (0, 0, 0, 0))
        im.put(8 + d, 8 - d, (0, 0, 0, 0))
    return im


def sheet():
    imgs = sorted(OUT.glob('*.png'))
    cols = 8
    rows = (len(imgs) + cols - 1) // cols
    s = Image.new('RGBA', (cols * 34, rows * 34 + 8), (20, 20, 28, 255))
    for i, p in enumerate(imgs):
        im = Image.open(p).convert('RGBA').resize((32, 32), Image.NEAREST)
        s.paste(im, ((i % cols) * 34 + 1, (i // cols) * 34 + 1), im)
    sheet = Path(tempfile.gettempdir()) / 'mc' / 'sheet.png'
    sheet.parent.mkdir(parents=True, exist_ok=True)
    s.save(sheet)
    print(f'sheet -> {sheet}')


if __name__ == '__main__':
    build()
    if '--sheet' in sys.argv:
        sheet()
