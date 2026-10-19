"""2026 KEL 챔피언십 결승 홍보영상 음악 + 효과음 합성 (D 단조, 120 BPM, 132초)

외부 음원 없이 numpy/scipy로 직접 합성합니다. 효과음 위치는 src/timeline.js와
영상 엔진(src/main.js)의 연출 시각에 맞춰 배치했습니다.
출력: audio/kel_promo_mix.wav (48 kHz, 16-bit, 스테레오)
"""
import json
import re
import sys
import wave
from pathlib import Path

import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
TL = json.loads(re.search(r"\{.*\}", (ROOT / "src/timeline.js").read_text(), re.S).group(0))

SR = 48000
DUR = TL["duration"]
BEAT = 60 / TL["bpm"]
BAR = BEAT * 4
N = int((DUR + 4) * SR)
rng = np.random.default_rng(2026)


def mtof(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=np.float64) - 69) / 12)


def tarr(n):
    return np.arange(n) / SR


def stereo():
    return np.zeros((2, N))


# 버스: 각각 따로 처리한 뒤 마지막에 섞습니다.
B = {k: stereo() for k in ["drums", "bass", "pad", "arp", "lead", "sfx", "verb_send", "delay_send"]}


def place(bus, t0, x, gain=1.0, pan=0.0):
    """x: (n,) 모노 또는 (2, n) 스테레오를 t0초 위치에 더합니다."""
    i = int(round(t0 * SR))
    if x.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        x = np.vstack([x * l * 1.414, x * r * 1.414])
    if i < 0:
        x = x[:, -i:]
        i = 0
    n = min(x.shape[1], N - i)
    if n > 0:
        B[bus][:, i:i + n] += x[:, :n] * gain


def sos(btype, fc, order=2):
    return signal.butter(order, fc, btype, fs=SR, output="sos")


def filt(x, btype, fc, order=2):
    return signal.sosfilt(sos(btype, fc, order), x, axis=-1)


