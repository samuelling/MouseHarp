"""Assemble the MouseHarp network from MICrONS (v1412 connectome, Zenodo 16744240) + digital-twin function
(Ding et al. 2025 node table). Writes model.npz with everything the simulator and the web app need."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('MICRONS_DATA', os.path.join(HERE, 'microns_data'))   # downloaded source files
BUILD = os.environ.get('MOUSEHARP_BUILD', os.path.join(HERE, 'build'))      # intermediate arrays
WEB = os.path.join(HERE, '..', 'data')
os.makedirs(BUILD, exist_ok=True)

import sys, numpy as np, pandas as pd
sys.path.insert(0, HERE)
from load import vertices, edges, func
from scipy.spatial import cKDTree

v = vertices(); d = func(); N = len(v)
# --- function: exact nucleus-position match (11,484 of 12,894; the rest lie in the excluded periphery)
V = v[['x_nm', 'y_nm', 'z_nm']].values / 1000.; F = d[['nucleus_x', 'nucleus_y', 'nucleus_z']].values / 1000.
dist, idx = cKDTree(V).query(F); ok = dist < 1.0
has_f = np.zeros(N, bool); has_f[idx[ok]] = True
ori = np.full(N, np.nan); osi = np.zeros(N); rf = np.full((N, 2), np.nan); area_f = np.full(N, '', object); cc = np.zeros(N)
dd = d[ok]; ii = idx[ok]
ori[ii] = dd.pref_ori_cvt_monet_full.values % 180; osi[ii] = dd.gosi_cvt_monet_full.values
rf[ii] = np.stack(dd.position_stim_cvt.values); area_f[ii] = dd.brain_area.astype(str).values; cc[ii] = dd.cc_abs_cvt.values
# --- area for every neuron: vote of the 15 nearest functional cells across the cortical sheet (x, z; y is depth)
P2 = v[['x', 'z']].values
tf = cKDTree(P2[has_f]); _, nn = tf.query(P2, k=15)
AREAS = ['V1', 'RL', 'AL', 'LM']
lab = np.array([AREAS.index(a) for a in area_f[has_f]])
votes = np.stack([(lab[nn] == a).sum(1) for a in range(4)], 1); area = votes.argmax(1)
area[has_f] = lab  # measured label wins
# --- cell groups: excitatory by layer, inhibitory by targeting class (Schneider-Mizell et al. 2025)
def group(mt):
    if mt.startswith('L2') or mt.startswith('L3'): return 0          # L2/3
    if mt.startswith('L4'): return 1
    if mt.startswith('L5'): return 2
    if mt.startswith('L6'): return 3
    return {'PTC': 4, 'DTC': 5, 'STC': 6, 'ITC': 7}[mt]
grp = np.array([group(m) for m in v.mtype.values]); inh = grp >= 4
# --- edges: keep connections with >= 2 synapses; rescale each neuron's kept E and I input to its full totals
pre, post, c, _ = edges()
c = c.astype(np.float64)
fullE = np.bincount(post, weights=c * ~inh[pre], minlength=N); fullI = np.bincount(post, weights=c * inh[pre], minlength=N)
keep = c >= 2; pre_k, post_k, c_k = pre[keep], post[keep], c[keep]
keptE = np.bincount(post_k, weights=c_k * ~inh[pre_k], minlength=N); keptI = np.bincount(post_k, weights=c_k * inh[pre_k], minlength=N)
sE = np.where(keptE > 0, fullE / np.maximum(keptE, 1), 0); sI = np.where(keptI > 0, fullI / np.maximum(keptI, 1), 0)
w_k = c_k * np.where(inh[pre_k], sI[post_k], sE[post_k])       # unsigned, in "synapse" units
order = np.lexsort((pre_k, post_k)); pre_k, post_k, w_k, c_k = pre_k[order], post_k[order], w_k[order], c_k[order]
rowptr = np.zeros(N + 1, np.int64); np.add.at(rowptr, post_k + 1, 1); rowptr = np.cumsum(rowptr)
# --- inherited orientation for cells without function: synapse-weighted circular mean over functional E inputs
fE = has_f[pre] & ~inh[pre]
z = np.exp(2j * np.deg2rad(np.nan_to_num(ori[pre[fE]]))) * c[fE] * np.maximum(osi[pre[fE]], 0.05)
acc = np.zeros(N, complex); np.add.at(acc, post[fE], z); wsum = np.bincount(post[fE], weights=c[fE] * np.maximum(osi[pre[fE]], 0.05), minlength=N)
inh_ori = np.rad2deg(np.angle(acc) / 2) % 180; inh_str = np.abs(acc) / np.maximum(wsum, 1e-9); n_fin = np.bincount(post[fE], weights=c[fE], minlength=N)
np.savez_compressed(os.path.join(BUILD, 'model.npz'), N=N, pos=v[['x', 'y', 'z']].values.astype(np.float32), grp=grp, inh=inh, area=area,
    mtype=np.array(list(v.mtype), dtype='U12'), layer=np.array(list(v.layer), dtype='U4'), root=v.root.values, has_f=has_f, ori=ori, osi=osi, rf=rf, cc=cc,
    rowptr=rowptr, src=pre_k.astype(np.int32), w=w_k.astype(np.float32), cnt=c_k.astype(np.int16), fullE=fullE, fullI=fullI,
    inh_ori=inh_ori, inh_str=inh_str, n_fin=n_fin, st_axon=np.array(list(v.st_axon), dtype='U6'))
print('N', N, 'edges kept', keep.sum(), 'of', len(c), 'synapses kept', int(c_k.sum()), 'of', int(c.sum()))
print('functional', has_f.sum(), 'areas', np.bincount(area, minlength=4), 'groups', np.bincount(grp))
print('inherited-ori cells (>=5 functional E synapses)', ((n_fin >= 5) & ~has_f).sum())
