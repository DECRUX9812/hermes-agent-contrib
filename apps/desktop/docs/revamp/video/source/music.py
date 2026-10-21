"""Synthesized soundtrack for the Team Bots demo: 120 BPM, A minor (Am-F-C-G), cuts on bar
lines, the drop at 4.0s, UI foley on the on-screen events. Pure numpy, deterministic."""
import wave

import numpy as np

SR = 44100
DUR = 49.5
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)
duck = np.ones(N)  # sidechain gain for pad/bass/arp


def at(t):
    return int(t * SR)


def add(sig, t, gain=1.0, pan=0.0, bus=None):
    i = at(t)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
    (bus or (L, R))[0][i:i + len(sig)] += sig * l * 1.414
    (bus or (L, R))[1][i:i + len(sig)] += sig * r * 1.414


def tt(d):
    return np.arange(int(d * SR)) / SR


def onepole(x, cutoff):
    """One-pole lowpass; cutoff may be an array (sweep)."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def saw(f, t):
    return 2 * ((f * t) % 1.0) - 1


def fft_lp(x, cutoff):
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (fr / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


def fft_hp(x, cutoff):
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (cutoff / np.maximum(fr, 1)) ** 4)
    return np.fft.irfft(X, len(x))


# ── instruments ─────────────────────────────────────────────────────────────────────
def kick():
    t = tt(0.45)
    f = 48 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7)
    click = rng.standard_normal(len(t)) * np.exp(-t * 400) * 0.25
    return np.tanh((body + click) * 1.6)


def clap():
    t = tt(0.35)
    n = fft_hp(rng.standard_normal(len(t)), 900)
    env = np.exp(-t * 18) + 0.7 * np.exp(-np.maximum(t - 0.012, 0) * 40) * (t > 0.012) + 0.6 * np.exp(-np.maximum(t - 0.024, 0) * 30) * (t > 0.024)
    return n * env * 0.35


def hat(open_=False):
    t = tt(0.25 if open_ else 0.06)
    n = fft_hp(rng.standard_normal(len(t)), 7000)
    return n * np.exp(-t * (14 if open_ else 70)) * 0.35


def boom():
    t = tt(2.6)
    f = 32 + 60 * np.exp(-t * 6)
    b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.6)
    crash = fft_hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 2.2) * 0.35
    return np.tanh(b * 1.4) + crash


def riser(d):
    t = tt(d)
    p = t / d
    n = rng.standard_normal(len(t))
    y = onepole(n, 300 + 9000 * p ** 2) * (p ** 2.2)
    tone = np.sin(2 * np.pi * np.cumsum(200 + 1400 * p ** 2) / SR) * p ** 3 * 0.15
    return (y + tone) * 0.8


def whoosh(d=0.45):
    t = tt(d)
    p = t / d
    env = np.sin(np.pi * p) ** 2
    n = rng.standard_normal(len(t))
    return onepole(n, 600 + 5000 * np.sin(np.pi * p)) * env * 0.9


def pluck(f, d=0.28, bright=3200):
    t = tt(d)
    x = saw(f, t) * 0.6 + saw(f * 1.005, t) * 0.4
    return onepole(x, bright * np.exp(-t * 9) + 250) * np.exp(-t * 11)


def chime(fs, d=1.6):
    t = tt(d)
    y = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * (3 + i)) + 0.3 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t * 6) for i, f in enumerate(fs))
    return y * 0.22 * (1 - np.exp(-t * 400))


def pop(f=900):
    t = tt(0.12)
    return np.sin(2 * np.pi * np.cumsum(f * (1 + 1.5 * np.exp(-t * 40))) / SR) * np.exp(-t * 35) * 0.5


def err():
    t = tt(0.32)
    x = np.sign(np.sin(2 * np.pi * 146 * t)) * 0.5 + np.sign(np.sin(2 * np.pi * 155 * t)) * 0.5
    return onepole(x, 1800) * np.exp(-t * 7) * 0.35


def click():
    t = tt(0.05)
    return fft_hp(rng.standard_normal(len(t)), 2000) * np.exp(-t * 180) * 0.5 + np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 90) * 0.2


def glitch():
    t = tt(0.4)
    sq = np.sign(np.sin(2 * np.pi * (80 + 600 * (np.floor(t * 40) % 3)) * t))
    return onepole(sq * np.exp(-t * 8), 3000) * 0.35 + np.sin(2 * np.pi * 45 * t) * np.exp(-t * 9) * 0.8


# ── harmony ─────────────────────────────────────────────────────────────────────────
A2, C3, E3, F2, G2 = 110.0, 130.81, 164.81, 87.31, 98.0
CHORDS = [  # (bass root, pad voicing, arp tones)
    (55.0, [220.0, 261.63, 329.63, 440.0], [440.0, 523.25, 659.25, 880.0]),
    (43.65, [174.61, 220.0, 261.63, 349.23], [349.23, 440.0, 523.25, 698.46]),
    (65.41, [196.0, 261.63, 329.63, 392.0], [392.0, 523.25, 659.25, 783.99]),
    (49.0, [196.0, 246.94, 293.66, 392.0], [392.0, 493.88, 587.33, 783.99]),
]


def chord_at(t):
    return CHORDS[int(t // 2) % 4]


PAD_L = np.zeros(N)
PAD_R = np.zeros(N)
# pad: detuned saws per bar, heavy lowpass later
for bar in range(0, 24):
    t0 = bar * 2.0
    if t0 >= 48:
        break
    root, voic, _ = chord_at(t0)
    t = tt(2.08)
    env = np.minimum(1, t / 0.35) * np.minimum(1, (2.08 - t) / 0.12)
    sigL = sum(saw(f * 0.998, t) + saw(f * 1.003, t) for f in voic) * env
    sigR = sum(saw(f * 1.002, t) + saw(f * 0.997, t) for f in voic) * env
    i = at(t0)
    PAD_L[i:i + len(t)] += sigL[: N - i]
    PAD_R[i:i + len(t)] += sigR[: N - i]
PAD_L = fft_lp(PAD_L, 1400) * 0.05
PAD_R = fft_lp(PAD_R, 1400) * 0.05

BASS = np.zeros(N)
ARP = np.zeros(N)
KICKS = []
# ── arrangement ─────────────────────────────────────────────────────────────────────
for b in range(96):  # beats
    tb = b * BEAT
    root, voic, arp = chord_at(tb)
    main = 4.0 <= tb < 44.0
    # intro: soft hats from 2s
    if 2.0 <= tb < 4.0:
        add(hat(), tb + 0.25, 0.35)
    if main:
        drop_out = 37.0 <= tb < 38.0  # a one-bar breath before the montage
        if not drop_out:
            add(kick(), tb, 0.95)
            KICKS.append(tb)
        if b % 2 == 1 and not drop_out:
            add(clap(), tb, 0.8, 0.05)
        for k in range(2):
            add(hat(open_=(k == 1 and b % 2 == 1)), tb + k * 0.25, 0.4 if k else 0.28, 0.35)
        if tb >= 8.0:
            add(hat(), tb + 0.125, 0.14, -0.4)
            add(hat(), tb + 0.375, 0.14, -0.4)
        # bass: 8ths, octave bounce
        for k in range(2):
            t = tt(0.24)
            f = root * (2 if k == 1 else 1)
            x = saw(f, t) + 0.5 * np.sin(2 * np.pi * f * t)
            y = onepole(x, 520 * np.exp(-t * 6) + 180) * np.exp(-t * 4)
            i = at(tb + k * 0.25)
            BASS[i:i + len(y)] += y[: N - i]
        # arp from the org chart onward: 16ths
        if tb >= 8.0:
            for k in range(4):
                n = arp[(b * 4 + k) % 4 if (b // 4) % 2 == 0 else (3 - (b * 4 + k) % 4)]
                y = pluck(n, bright=2200 + 1800 * ((tb - 8) / 36))
                i = at(tb + k * 0.125)
                ARP[i:i + len(y)] += y[: N - i]

# sidechain from the kick hits
for k in KICKS:
    i = at(k)
    t = tt(0.3)
    d = 1 - 0.65 * np.exp(-t * 14)
    duck[i:i + len(t)] = np.minimum(duck[i:i + len(t)], d[: N - i])

L += PAD_L * duck + BASS * duck * 0.33 + ARP * duck * 0.10
R += PAD_R * duck + BASS * duck * 0.33 + ARP * duck * 0.10
# arp stereo shimmer
ARP_D = np.roll(ARP, int(0.1875 * SR)) * 0.05
L += ARP_D * duck
R -= ARP_D * duck * 0.3

# ── moments ─────────────────────────────────────────────────────────────────────────
add(chime([220.0, 329.63], 2.0), 0.15, 0.5)
add(glitch(), 1.35, 0.8)
add(riser(1.45), 2.55, 0.9)
add(boom(), 4.0, 1.0)
add(chime([440.0, 659.25, 880.0], 2.4), 4.05, 0.7)
for c in [8, 14, 20, 26, 30, 34, 38, 44]:
    add(whoosh(0.5), c - 0.4, 0.55)
add(riser(1.0), 37.0, 0.7)
for i, t0 in enumerate([8.45, 9.25, 9.4, 9.55, 10.05]):
    add(pop(700 + 120 * i), t0, 0.6, (-0.4, 0, 0.4, 0.2, -0.3)[i])
add(err(), 12.45, 0.9)
for i in range(4):
    add(pop(900 + 80 * i), 14.7 + i * 0.18, 0.4)
add(click(), 21.12, 0.9)
add(whoosh(0.7), 21.2, 0.5)
add(pop(1200), 22.0, 0.5)
add(pop(1000), 23.4, 0.4)
add(chime([659.25, 880.0, 1318.5]), 25.1, 0.8)
add(err(), 27.4, 0.8)
add(boom()[: at(0.5)] * np.linspace(1, 0, at(0.5)), 28.5, 0.5)
add(click(), 31.05, 0.9)
add(err(), 31.1, 0.9)
add(click(), 32.45, 0.9)
add(boom()[: at(0.4)] * np.linspace(1, 0, at(0.4)), 32.55, 0.45)
add(chime([523.25, 659.25, 783.99]), 32.6, 0.8)
for i in range(4):
    add(pop(1100 + 60 * i), 34.9 + i * 0.28, 0.35)
add(chime([880.0, 1108.7, 1318.5], 2.0), 36.55, 0.6)
add(boom(), 44.0, 1.0)
# outro: Am pad ringing out
t = tt(5.0)
out = sum(np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2 * t) for f in [110, 220, 261.63, 329.63, 440]) * np.exp(-t * 0.8) * 0.06
add(out, 44.0, 1.0)
add(chime([440.0, 659.25, 880.0, 1318.5], 4.0), 44.05, 0.7)

# ── reverb (FFT convolution with a decaying noise tail) + master ────────────────────
ir_t = tt(2.2)
ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2)
ir = fft_lp(ir, 5000)
ir[0] = 0
ir /= np.sqrt(np.sum(ir ** 2))


def conv(x):
    n = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[: len(x)]


L = L + conv(L) * 0.18
R = R + conv(R) * 0.18
mix = np.stack([L, R])
mix = np.tanh(mix * 1.1)
fade_in = np.minimum(1, np.arange(N) / (0.02 * SR))
end = at(48.6)
fade_out = np.ones(N)
fade_out[end:] = np.linspace(1, 0, N - end)
mix *= fade_in * fade_out
mix /= np.max(np.abs(mix)) / 0.89
pcm = (mix.T * 32767).astype(np.int16)
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote music.wav', DUR, 's')