def sweep(x, fc, btype="lowpass", order=2, block=256):
    """시간에 따라 바뀌는 차단 주파수. fc: 샘플별 배열 (대역통과는 (lo, hi) 쌍 배열)."""
    x = np.atleast_2d(x)
    y = np.zeros_like(x)
    zi = None
    for s in range(0, x.shape[1], block):
        e = min(x.shape[1], s + block)
        f = fc[(s + e) // 2]
        f = np.clip(f, 20, SR * 0.45)
        so = signal.butter(order, f, btype, fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((x.shape[0], so.shape[0], 2))
        for c in range(x.shape[0]):
            y[c, s:e], zi[c] = signal.sosfilt(so, x[c, s:e], zi=zi[c])
    return y if y.shape[0] > 1 else y[0]


def polyblep(ph, dt):
    out = np.zeros_like(ph)
    m = ph < dt
    x = ph[m] / dt[m]
    out[m] = x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    out[m] = x * x + x + x + 1
    return out


def saw(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    return 2 * ph - 1 - polyblep(ph, dt)


def supersaw(freq, n, voices=5, spread=14.0, width=0.8):
    out = np.zeros((2, n))
    for v in range(voices):
        c = (v - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        f = freq * 2 ** (c * spread / 1200)
        s = saw(f, n, rng.random())
        pan = c * width
        out[0] += s * np.cos((pan + 1) * np.pi / 4)
        out[1] += s * np.sin((pan + 1) * np.pi / 4)
    return out / voices


def adsr(n, a=0.005, d=0.1, s=0.7, r=0.1, hold=None):
    """hold: 노트 길이(초). 그 뒤 r초 동안 감쇠."""
    t = tarr(n)
    hold = hold if hold is not None else n / SR - r
    env = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    return env * (1 - rel) ** 2


NOISE = rng.standard_normal(SR * 4)


def noise(n, seed=None):
    if seed is None:
        start = rng.integers(0, len(NOISE) - n - 1) if n < len(NOISE) else 0
        if n >= len(NOISE):
            return rng.standard_normal(n)
        return NOISE[start:start + n].copy()
    return np.random.default_rng(seed).standard_normal(n)


# ------------------------------------------------------------------ 드럼
def kick(t0, amp=1.0, bus="drums"):
    n = int(0.55 * SR)
    t = tarr(n)
    f = 46 + 125 * np.exp(-t / 0.032) + 320 * np.exp(-t / 0.004)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.28) * (1 - np.exp(-t / 0.0012))
    click = filt(noise(n), "highpass", 2500) * np.exp(-t / 0.002) * 0.35
    place(bus, t0, np.tanh(1.7 * (body + click)) * amp * 0.8)
    KICKS.append(t0)


KICKS = []


def clap(t0, amp=1.0):
    n = int(0.45 * SR)
    t = tarr(n)
    env = np.zeros(n)
    for k in range(3):
        tk = k * 0.011
        env += (t >= tk) * np.exp(-np.clip(t - tk, 0, None) / 0.006)
    env += (t >= 0.033) * np.exp(-np.clip(t - 0.033, 0, None) / 0.12) * 0.8
    x = np.vstack([filt(noise(n), "bandpass", (1000, 7500)), filt(noise(n), "bandpass", (1000, 7500))]) * env
    x += np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.045) * 0.35
    place("drums", t0, x * amp * 0.9)
    place("verb_send", t0, x * amp * 0.35)


HAT_C = [filt(noise(int(0.09 * SR), seed=s), "highpass", 7500, 4) * np.exp(-tarr(int(0.09 * SR)) / 0.025) for s in range(4)]
HAT_O = [filt(noise(int(0.4 * SR), seed=10 + s), "highpass", 6500, 4) * np.exp(-tarr(int(0.4 * SR)) / 0.13) for s in range(2)]


def hat(t0, amp=1.0, open_=False, pan=0.0):
    x = HAT_O[int(t0 * 10) % 2] if open_ else HAT_C[int(t0 * 37) % 4]
    place("drums", t0, x * amp, pan=pan)


def snare(t0, amp=1.0):
    n = int(0.25 * SR)
    t = tarr(n)
    x = filt(noise(n), "bandpass", (1500, 9000)) * np.exp(-t / 0.075) + np.sin(2 * np.pi * 200 * t) * np.exp(-t / 0.05) * 0.6
    place("drums", t0, x * amp)
    place("verb_send", t0, x * amp * 0.4)


CRASH = None


def crash(t0, amp=1.0):
    global CRASH
    if CRASH is None:
        n = int(3.0 * SR)
        t = tarr(n)
        CRASH = np.vstack([filt(noise(n, 77), "highpass", 4200, 3), filt(noise(n, 78), "highpass", 4200, 3)]) * np.exp(-t / 0.95) * (1 - np.exp(-t / 0.003))
    place("drums", t0, CRASH * amp * 0.55)
    place("verb_send", t0, CRASH * amp * 0.25)


def reverse_crash(t_end, dur=1.5, amp=1.0):
    crash(-10)  # 파형 준비
    x = CRASH[:, : int(dur * SR)][:, ::-1]
    place("sfx", t_end - dur, x * amp * 0.6)


def snare_roll(t0, t1, amp=1.0):
    """8분 → 16분 → 32분으로 빨라지며 커지는 스네어 롤"""
    t = t0
    while t < t1 - 1e-6:
        k = (t - t0) / (t1 - t0)
        snare(t, amp * (0.25 + 0.75 * k ** 1.5))
        step = BEAT / 2 if k < 0.5 else BEAT / 4 if k < 0.8 else BEAT / 8
        t += step


# ------------------------------------------------------------------ 효과음
def impact(t0, amp=1.0, big=True):
    n = int(2.6 * SR)
    t = tarr(n)
    f = 28 + 58 * np.exp(-t / 0.7)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (1.1 if big else 0.6))
    burst = filt(noise(n), "lowpass", 2800) * np.exp(-t / 0.12)
    x = np.tanh(1.4 * (sub * 0.9 + burst * 0.5))
    place("sfx", t0, x * amp)
    place("verb_send", t0, x * amp * 0.5)
    if big:
        crash(t0, amp * 0.9)


def impact_lite(t0, amp=1.0):
    n = int(0.6 * SR)
    t = tarr(n)
    thump = np.sin(2 * np.pi * np.cumsum(45 + 70 * np.exp(-t / 0.05)) / SR) * np.exp(-t / 0.2)
    snap = filt(noise(n), "bandpass", (900, 6000)) * np.exp(-t / 0.035)
    zap = np.sin(2 * np.pi * np.cumsum(260 + 1700 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.09) * 0.25
    x = thump * 0.8 + snap * 0.45 + zap
    place("sfx", t0, x * amp)
    place("verb_send", t0, x * amp * 0.3)


def whoosh(tc, dur=0.7, amp=1.0, up=False):
    """tc에 가장 밝아지는 바람 소리. 좌 → 우로 이동."""
    n = int(dur * SR)
    u = np.linspace(0, 1, n)
    peak = 0.62 if not up else 0.95
    cf = np.where(u < peak, 350 * (3600 / 350) ** (u / peak), 3600 * (500 / 3600) ** ((u - peak) / (1 - peak + 1e-9)))
    bands = np.stack([cf * 0.6, cf * 1.6], axis=1)
    x = sweep(noise(n), bands, "bandpass", 1)
    env = np.where(u < peak, (u / peak) ** 2, (1 - (u - peak) / (1 - peak + 1e-9)) ** 1.5)
    pan = np.linspace(-0.8, 0.8, n)
    st = np.vstack([x * env * np.cos((pan + 1) * np.pi / 4), x * env * np.sin((pan + 1) * np.pi / 4)]) * 1.4
    place("sfx", tc - dur * peak, st * amp)
    place("verb_send", tc - dur * peak, st * amp * 0.25)


def riser(t0, t1, amp=1.0):
    n = int((t1 - t0) * SR)
    u = np.linspace(0, 1, n)
    cf = 300 * (9000 / 300) ** u
    x = sweep(np.vstack([noise(n), noise(n)]), np.stack([cf * 0.7, cf * 1.4], axis=1), "bandpass", 1)
    tone = supersaw(mtof(50) * 2 ** (u * 2), n, voices=3, spread=20) * 0.25
    tone = sweep(tone, 400 + 6000 * u ** 2, "lowpass", 2)
    env = u ** 2.2
    place("sfx", t0, (x * 1.2 + tone) * env * amp)
    place("verb_send", t0, (x + tone) * env * amp * 0.3)


def glitch_sfx(t0, dur=0.16, amp=1.0):
    n = int(dur * SR)
    x = np.zeros(n)
    i = 0
    while i < n:
        seg = int(rng.integers(300, 900))
        hold = int(rng.integers(4, 40))
        src = noise(seg)
        x[i:i + seg] = np.repeat(src[::hold], hold)[: min(seg, n - i)] * rng.uniform(0.3, 1)
        i += seg
    x = filt(x, "bandpass", (400, 7000)) * np.linspace(1, 0.2, n)
    place("sfx", t0, x * amp * 0.5, pan=float(rng.uniform(-0.4, 0.4)))


def blip(t0, midi, amp=1.0, pan=0.0, dur=0.35):
    n = int(dur * SR)
    t = tarr(n)
    f = mtof(midi)
    x = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.exp(-t / 0.09) * (1 - np.exp(-t / 0.001))
    place("sfx", t0, x * amp, pan=pan)
    place("delay_send", t0, x * amp * 0.5, pan=pan)


def sonar(t0, amp=1.0):
    n = int(1.4 * SR)
    t = tarr(n)
    x = np.sin(2 * np.pi * 880 * t) * np.exp(-t / 0.35) * (1 - np.exp(-t / 0.004)) + np.sin(2 * np.pi * 1320 * t) * np.exp(-t / 0.15) * 0.3
    place("sfx", t0, x * amp * 0.35)
    place("delay_send", t0, x * amp * 0.35)
    place("verb_send", t0, x * amp * 0.3)


def ui_tick(t0, amp=1.0):
    n = int(0.03 * SR)
    t = tarr(n)
    place("sfx", t0, np.sin(2 * np.pi * 3100 * t) * np.exp(-t / 0.006) * amp * 0.25, pan=0.2)


def scan_sfx(t0, t1, amp=1.0):
    n = int((t1 - t0) * SR)
    u = np.linspace(0, 1, n)
    cf = 1200 + 1500 * np.sin(u * np.pi) + 300 * np.sin(u * 60)
    x = sweep(noise(n), np.stack([cf * 0.85, cf * 1.15], axis=1), "bandpass", 1)
    place("sfx", t0, x * np.sin(u * np.pi) ** 0.5 * amp * 0.35)


def braam(t0, amp=1.0, dur=3.8, notes=(38, 45, 50)):
    n = int(dur * SR)
    t = tarr(n)
    x = np.zeros((2, n))
    for m in notes:
        x += supersaw(mtof(m), n, voices=4, spread=16)
    fc = 160 + 2300 * np.exp(-t / 0.35) * (1 - np.exp(-t / 0.03)) + 300 * np.exp(-t / 2)
    x = sweep(x, fc, "lowpass", 2)
    x = np.tanh(2.2 * x) * np.exp(-t / 1.5) * (1 - np.exp(-t / 0.01))
    place("sfx", t0, x * amp * 0.55)
    place("verb_send", t0, x * amp * 0.4)


def stab_note(t0, midi, amp=1.0):
    n = int(0.9 * SR)
    t = tarr(n)
    x = supersaw(mtof(midi), n, 5, 18) + supersaw(mtof(midi - 12), n, 3, 10) * 0.7
    x = sweep(x, 300 + 5000 * np.exp(-t / 0.08), "lowpass", 2) * np.exp(-t / 0.3)
    place("sfx", t0, x * amp * 0.5)
    place("verb_send", t0, x * amp * 0.4)


# ------------------------------------------------------------------ 화성
CH = {
    "Dm": dict(pad=[50, 57, 62, 65, 69], root=38, arp=[62, 65, 69, 74]),
    "Bb": dict(pad=[46, 53, 58, 62, 65], root=34, arp=[62, 65, 70, 74]),
    "F": dict(pad=[41, 53, 57, 60, 65], root=41, arp=[60, 65, 69, 72]),
    "C": dict(pad=[48, 55, 60, 64, 67], root=36, arp=[60, 64, 67, 72]),
    "Gm": dict(pad=[43, 55, 58, 62, 67], root=43, arp=[62, 67, 70, 74]),
    "A": dict(pad=[45, 57, 61, 64, 69], root=33, arp=[61, 64, 69, 73]),
}
PROG = ["Dm", "Bb", "F", "C"]
# 마디별 화음 (마디 = 2초)
CHORDS = (["Dm"] * 6 + PROG + PROG + ["Bb", "C"] + PROG * 3 + ["Dm", "Bb", "Gm", "A"] + PROG * 3
          + ["Dm", "Dm", "Bb", "Bb", "Gm", "A"] + ["Bb", "C", "Gm", "A"] + PROG + PROG + ["Dm"] * 4)
assert len(CHORDS) == 66, len(CHORDS)


def chord_at(bar):
    return CH[CHORDS[min(bar, len(CHORDS) - 1)]]


def pad_section(b0, b1, amp=1.0, cutoff=2400, attack=0.25):
    """b0~b1 마디 동안 마디마다 화음을 바꾸는 슈퍼소 패드"""
    for bar in range(b0, b1):
        c = chord_at(bar)
        n = int((BAR + 0.8) * SR)
        x = np.zeros((2, n))
        for m in c["pad"]:
            x += supersaw(mtof(m), n, voices=5, spread=12, width=0.9) * (0.7 if m < 48 else 1.0)
        x = filt(x, "lowpass", cutoff, 2)
        env = adsr(n, a=attack, d=0.6, s=0.85, r=0.75, hold=BAR)
        place("pad", bar * BAR, x * env * amp * 0.5)
        place("verb_send", bar * BAR, x * env * amp * 0.06)


def bass_section(b0, b1, mode="offbeat", amp=1.0):
    """sub: 사인, reese: 디튠 톱니 + 저역통과"""
    for bar in range(b0, b1):
        c = chord_at(bar)
        f = mtof(c["root"])
        if mode == "sustain":
            notes = [(0, BAR)]
        elif mode == "offbeat":
            notes = [(k * BEAT + BEAT / 2, BEAT / 2 * 0.9) for k in range(4)] + [(k * BEAT, BEAT / 2 * 0.6) for k in range(4)]
        else:  # rolling 16ths
            notes = [(k * BEAT / 4, BEAT / 4 * 0.85) for k in range(16)]
        for off, ln in notes:
            n = int((ln + 0.08) * SR)
            t = tarr(n)
            env = adsr(n, a=0.004, d=0.2, s=0.9, r=0.06, hold=ln)
            sub = np.sin(2 * np.pi * f * t) * env
            rs = (saw(f * 2 * 2 ** (8 / 1200), n) + saw(f * 2 * 2 ** (-8 / 1200), n)) * 0.5
            rs = filt(rs, "lowpass", 950 if mode != "sustain" else 550, 2) * env
            place("bass", bar * BAR + off, sub * amp * 0.42)
            place("bass", bar * BAR + off, np.vstack([rs, rs * 0.96]) * amp * 0.34)


ARP_PAT = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 1]


def arp_section(b0, b1, amp=1.0, cut0=900, cut1=900, octave=0):
    t_start, t_end = b0 * BAR, b1 * BAR
    n_total = int((t_end - t_start + 1) * SR)
    x = np.zeros((2, n_total))
    for bar in range(b0, b1):
        c = chord_at(bar)
        for k in range(16):
            m = c["arp"][ARP_PAT[k]] + octave + (12 if k in (3, 11) else 0)
            n = int(0.3 * SR)
            t = tarr(n)
            s = saw(mtof(m), n) * 0.6 + np.sign(np.sin(2 * np.pi * mtof(m) * t)) * 0.25
            s = filt(s, "lowpass", 5200, 1) * np.exp(-t / 0.075) * (1 - np.exp(-t / 0.002))
            i = int((bar * BAR + k * BEAT / 4 - t_start) * SR)
            pan = 0.35 if k % 2 else -0.35
            x[0, i:i + n] += s * np.cos((pan + 1) * np.pi / 4)
            x[1, i:i + n] += s * np.sin((pan + 1) * np.pi / 4)
    fc = cut0 * (cut1 / cut0) ** np.linspace(0, 1, n_total)
    x = sweep(x, fc, "lowpass", 2, block=512)
    place("arp", t_start, x * amp * 1.6)
    place("delay_send", t_start, x * amp * 0.8)


# 리드 멜로디 (8분음표 단위: 시작, 길이, 음)
LEAD = [
    [(0, 2, 69), (2, 1, 69), (3, 1, 72), (4, 2, 74), (6, 2, 72)],
    [(0, 2, 70), (2, 1, 70), (3, 1, 69), (4, 2, 65), (6, 2, 62)],
    [(0, 2, 69), (2, 1, 69), (3, 1, 72), (4, 2, 77), (6, 2, 76)],
    [(0, 3, 76), (3, 1, 74), (4, 4, 72)],
]


def lead_section(b0, b1, amp=1.0):
    for bar in range(b0, b1):
        for st, ln, m in LEAD[(bar - b0) % 4]:
            dur = ln * BEAT / 2
            n = int((dur + 0.25) * SR)
            t = tarr(n)
            vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) / 0.2, 0, 1)
            f = mtof(m) * vib
            x = supersaw(f, n, voices=3, spread=10, width=0.5) + supersaw(f * 2, n, voices=2, spread=6, width=0.3) * 0.25
            x = filt(x, "lowpass", 3800, 2) * adsr(n, a=0.008, d=0.25, s=0.75, r=0.18, hold=dur * 0.92)
            t0 = bar * BAR + st * BEAT / 2
            place("lead", t0, x * amp * 0.8)
            place("delay_send", t0, x * amp * 0.3)
            place("verb_send", t0, x * amp * 0.18)


