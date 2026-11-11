import sys, numpy as np; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import v1sim
from osi import grp
m = dict(np.load('core.npz', allow_pickle=False)); L = dict(np.load('lgn_params.npz'))
grey_lgn = L['spont'] * np.where(L['comp'], 2, 1); p = -np.expm1(-grey_lgn / 1000.0)
T = 1200
# 1) full column on grey, recording all spikes and the LGN/bkg random streams
F = v1sim.V1Sim(m, seed=5); rng = np.random.default_rng(11); lgn_spk = []; spk_full = []
for k in range(T):
    ls = rng.random(len(p)) < p; lgn_spk.append(ls); spk_full.append(np.nonzero(F.step(ls))[0])
pos = m['pos']; inside = np.hypot(pos[:, 0], pos[:, 2]) < 200; new = -np.ones(m['N'], int); new[inside] = np.arange(inside.sum())
# 2) sub-column with the outside neurons' recorded spikes delivered through the dropped edges
s = dict(np.load('sub200.npz', allow_pickle=False)); S = v1sim.V1Sim(s, seed=5)
drop = inside[m['rec_tgt']] & ~inside[m['rec_src']]
D = v1sim.CSR(m['rec_src'][drop], new[m['rec_tgt'][drop]].astype(np.int32), m['rec_w'][drop], m['rec_syn'][drop], m['basis'], m['N'], m['rec_delay'][drop])
cnt_sub = np.zeros(S.N); cnt_full = np.zeros(m['N'])
for k in range(T):
    out_sp = spk_full[k][~inside[spk_full[k]]]
    S._deliver(D, out_sp, lambda d, t=S.t: (t + int(d)) % S.Dmax)     # recorded at step k, arrive at k + d
    sp = S.step(lgn_spk[k])
    if k >= 400: cnt_sub += sp; np.add.at(cnt_full, spk_full[k], 1)
pops = m['pop'][m['ttype']]; g = np.array([grp(q) for q in pops]); gi = g[inside]; r = np.hypot(s['pos'][:, 0], s['pos'][:, 2]) < 150
for k in sorted(set(g)):
    print(f'{k:9s} full {cnt_full[inside][(gi == k) & r].mean() / 0.8:6.2f}  sub+replay {cnt_sub[(gi == k) & r].mean() / 0.8:6.2f}')
