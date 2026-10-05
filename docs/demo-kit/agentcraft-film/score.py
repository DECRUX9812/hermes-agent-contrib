#!/usr/bin/env python3
"""Percussive score for the AgentCraft Studio film. Pure numpy -> score.wav.
Bar grid: 4 beats/bar at BPM. Every cut lands on a bar; hits on cuts."""
import numpy as np

SR = 48000
BPM = 120
BARS = 14  # 28s @120bpm? no: bar = 2s -> 14 bars = 28s. we'll make 16 bars = 32s
BARS = 16
DUR = BARS * 4 * 60.0 / BPM
N = int(SR * DUR)
t = np.arange(N) / SR
mix = np.zeros(N, dtype=np.float64)

def env(n, a, d):
    e = np.ones(n)
    e[: max(1, int(a * n))] = np.linspace(0, 1, max(1, int(a * n)))
    e[int(a * n):] *= np.exp(-np.linspace(0, 6, n - int(a * n)) / max(d, 1e-6))
    return e

def place(sig, at):
    i = int(at * SR)
    j = min(N, i + len(sig))
    mix[i:j] += sig[: j - i]

def kick(f0=140, f1=42, dur=0.34):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-tt * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(n, 0.002, 0.5) * 0.9

def hat(dur=0.045, hp=7000):
    n = int(SR * dur)
    x = np.random.default_rng(7).standard_normal(n)
    # crude highpass: diff
    x = np.diff(x, prepend=0)
    return x * env(n, 0.001, 0.8) * 0.18

def snare(dur=0.16):
    n = int(SR * dur)
    rng = np.random.default_rng(11)
    x = rng.standard_normal(n)
    tone = np.sin(2 * np.pi * 190 * np.arange(n) / SR)
    return (x * 0.5 + tone * 0.5) * env(n, 0.001, 0.9) * 0.4

def riser(dur):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    f = 200 * np.exp(tt / dur * np.log(2600 / 200))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.linspace(0, 1, n) ** 2 * 0.22

def subdrop(dur=0.7):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    f = 120 * np.exp(-tt * 3) + 30
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(n, 0.005, 0.8) * 0.8

def chord(freqs, dur, amp=0.05):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * f * tt) for f in freqs) / len(freqs)
    return s * env(n, 0.05, 1.2) * amp

BAR = 4 * 60.0 / BPM  # 2.0s
BEAT = BAR / 4

# pulse: kick every beat, hats 8ths, snare on 2&4
for b in range(BARS * 4):
    place(kick(), b * BEAT)
    place(hat(), b * BEAT + BEAT / 2)
    if b % 2 == 1:
        place(snare(), b * BEAT)

# bass line — A minor pent-ish pulse under the kick
notes = [55, 55, 65.4, 55, 82.4, 55, 73.4, 98]
for i, f in enumerate(notes * (BARS // 2)):
    n = int(SR * BEAT * 0.9)
    tt = np.arange(n) / SR
    place(np.sin(2 * np.pi * f * tt) * env(n, 0.01, 1.0) * 0.12, i * BAR)

# risers before each section cut (bars 4, 8, 12) + big subdrop at 12->13
for bar in (4, 8, 12, 14):
    place(riser(BAR * 0.9), bar * BAR + BAR * 0.1)
place(subdrop(), 12 * BAR)

# pads swell at intro/outro
place(chord([220, 261.6, 329.6], BAR * 4, 0.05), 0)
place(chord([174.6, 220, 261.6], BAR * 3, 0.06), 13 * BAR)

# normalize, fade out last bar
mix /= max(1e-6, np.abs(mix).max()) * 1.05
fade = int(BAR * SR)
mix[-fade:] *= np.linspace(1, 0, fade)
pcm = (np.clip(mix, -1, 1) * 32767).astype(np.int16)
import wave
w = wave.open('score.wav', 'wb')
w.setnchannels(1)
w.setsampwidth(2)
w.setframerate(SR)
w.writeframes(pcm.tobytes())
w.close()
print('score.wav', DUR, 's')
