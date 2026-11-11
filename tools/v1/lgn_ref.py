import sys, json, numpy as np; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import lgn as LG
from gratings import grating_movie
L = dict(np.load('lgn_params.npz')); L['kern'] = {int(b): L[f'kern_{b}'] for b in L['kern_bins']}
meta = json.load(open('../../data/v1/v1meta.json')); used = np.array(meta['lgn']['full_id'])
mv = grating_movie(30, T=1200, pre=300)
R = LG.rates(L, mv)[:, used]
pick = np.linspace(0, len(used) - 1, 300).astype(int)
json.dump(dict(pick=pick.tolist(), rates=R[:, pick][::10].round(4).tolist(), mean=R.mean(1)[::10].round(4).tolist(),
               frames_theta=30, T=1200, pre=300), open('lgn_ref.json', 'w'))
# spatial-kernel shape check: compare BMTK 2-D kernels with separable Gaussians
for b, k in list(L['kern'].items())[:4]:
    s = (b + 0.5) / 3; R_ = (k.shape[0] - 1) // 2; x = np.arange(-R_, R_ + 1); g = np.exp(-x ** 2 / (2 * s * s)); G = np.outer(g, g)
    print(b, k.shape, 'max rel diff vs separable', np.abs(k / k.sum() - G / G.sum()).max() / (G / G.sum()).max())
print(g_deq := open('g_deq.log').read().strip().splitlines()[-1])
