"""Synthesized score for the Twitter cut: 118 BPM, Am-F-C-G, four-on-the-floor with sidechained
saw chords, a riser into the first drop, impacts on cuts, a clean ending.

usage: score.py out.wav plan.json
plan: {"duration": s, "drop": s, "hits": [s, ...], "stop": s}  (times already on the beat grid)
"""
import json, sys
import numpy as np

SR = 48000
BPM = 118
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

# Am - F - C - G, root + triad voicing (Hz)
PROG = [
    (110.00, [220.00, 261.63, 329.63, 440.00]),
    (87.31, [174.61, 220.00, 261.63, 349.23]),
    (130.81, [196.00, 261.63, 329.63, 392.00]),
    (98.00, [196.00, 246.94, 293.66, 392.00]),
]


def saw(freq, t, harmonics=14):
    out = np.zeros_like(t)
    for k in range(1, harmonics + 1):
        out += np.sin(2 * np.pi * freq * k * t) / k * (0.92 ** k)
    return out


def env_ar(n, attack, release):
    a = max(1, int(attack * SR)); e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    return e * np.exp(-np.arange(n) / SR / release)


def place(buf, at, sig, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def smooth(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def kick():
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22) + 0.3 * np.sin(2 * np.pi * 3000 * t) * np.exp(-t / 0.003)


def clap():
    n = int(0.25 * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n); band = smooth(noise, 6) - smooth(noise, 40)
    e = np.exp(-t / 0.09) * (1 + 0.6 * (np.sin(2 * np.pi * 90 * t) > 0) * (t < 0.03))
    return band * e * 1.6


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n); hp = noise - smooth(noise, 4)
    return hp * np.exp(-t / (0.06 if open_ else 0.012)) * 0.5


def impact():
    n = int(2.2 * SR); t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.7)
    noise = rng.standard_normal(n); air = (noise - smooth(noise, 3)) * np.exp(-t / 0.25) * 0.1
    return boom + air


def riser(secs):
    n = int(secs * SR); t = np.arange(n) / SR; p = t / secs
    noise = rng.standard_normal(n)
    swept = noise - smooth(noise, 3) * (1 - p) - smooth(noise, 30) * p * 0.3
    tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (p * 2)) / SR) * 0.25
    return (swept * 0.14 + tone) * p ** 3


def render(duration, drop, hits, stop):
    n = int((duration + 2.5) * SR); t = np.arange(n) / SR
    L = np.zeros(n); R = np.zeros(n); drums = np.zeros(n); side = np.ones(n)

    # Intro: filtered chords only (few harmonics), swelling into the drop.
    # Groove: drop -> stop. Ending: one sustained Am chord.
    bar0 = drop - np.ceil(drop / BAR) * BAR
    beats = np.arange(bar0, stop, BEAT)
    for i, b in enumerate(beats):
        if b < drop - 1e-6:
            continue
        place(drums, b, kick(), 0.9)
        k = int(b * SR); m = min(n, k + int(0.3 * SR))
        side[k:m] = np.minimum(side[k:m], 1 - 0.55 * np.exp(-np.arange(m - k) / SR / 0.11))
        beat_in_bar = int(round((b - bar0) / BEAT)) % 4
        if beat_in_bar in (1, 3):
            place(drums, b, clap(), 0.45)
        for s in range(4):
            place(drums, b + s * BEAT / 4, hat(open_=(s == 2)), (0.5, 0.25, 0.7, 0.3)[s])

    # chords + bass per bar
    bar_start = bar0
    idx = 0
    while bar_start < duration + 2:
        root, voicing = PROG[idx % 4]
        a = max(0.0, bar_start); b = min(duration + 2, bar_start + BAR)
        if b > a:
            i, j = int(a * SR), int(b * SR); tt = t[i:j]
            in_groove = drop <= a < stop
            harm = 14 if in_groove else 4
            pad = np.zeros(j - i); spread_l = np.zeros(j - i); spread_r = np.zeros(j - i)
            for f in voicing:
                for d, pan in ((-0.006, 0.8), (0.0, 0.5), (0.006, 0.2)):
                    v = saw(f * (1 + d), tt, harm)
                    spread_l += v * pan; spread_r += v * (1 - pan)
            e = env_ar(j - i, 0.05 if in_groove else 0.6, 6.0)
            gain = 0.075 if in_groove else 0.045 * min(1, max(0.2, a / max(drop, 0.1)))
            if a >= stop:
                gain = 0.05; e = env_ar(j - i, 0.02, 1.6)
            L[i:j] += spread_l * e * gain; R[i:j] += spread_r * e * gain
            if in_groove:
                for s in range(8):
                    p = a + s * BEAT / 2
                    if p >= b:
                        break
                    q = int(p * SR); r = min(j, q + int(BEAT / 2 * SR * 0.9)); u = np.arange(r - q) / SR
                    note = (np.sin(2 * np.pi * root * u) + 0.35 * np.sin(4 * np.pi * root * u)) * np.exp(-u / 0.25) * 0.32
                    L[q:r] += note; R[q:r] += note
        if bar_start >= stop:
            break
        bar_start += BAR; idx += 1

    L *= side; R *= side
    rs = riser(min(drop, 2 * BAR)) if drop > 0.5 else None
    if rs is not None:
        place(L, drop - len(rs) / SR, rs, 0.6); place(R, drop - len(rs) / SR, rs, 0.6)
    for h in [drop, *hits, stop]:
        place(drums, h, impact(), 0.55)
    L += drums; R += drums

    fade = np.ones(n); fe = int(duration * SR); fs = fe - int(2.0 * SR)
    fade[fs:fe] = np.linspace(1, 0, fe - fs); fade[fe:] = 0
    mix = np.stack([L, R], 1) * fade[:, None]
    mix /= max(1e-9, np.abs(mix).max())
    mix = np.tanh(mix * 1.3) / np.tanh(1.3) * 0.8
    return mix[: int(duration * SR)]


def write_wav(path, mix):
    import wave
    data = (np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)


if __name__ == "__main__":
    out, plan = sys.argv[1], json.load(open(sys.argv[2]))
    write_wav(out, render(plan["duration"], plan["drop"], plan.get("hits", []), plan["stop"]))
    print("score", out, plan["duration"], "s")