def drone(t0, t1, amp=1.0):
    n = int((t1 - t0) * SR)
    u = np.linspace(0, 1, n)
    x = np.zeros((2, n))
    for m in (38, 45, 50, 53):
        x += supersaw(mtof(m), n, voices=4, spread=10)
    x = sweep(x, 180 + 1400 * u ** 2, "lowpass", 2, block=512)
    place("pad", t0, x * (0.25 + 0.75 * u) * amp * 0.4)
    place("verb_send", t0, x * u * amp * 0.08)


# ------------------------------------------------------------------ 편곡
def beats(t0, t1, step=BEAT, off=0.0):
    k = 0
    while True:
        t = t0 + off + k * step
        if t >= t1 - 1e-6:
            return
        yield t
        k += 1


def groove(t0, t1, kick_amp=1.0, clap_amp=1.0, hats16=True, openhat=True):
    for t in beats(t0, t1):
        kick(t, kick_amp)
    for t in beats(t0, t1, BEAT * 2, BEAT):
        clap(t, clap_amp)
    for t in beats(t0, t1, BEAT, BEAT / 2):
        hat(t, 0.55 if not openhat else 0.4, open_=openhat, pan=0.1)
    if hats16:
        for i, t in enumerate(beats(t0, t1, BEAT / 4)):
            if i % 2:
                hat(t, 0.22 + 0.08 * (i % 4 == 3), pan=-0.25)


