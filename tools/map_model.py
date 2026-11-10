"""In-silico tuning for every neuron in the MouseHarp network: orientation from drifting gratings at 12 angles,
receptive-field centre from counter-phase patches on a grid. Writes model_tuning.npz."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('MICRONS_DATA', os.path.join(HERE, 'microns_data'))   # downloaded source files
BUILD = os.environ.get('MOUSEHARP_BUILD', os.path.join(HERE, 'build'))      # intermediate arrays
WEB = os.path.join(HERE, '..', 'data')
os.makedirs(BUILD, exist_ok=True)

import sys, json, numpy as np; sys.path.insert(0, HERE)
from sim import *
meta = json.load(open(os.path.join(WEB, 'meta.json')))
W, _ = build(**meta['gains']); RUN = meta['run']
blank = [np.full((H_IMG, W_IMG), 0.5)] * 6
# ---- orientation
TH = np.arange(0, 180, 15); resp = []
for th in TH:
    R, _ = run(W, blank + [grating(th, 2 * np.pi * 2 * t * 0.02) for t in range(20)], **RUN)
    resp.append(R[12:].mean(0))
resp = np.array(resp)                                   # 12 x N
z = (resp * np.exp(2j * np.deg2rad(TH))[:, None]).sum(0) / (resp.sum(0) + 1e-9)
m_ori = (np.rad2deg(np.angle(z)) / 2) % 180; m_osi = np.abs(z); m_peak = resp.max(0)
# ---- receptive field: counter-phase blob (radius ~3 px) flickering at each grid position
yy, xx = np.mgrid[0:H_IMG, 0:W_IMG]
GX, GY = np.arange(2, W_IMG, 3), np.arange(2, H_IMG, 3)
rmap = np.zeros((len(GY), len(GX), N), np.float32)
for a, gy in enumerate(GY):
    for b, gx in enumerate(GX):
        blob = np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * 2.0 ** 2))
        fr = blank[:3] + [0.5 + 0.45 * blob * (1 if (t // 3) % 2 == 0 else -1) for t in range(12)]
        R, _ = run(W, fr, **RUN); rmap[a, b] = R[5:].mean(0)
w = np.maximum(rmap - np.percentile(rmap, 50, axis=(0, 1))[None, None], 0) ** 2
ws = w.sum((0, 1)) + 1e-12
m_rfx = (w * GX[None, :, None]).sum((0, 1)) / ws; m_rfy = (w * GY[:, None, None]).sum((0, 1)) / ws
m_rfpeak = rmap.max((0, 1))
np.savez(os.path.join(BUILD, 'model_tuning.npz'), m_ori=m_ori, m_osi=m_osi, m_peak=m_peak, m_rfx=m_rfx, m_rfy=m_rfy, m_rfpeak=m_rfpeak, resp=resp.astype(np.float32))
# sanity: measured cells' model preference vs measured preference
f = has_f & (M['osi'] > 0.3)
d = np.abs((m_ori[f] - M['ori'][f] + 90) % 180 - 90)
print('measured OSI>0.3: median |model - measured| ori', np.median(d).round(1), 'deg; chance = 45')
print('model OSI percentiles (unmeasured E / I):', np.percentile(m_osi[~has_f & ~inh], [25, 50, 75]).round(3), np.percentile(m_osi[inh], [25, 50, 75]).round(3))
print('model ori histogram, unmeasured cells with OSI>0.1 (15° bins):', np.histogram(m_ori[(~has_f) & (m_osi > 0.1)], bins=12, range=(0, 180))[0])
print('responsive (peak>0.02):', (m_peak > 0.02).mean().round(3), ' rf mapped (rfpeak>0.02):', (m_rfpeak > 0.02).mean().round(3))
dx = np.hypot(m_rfx[f_idx] - px, m_rfy[f_idx] - py); print('measured cells: median |model RF - measured RF| px', np.median(dx).round(2), '(image 32x18)')
