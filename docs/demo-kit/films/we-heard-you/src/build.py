"""Generate index.html for "We heard you": footage cuts + camera from one scene table.

Times are on the 118 BPM bar grid. Each scene plays three footage segments from raw4 (the real app):
(a) the prompt being typed under the complaint card, (b) the build sped up, (c) the result at speed.
Segment (a) is fixed; (b) and (c) are sized here so every scene lands exactly on its bar line.
"""
import json
from pathlib import Path

BAR = 4 * 60 / 118
END = 24 * BAR
LOCKUP = 22 * BAR
FOOTAGE_END = 79.6

# id, start bar, bars, (a media start, a dur), (b media start, rate, media end), c media start, complaint, composer point (footage px)
SCENES = [
    ("vibe", 4, 3, (3.0, 2.0), (6.2, 3.0, 11.3), 11.3, "Every AI app looks exactly the same.", (1000, 645)),
    ("timer", 7, 3, (15.7, 2.0), (17.7, 2.5, 20.2), 21.3, "I just want it to do one thing.", (995, 1090)),
    ("remix", 10, 2, (28.6, 1.7), (30.3, 3.0, 33.3), 33.3, "Why do I need to learn an API to change anything?", (995, 1090)),
    ("flow", 12, 3, (38.0, 1.7), (39.7, 2.25, 41.5), 43.6, "AI charts are dead pictures. I can't change a thing.", (995, 1090)),
    ("spend", 15, 3, (50.8, 1.7), (52.5, 2.5, 55.9), 55.9, "I have no idea what this is costing me.", (995, 1090)),
    ("mission", 18, 4, (66.5, 1.7), (68.2, 2.5, 72.2), 72.2, "I can't see what my agents are doing.", (995, 1090)),
]

videos, table = [], []
for i, (sid, bar, bars, (am, ad), (bm, rate, bend), cm, text, point) in enumerate(SCENES):
    s = bar * BAR
    length = bars * BAR
    bd = (bend - bm) / rate
    # The last scene runs under the lockup until the footage ends; the rest fill their bars.
    cd = min(FOOTAGE_END - cm, END - (s + ad + bd)) if i == len(SCENES) - 1 else length - ad - bd
    assert cd > 0.5, (sid, cd)
    segs = [(s, ad, am, 1.0), (s + ad, bd, bm, rate), (s + ad + bd, cd, cm, 1.0)]
    for k, (start, dur, media, r) in enumerate(segs):
        rate_attr = f' data-playback-rate="{r:g}"' if r != 1.0 else ""
        videos.append(f'<video id="{sid}{"abc"[k]}" src="assets/app.mp4" data-start="{start:.3f}" data-duration="{dur:.3f}" '
                      f'data-media-start="{media:.3f}"{rate_attr} data-track-index="1" muted playsinline></video>')
    table.append({"id": sid, "s": round(s, 4), "len": round(length, 4), "b": round(s + ad, 4), "c": round(s + ad + bd, 4),
                  "cdur": round(cd, 4), "point": point})

cards = "\n".join(
    f'      <div class="cc" id="cc-{sid}"><div class="cc-tag">you said</div><div class="cc-text">{text}</div></div>'
    for sid, *_rest, text, _p in SCENES)

TEMPLATE = Path(__file__).with_name("index.template.html").read_text()
html = (TEMPLATE.replace("{{END}}", f"{END:.3f}").replace("{{LOCKUP}}", f"{LOCKUP:.3f}").replace("{{LOCKUP_DUR}}", f"{END - LOCKUP:.3f}")
        .replace("{{VIDEOS}}", "\n          ".join(videos)).replace("{{CARDS}}", cards).replace("{{SCENES}}", json.dumps(table)))
(Path(__file__).parent.parent / "index.html").write_text(html)
print(json.dumps(table, indent=0))
print("end", END, "lockup", LOCKUP)
