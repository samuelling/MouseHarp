"""Reference simulator for the MouseHarp network (numpy). The browser worker reimplements exactly this."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('MICRONS_DATA', os.path.join(HERE, 'microns_data'))   # downloaded source files
BUILD = os.environ.get('MOUSEHARP_BUILD', os.path.join(HERE, 'build'))      # intermediate arrays
WEB = os.path.join(HERE, '..', 'data')
os.makedirs(BUILD, exist_ok=True)

import numpy as np, scipy.sparse as sps
M = np.load(os.path.join(BUILD, 'model.npz'), allow_pickle=False)
N = int(M['N']); inh = M['inh']; grp = M['grp']; has_f = M['has_f']
# ---------------------------------------------------------------- input: oriented energy at each functional cell's RF
W_IMG, H_IMG, NORI = 32, 18, 8
def gabor_bank(lam=6.0, sig=2.0, K=9):
    r = np.arange(K) - K // 2; X, Y = np.meshgrid(r, r)
    bank = []
    for k in range(NORI):
        th = np.pi * k / NORI                       # orientation of the bar, 0 = vertical, counter-clockwise (screen y up)
        u = X * np.cos(th) - Y * np.sin(th)        # coordinate across the bar (image rows grow downward, hence -Y)
        g = np.exp(-(X ** 2 + Y ** 2) / (2 * sig ** 2))
        ev, od = g * np.cos(2 * np.pi * u / lam), g * np.sin(2 * np.pi * u / lam)
        ev -= ev.mean(); bank.append((ev / np.abs(ev).sum(), od / np.abs(od).sum()))
    return bank
BANK = gabor_bank()
def energy(img):
    """img: H_IMG x W_IMG luminance in [0,1]. Returns NORI x H x W oriented energy (contrast-energy units)."""
    from scipy.signal import convolve2d
    x = img - img.mean()
    return np.stack([np.sqrt(convolve2d(x, e, 'same', 'symm') ** 2 + convolve2d(x, o, 'same', 'symm') ** 2) for e, o in BANK])
rf = M['rf'].copy(); f_idx = np.where(has_f)[0]
lo, hi = np.nanpercentile(rf[f_idx], 1, 0), np.nanpercentile(rf[f_idx], 99, 0)
uv = (rf[f_idx] - lo) / (hi - lo) * 0.8 + 0.1                 # RF cloud stretched over the central 80% of the frame
px = np.clip(uv[:, 0] * (W_IMG - 1), 0, W_IMG - 1); py = np.clip(uv[:, 1] * (H_IMG - 1), 0, H_IMG - 1)
ori_f = M['ori'][f_idx]; osi_f = np.clip(2.5 * M['osi'][f_idx], 0.15, 1)
ok = ori_f / (180 / NORI); o0 = np.floor(ok).astype(int) % NORI; o1 = (o0 + 1) % NORI; of = ok - np.floor(ok)
def drive(E):
    """per functional cell: tuned energy at its RF, mixed with untuned energy by its selectivity"""
    xi, yi = np.round(px).astype(int), np.round(py).astype(int)
    e_pref = (1 - of) * E[o0, yi, xi] + of * E[o1, yi, xi]
    e_mean = E[:, yi, xi].mean(0)
    return osi_f * e_pref + (1 - osi_f) * e_mean
# ---------------------------------------------------------------- network
rowptr, src, w = M['rowptr'], M['src'], M['w'].astype(np.float64)
post = np.repeat(np.arange(N), np.diff(rowptr))
normE = M['fullE'][~inh].mean(); normI = M['fullI'][~inh].mean()
def build(gEE=1.0, gEI=1.0, gIE=1.0, gII=1.0):
    pre_i = inh[src]; post_i = inh[post]
    g = np.where(pre_i, -np.where(post_i, gII, gEI) / normI, np.where(post_i, gIE, gEE) / normE)
    return sps.csr_matrix((w * g, (post, src)), shape=(N, N)).astype(np.float32), g.astype(np.float32)
TAU = np.where(inh, 0.010, 0.020); DT = 0.02 / 3; ALPHA = (1 - np.exp(-DT / TAU)).astype(np.float32); ALPHA_A = np.float32(1 - np.exp(-DT / 0.3))  # adaptation, 300 ms
def run(W, frames, steps_per_frame=3, gain_in=4.0, h=0.05, k=1.0, rmax=1.0, r0=None, adapt=0.85, trans=2.0, record=None, b_ad=1.0):
    r = np.zeros(N, np.float32) if r0 is None else r0.copy(); A = np.zeros(N, np.float32)
    sbar = None; out = []
    for img in frames:
        s = drive(energy(img)); sbar = s if sbar is None else adapt * sbar + (1 - adapt) * s
        sin = np.zeros(N, np.float32); sin[f_idx] = gain_in * (s + trans * np.maximum(s - sbar, 0))
        for _ in range(steps_per_frame):
            x = W @ r + sin + h - b_ad * A
            f = rmax * np.tanh(k * np.maximum(x, 0) ** 2 / rmax)
            r += ALPHA * (f - r); A += ALPHA_A * (r - A)
        out.append(r.copy() if record is None else record(r))
    return np.array(out), r
def grating(th_deg, phase, contrast=1.0, lam=6.0):
    yy, xx = np.mgrid[0:H_IMG, 0:W_IMG]; th = np.deg2rad(th_deg)
    u = xx * np.cos(th) - yy * np.sin(th)
    return 0.5 + 0.5 * contrast * np.cos(2 * np.pi * u / lam + phase)
