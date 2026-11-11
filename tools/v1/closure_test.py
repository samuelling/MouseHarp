import sys, numpy as np; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import v1sim
from osi import grp
m = dict(np.load('core.npz', allow_pickle=False)); L = dict(np.load('lgn_params.npz'))
grey_lgn = L['spont'] * np.where(L['comp'], 2, 1); p = -np.expm1(-grey_lgn / 1000.0)
rate = np.load('grey_rates.npy').astype(float) / 1000.0                     # per-neuron spikes/ms, full column, grey
pos = m['pos']; inside = np.hypot(pos[:, 0], pos[:, 2]) < 200; new = -np.ones(m['N'], int); new[inside] = np.arange(inside.sum())
s = dict(np.load('sub200.npz', allow_pickle=False)); N = int(s['N'])
drop = inside[m['rec_tgt']] & ~inside[m['rec_src']]
wb = m['rec_w'][drop][:, None] * m['basis'][m['rec_syn'][drop]]; tg = new[m['rec_tgt'][drop]]; rj = rate[m['rec_src'][drop]]
mu = np.stack([np.bincount(tg, wb[:, b] * rj, N) for b in range(4)], 1); var = np.stack([np.bincount(tg, wb[:, b] ** 2 * rj, N) for b in range(4)], 1)
for label, scale_sd in [('per-neuron mean + noise', 1.0), ('per-neuron mean only', 0.0)]:
    S = v1sim.V1Sim(s, seed=5); S.closure = 'noise'; S.mu_out = mu; S.sd_out = np.sqrt(var) * scale_sd
    rng = np.random.default_rng(11); cnt = np.zeros(N)
    for k in range(1200):
        sp = S.step(rng.random(len(p)) < p)
        if k >= 400: cnt += sp
    g = np.array([grp(q) for q in m['pop'][m['ttype']][inside]]); r = np.hypot(s['pos'][:, 0], s['pos'][:, 2]) < 150
    print(label, {k: round(float(cnt[(g == k) & r].mean() / 0.8), 2) for k in ['L2/3 Exc', 'L4 Exc', 'L5 Exc', 'L6 Exc', 'L6 PV', 'L6 SST']})
