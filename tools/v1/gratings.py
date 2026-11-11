"""Full-core reference: drifting gratings (0.04 cpd, 2 Hz, contrast 0.8, as in the Brain Observatory) in 8 directions."""
import sys, time, numpy as np; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import lgn as LG, v1sim
L = dict(np.load('lgn_params.npz')); L['kern'] = {int(b): L[f'kern_{b}'] for b in L['kern_bins']}
def grating_movie(theta, T=2500, pre=500, cpd=0.04, tf=2.0, c=0.8):
    yy, xx = np.mgrid[0:LG.ROWS, 0:LG.COLS].astype(float); th = np.pi * (180 - theta) / 180
    xy = xx * np.cos(th) + yy * np.sin(th); mv = np.zeros((T, LG.ROWS, LG.COLS))
    for t in range(pre, T): mv[t] = c * np.sin(2 * np.pi * (cpd * xy + tf * (t - pre) / 1000.0) + np.pi)
    return mv
if __name__ == '__main__':
    sub = sys.argv[1] if len(sys.argv) > 1 else 'full'
    m = dict(np.load('core.npz' if sub == 'full' else f'{sub}.npz', allow_pickle=False))
    mode = sys.argv[2] if len(sys.argv) > 2 else None
    rho0 = None
    if mode:
        grey = np.load('grey_rates.npy'); cf = m['cls_full']; rho0 = np.array([grey[cf == c].mean() for c in range(len(m['pops']))]) / 1000.0
    S = v1sim.V1Sim(m, seed=1, closure='dynamic' if mode == 'pnd' else ('grey' if mode == 'pn' else mode), rho0=rho0)
    if mode in ('pn', 'pnd'):
        full = dict(np.load('core.npz', allow_pickle=False)); rate = np.load('grey_rates.npy').astype(float) / 1000.0
        inside = np.zeros(full['N'], bool); inside[m['inside_idx']] = True; new = -np.ones(full['N'], int); new[inside] = np.arange(inside.sum())
        drop = inside[full['rec_tgt']] & ~inside[full['rec_src']]; N = int(m['N']); C = len(m['pops'])
        wb = full['rec_w'][drop][:, None] * full['basis'][full['rec_syn'][drop]]; key = new[full['rec_tgt'][drop]] * C + m['cls_full'][full['rec_src'][drop]]
        rj = rate[full['rec_src'][drop]]
        S.Mc = np.stack([np.bincount(key, wb[:, b] * rj, N * C) for b in range(4)], -1).reshape(N, C, 4)
        S.Vc = np.stack([np.bincount(key, wb[:, b] ** 2 * rj, N * C) for b in range(4)], -1).reshape(N, C, 4)
        if mode == 'pn': S.closure = 'noise'; S.mu_out = S.Mc.sum(1); S.sd_out = np.sqrt(S.Vc.sum(1))
        else: S.closure = 'pnd'
        # inside grey rates per class, for the dynamic scaling
        gr = rate[m['inside_idx']]; S.rho0 = np.maximum(np.array([gr[m['cls'] == c].mean() for c in range(C)]), 1e-5); S.reset_state()
        del full
    out = []
    for th in range(0, 360, 45):
        t = time.time(); R = LG.rates(L, grating_movie(th)); tl = time.time() - t
        S.reset_state(); tot, rec = v1sim.run(S, R, record=lambda s: s.nonzero()[0].astype(np.int32))
        cnt = np.zeros(S.N); [np.add.at(cnt, r, 1) for r in rec[1000:]]; out.append(cnt / 1.5)
        print(f'dir {th}: lgn {tl:.0f}s, mean rate {out[-1].mean():.2f} Hz', flush=True)
    np.save(f'grating_rates_{sub}_{mode}.npy' if sub != 'full' else 'grating_rates_full.npy', np.array(out))