def halftime(t0, t1, amp=1.0):
    for bar_t in beats(t0, t1, BAR):
        kick(bar_t, amp)
        kick(bar_t + BEAT * 1.5, amp * 0.8)
        snare(bar_t + BEAT * 2, amp * 0.9)
        clap(bar_t + BEAT * 2, amp * 0.5)
    for t in beats(t0, t1, BEAT / 2):
        hat(t, 0.28, pan=0.15)


def build():
    T = TL
    # 1) 훅 0–12: 드론, 심장 박동, 단어마다 글리치, 16→12→8→1, 라이저, 로고 브람
    drone(0.0, 8.0, 0.9)
    for w in T["hookWords"]:
        kick(w, 0.55)
        kick(w + 0.28, 0.35)
        glitch_sfx(w + 0.05, 0.18, 0.9)
        whoosh(w + 0.06, 0.5, 0.35)
    for i, (tn, m) in enumerate(zip(T["hookNums"], (50, 53, 57, 62))):
        stab_note(tn, m + 12, 0.8 + 0.1 * i)
        impact_lite(tn, 0.9)
        glitch_sfx(tn, 0.12, 0.6)
    riser(4.2, 8.0, 0.75)
    reverse_crash(8.0, 1.6, 0.9)
    L = T["logoHit"]
    impact(L, 1.15)
    braam(L, 1.0)
    kick(L, 1.0)
    pad_section(4, 6, 0.6, cutoff=1400, attack=0.6)
    for k, tt in enumerate(beats(L + 0.6, L + 1.3, 0.06)):
        ui_tick(tt, 0.5)

    # 2) 소개 12–20: 하프타임 그루브
    whoosh(12.0, 0.7, 0.8)
    impact_lite(12.0, 0.7)
    halftime(12.0, 20.0, 0.85)
    bass_section(6, 10, "sustain", 0.9)
    pad_section(6, 10, 0.85, cutoff=2000)
    arp_section(6, 10, 0.7, cut0=700, cut1=1600)
    crash(16.0, 0.5)
    glitch_sfx(16.0, 0.14, 0.5)

    # 3) 지도 20–32: 빌드업, 핀 16개가 D 단조 5음계로 올라감
    whoosh(20.0, 0.7, 0.8)
    scan_sfx(20.05, 21.4, 0.8)
    for t in beats(20.0, 31.0):
        kick(t, 0.85)
    for t in beats(20.0, 30.0, BEAT, BEAT / 2):
        hat(t, 0.35, open_=True)
    for i, t in enumerate(beats(24.0, 31.0, BEAT / 4)):
        if i % 2:
            hat(t, 0.2, pan=-0.25)
    for t in beats(22.0, 30.0, BEAT * 2, BEAT):
        clap(t, 0.7)
    penta = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89, 91, 93, 96, 98]
    for i in range(16):
        tp = T["pinDropStart"] + i * T["pinDropStep"]
        blip(tp, penta[i], 0.55, pan=-0.6 + 1.2 * (i / 15))
    bass_section(10, 15, "offbeat", 0.85)
    pad_section(10, 16, 0.8, cutoff=2200)
    arp_section(10, 16, 0.85, cut0=900, cut1=5000)
    riser(28.0, 32.0, 0.9)
    snare_roll(30.0, 32.0, 0.8)
    reverse_crash(32.0, 1.2, 0.7)
    scan_sfx(26.0, 28.2, 0.5)

    # 4) 팀 소개 전반 32–56: 드롭 1
    def drop(b0, b1, lead=False, amp=1.0):
        t0, t1 = b0 * BAR, b1 * BAR
        groove(t0, t1, 1.0 * amp, 0.9 * amp)
        bass_section(b0, b1, "offbeat", amp)
        pad_section(b0, b1, 0.95 * amp, cutoff=3200, attack=0.02)
        arp_section(b0, b1, 0.9 * amp, cut0=4200, cut1=4200)
        if lead:
            lead_section(b0, b1, amp)

    impact(32.0, 1.0)
    drop(16, 28)
    # 5) 루미아 56–64: 브레이크다운
    impact(56.0, 0.9)
    pad_section(28, 32, 0.9, cutoff=1600, attack=0.4)
    arp_section(28, 32, 0.7, cut0=1100, cut1=2600)
    bass_section(28, 32, "sustain", 0.6)
    scan_sfx(56.2, 58.4, 0.9)
    for t in (56.6, 57.6, 58.6, 59.6):
        sonar(t, 0.45)
    riser(60.0, 64.0, 1.0)
    snare_roll(62.0, 64.0, 0.9)
    reverse_crash(64.0, 1.5, 0.9)
    for t in beats(60.0, 63.5):
        kick(t, 0.6)
    # 6) 팀 소개 후반 64–88: 드롭 2 (리드 추가)
    impact(64.0, 1.1)
    drop(32, 44, lead=True)
    for s in range(16):
        t0 = (T["teamStartA"] if s < 8 else T["teamStartB"]) + (s % 8) * T["teamDur"]
        whoosh(t0 - 0.12, 0.55, 0.55)
        impact_lite(t0, 0.75)
        glitch_sfx(t0, 0.12, 0.35)
        ui_tick(t0 + 0.3, 0.6)
        ui_tick(t0 + 0.36, 0.5)

    # 7) 결승 구조 88–100: 하프타임 + 큰 타격
    whoosh(88.0, 0.7, 0.8)
    halftime(88.0, 100.0, 1.0)
    bass_section(44, 50, "sustain", 1.0)
    pad_section(44, 50, 0.9, cutoff=2400)
    arp_section(44, 50, 0.6, cut0=1500, cut1=3000)
    for i, h in enumerate(T["roadHits"]):
        impact(h, 0.8 if i != 4 else 1.0, big=i in (0, 2, 4))
        braam(h, 0.5, dur=1.6, notes=(38, 45) if i < 4 else (38, 45, 50))
    for i in range(16):
        blip(88.0 + i * 0.0625, 74 + (i % 4) * 3, 0.25, pan=-0.5 + (i % 4) / 3)

    # 8) 대전 100–108: 빌드업 (소나 핑은 결승 장소 핀의 파동과 같은 주기)
    whoosh(100.0, 0.7, 0.8)
    impact(100.0, 0.9)
    for t in beats(100.5, 107.6, BEAT * 2):
        sonar(t, 0.8)
    for t in beats(100.0, 104.0):
        kick(t, 0.9)
    for t in beats(104.0, 106.0, BEAT / 2):
        kick(t, 0.8)
    for t in beats(106.0, 107.5, BEAT / 4):
        kick(t, 0.7)
    bass_section(50, 54, "rolling", 0.8)
    pad_section(50, 54, 0.9, cutoff=1800)
    arp_section(50, 54, 0.85, cut0=1000, cut1=7000)
    riser(102.0, 108.0, 1.1)
    snare_roll(104.0, 107.75, 1.0)
    reverse_crash(108.0, 2.0, 1.0)

    # 9) 집결 108–116: 마지막 드롭
    impact(108.0, 1.25)
    braam(108.0, 0.8)
    drop(54, 58, lead=True, amp=1.05)
    crash(112.0, 0.9)
    impact(113.0, 0.8, big=False)
    glitch_sfx(113.0, 0.3, 0.9)

    # 10) 일정 안내 116–132: 마지막 타격 → 124초 고정 화면 동안 화음 여운
    impact(116.0, 1.2)
    braam(116.0, 0.9)
    groove(116.0, 124.0, 0.9, 0.8)
    bass_section(58, 62, "offbeat", 0.9)
    pad_section(58, 62, 0.9, cutoff=3000, attack=0.02)
    arp_section(58, 62, 0.75, cut0=4000, cut1=2500)
    for t in T["ctaTicks"]:
        ui_tick(t, 0.9)
        blip(t, 86, 0.18)
    impact(124.0, 1.0)
    braam(124.0, 0.8, dur=6.0, notes=(38, 45, 50, 57))
    n = int(8.0 * SR)
    tt = tarr(n)
    x = np.zeros((2, n))
    for m in CH["Dm"]["pad"] + [74]:
        x += supersaw(mtof(m), n, voices=5, spread=12)
    x = filt(x, "lowpass", 2600, 2) * np.exp(-tt / 2.6) * (1 - np.exp(-tt / 0.02))
    place("pad", 124.0, x * 0.45)
    place("verb_send", 124.0, x * 0.12)


