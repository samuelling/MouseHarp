import sys, numpy as np; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import v1sim
from osi import grp
m = dict(np.load('core.npz', allow_pickle=False)); L = dict(np.load('lgn_params.npz'))
p = -np.expm1(-(L['spont'] * np.where(L['comp'], 2, 1)) / 1000.0)
F = v1sim.V1Sim(m, seed=5); rng = np.random.default_rng(11)
for k in range(800): F.step(rng.random(len(p)) < p)
s = dict(np.load('sub200p.npz', allow_pickle=False)); idx = s['inside_idx']
g = np.array([grp(q) for q in m['pop'][m['ttype']][idx]]); r = np.hypot(s['pos'][:, 0], s['pos'][:, 2]) < 150
snap = dict(v=F.v[idx], r=F.r[idx], asc=F.asc[idx], rise=F.rise[idx], psc=F.psc[idx], z=F.z[idx])
np.savez('warm_state_sub200.npz', **snap)
for label, warm in [('cold', False)]:
    S = v1sim.V1Sim(s, seed=7)
    if warm:
        for k, v in snap.items(): setattr(S, k, v.copy())
    cnt = np.zeros(S.N); traces = []
    for k in range(2000):
        sp = S.step(rng.random(len(p)) < p); cnt += sp if k >= 500 else 0
        if k % 250 == 249: traces.append(round(float(sp[(g == 'L6 Exc')].mean() * 1000 if False else cnt[(g == 'L6 Exc') & r].sum()), 1))
    print(label, {k: round(float(cnt[(g == k) & r].mean() / 1.5), 2) for k in ['L2/3 Exc', 'L4 Exc', 'L5 Exc', 'L6 Exc', 'L6 PV', 'L6 SST']})
