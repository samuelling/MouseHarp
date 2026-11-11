import numpy as np, pandas as pd, sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from osi import table
m = np.load('core.npz'); s = np.load('sub200.npz'); pops = m['pop'][m['ttype']]
F = np.load('grating_rates_full.npy'); idx = s['inside_idx']
r = np.hypot(s['pos'][:, 0], s['pos'][:, 2])
cols = {}
for name, fn in [('full', None), ('proxy', 'grating_rates_sub200p_None.npy'), ('8-bit', 'grating_rates_v1_dequant_None.npy')]:
    try: R = F[:, idx] if fn is None else np.load(fn)
    except FileNotFoundError: continue
    T = table(R, pops[idx], mask=r < 150); cols[name] = T
out = pd.concat({k: v[['rate', 'OSI']] for k, v in cols.items()}, axis=1).round(2); print(out.to_string())