def make_ir(sec=2.6, seed=5):
    n = int(sec * SR)
    t = tarr(n)
    r = np.random.default_rng(seed)
    ir = r.standard_normal((2, n)) * np.exp(-t * 6.9 / sec)
    ir = filt(ir, "lowpass", 6500, 1)
    ir[:, : int(0.018 * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))


def sidechain(kicks, depth=0.7, rel=0.24):
    env = np.ones(N)
    m = int(rel * SR)
    shape = 1 - depth * (1 - np.linspace(0, 1, m)) ** 2
    for k in kicks:
        i = int(k * SR)
        e = min(N, i + m)
        env[i:e] = np.minimum(env[i:e], shape[: e - i])
    return env


def main():
    build()
    sc = sidechain(sorted(set(round(k, 4) for k in KICKS if k >= 0)))
    mix = B["drums"] * 0.95 + B["sfx"] * 0.9
    mix += (B["bass"] * 0.9 + B["pad"] * 0.75 + B["arp"] * 0.7 + B["lead"] * 0.75) * sc
    # 핑퐁 딜레이 (점8분)
    d = int(BEAT * 0.75 * SR)
    dl = np.zeros_like(mix)
    src = filt(B["delay_send"], "bandpass", (300, 6000), 1)
    for k in range(1, 6):
        ch = k % 2
        dl[ch, k * d:] += src.sum(axis=0)[: N - k * d] * 0.5 * (0.45 ** k)
    mix += dl * 0.8
    # 리버브
    ir = make_ir()
    vs = filt(B["verb_send"], "highpass", 250, 1)
    verb = np.vstack([signal.fftconvolve(vs[c], ir[c])[:N] for c in range(2)])
    mix += verb * 0.55
    mix = filt(mix, "highpass", 28, 2)
    mix = mix[:, : int(DUR * SR)]
    # 마지막 1.5초 페이드아웃, 시작 클릭 방지
    fade = int(1.5 * SR)
    mix[:, -fade:] *= np.linspace(1, 0, fade) ** 1.5
    mix[:, :240] *= np.linspace(0, 1, 240)
    # 마스터: 드롭 구간 RMS 기준으로 맞춘 뒤 부드러운 클리핑
    seg = mix[:, int(34 * SR): int(54 * SR)]
    rms = np.sqrt((seg ** 2).mean())
    mix *= 10 ** (-12.8 / 20) / rms
    mix = np.tanh(mix * 1.05) / np.tanh(1.05)
    # 트루 피크(4배 오버샘플링 기준) -1.2 dBTP로 맞춥니다.
    peak = np.abs(signal.resample_poly(mix, 4, 1, axis=1)).max()
    mix *= 10 ** (-1.2 / 20) / peak
    out = ROOT / "audio/kel_promo_mix.wav"
    out.parent.mkdir(exist_ok=True)
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2").T.copy()
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    # 구간별 음량 리포트
    for s in TL["sections"]:
        a = mix[:, int(s["start"] * SR): int(s["end"] * SR)]
        print(f'{s["id"]:7s} rms {20 * np.log10(np.sqrt((a ** 2).mean()) + 1e-9):6.1f} dBFS  peak {20 * np.log10(np.abs(a).max() + 1e-9):5.1f}', file=sys.stderr)
    print(f"wrote {out} ({mix.shape[1] / SR:.2f}s)", file=sys.stderr)


if __name__ == "__main__":
    main()
