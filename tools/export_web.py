"""Export the MouseHarp network for the browser: data/net.bin, data/cells.bin, data/meta.json, plus a reference run
(data/ref.json, not shipped) for validating the JS engine against sim.py."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('MICRONS_DATA', os.path.join(HERE, 'microns_data'))   # downloaded source files
BUILD = os.environ.get('MOUSEHARP_BUILD', os.path.join(HERE, 'build'))      # intermediate arrays
WEB = os.path.join(HERE, '..', 'data')
os.makedirs(BUILD, exist_ok=True)

import sys, json, numpy as np; sys.path.insert(0, HERE)
from sim import *
OUT = sys.argv[1] if len(sys.argv) > 1 else WEB
fullE, fullI = M['fullE'], M['fullI']
cnt = np.minimum(M['cnt'], 255).astype(np.uint8)
# per-post rescale factors that were folded into w (w = cnt * scale[post]); recompute so the browser can rebuild w exactly
post = np.repeat(np.arange(N), np.diff(rowptr))
sc = (M['w'] / M['cnt']).astype(np.float32)                    # per edge; constant per (post, pre class)
pre_i = inh[src]
sE = np.zeros(N, np.float32); sI = np.zeros(N, np.float32)
sE[post[~pre_i]] = sc[~pre_i]; sI[post[pre_i]] = sc[pre_i]
with open(f'{OUT}/net.bin', 'wb') as f:
    f.write(rowptr.astype(np.int32).tobytes()); f.write(src.astype(np.uint16).tobytes()); f.write(cnt.tobytes())
    f.write(sE.tobytes()); f.write(sI.tobytes())
# ---------------------------------------------------------------- cells
pos = M['pos']; grp_ = grp.astype(np.uint8); area = M['area'].astype(np.uint8)
ori = M['ori'].copy(); src_ori = np.zeros(N, np.uint8); src_ori[has_f] = 1
# cells that were not imaged: the orientation and receptive field they acquire in the model, mapped in silico
# (map_model.py: drifting gratings at 12 angles; counter-phase patches on a grid)
T = np.load(os.path.join(BUILD, 'model_tuning.npz'))
tuned = (~has_f) & (T['m_osi'] > 0.12) & (T['m_peak'] > 0.02)
ori[tuned] = T['m_ori'][tuned]; src_ori[tuned] = 2
ori_u8 = np.where(src_ori > 0, np.round(np.nan_to_num(ori)) % 180, 255).astype(np.uint8)
rfx = np.full(N, np.nan, np.float32); rfy = np.full(N, np.nan, np.float32)
rfx[f_idx] = px; rfy[f_idx] = py
mapped = (~has_f) & (T['m_rfpeak'] > 0.02)
rfx[mapped] = T['m_rfx'][mapped]; rfy[mapped] = T['m_rfy'][mapped]
inh_ok, inh_rf = tuned, mapped
osi_u8 = np.zeros(N, np.uint8); osi_u8[has_f] = np.round(np.clip(M['osi'][has_f], 0, 1) * 255)
osi_u8[tuned] = np.round(np.clip(T['m_osi'][tuned], 0, 1) * 255)
mt_names = sorted(set(M['mtype'])); mt = np.array([mt_names.index(m) for m in M['mtype']], np.uint8)
with open(f'{OUT}/cells.bin', 'wb') as f:
    f.write(pos.astype(np.float32).tobytes()); f.write(rfx.tobytes()); f.write(rfy.tobytes())
    f.write(grp_.tobytes()); f.write(area.tobytes()); f.write(ori_u8.tobytes()); f.write(src_ori.tobytes()); f.write(osi_u8.tobytes()); f.write(mt.tobytes())
# functional drive table (order = f_idx)
func = dict(idx=f_idx.tolist(), px=np.round(px).astype(int).tolist(), py=np.round(py).astype(int).tolist(), o0=o0.tolist(), o1=o1.tolist(),
            of=np.round(of, 4).tolist(), osi=np.round(osi_f, 4).tolist())
bank = [[np.round(e, 6).ravel().tolist(), np.round(o, 6).ravel().tolist()] for e, o in BANK]
meta = dict(N=N, E=int(len(src)), synapses_kept=int(M['cnt'].astype(np.int64).sum()), edges_total=7463640, synapses_total=11554859,
            img=[W_IMG, H_IMG], nori=NORI, bank=bank, K=9, gains=GAINS, run=RUN, normE=float(normE), normI=float(normI),
            tauE=0.020, tauI=0.010, tauA=0.3, dt=DT, steps_per_frame=3, mtypes=mt_names,
            groups=['L2/3', 'L4', 'L5', 'L6', 'PTC', 'DTC', 'STC', 'ITC'], areas=['V1', 'RL', 'AL', 'LM'], func=func,
            counts=dict(functional=int(has_f.sum()), model_ori=int(inh_ok.sum()), model_rf=int(inh_rf.sum()),
                        per_group=np.bincount(grp, minlength=8).tolist(), per_area=np.bincount(M['area'], minlength=4).tolist(),
                        proofread_axons=int((M['st_axon'] == 't').sum())))
y_ = pos[:, 1]
meta['depth'] = {n: [float(np.percentile(y_[grp == q], 5)), float(np.median(y_[grp == q])), float(np.percentile(y_[grp == q], 95))] for q, n in enumerate(meta['groups'][:4])}
meta['bounds'] = {k: [float(pos[:, i].min()), float(pos[:, i].max())] for i, k in enumerate('xyz')}
meta['area_xyz'] = [[float(np.median(pos[M['area'] == a, i])) for i in range(3)] for a in range(4)]
json.dump(meta, open(f'{OUT}/meta.json', 'w'), separators=(',', ':'))
# ---------------------------------------------------------------- reference run for the JS port
Wm, _ = build(**GAINS)
frames = [np.full((H_IMG, W_IMG), 0.5)] * 3 + [grating(30, 2 * np.pi * 2 * t * 0.02) for t in range(12)]
R, _ = run(Wm, frames, **RUN)
pick = np.linspace(0, N - 1, 400).astype(int)
json.dump(dict(frames=[np.round(fr, 6).ravel().tolist() for fr in frames], pick=pick.tolist(), r=np.round(R[:, pick], 6).tolist(),
               mean=R.mean(1).tolist()), open(os.path.join(BUILD, 'ref.json'), 'w'))
print('exported', N, 'cells', len(src), 'edges; inherited ori', inh_ok.sum(), 'inherited rf', inh_rf.sum(), 'mean r last', R[-1].mean())
