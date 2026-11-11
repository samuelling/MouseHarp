import sys, numpy as np, pandas as pd
def osi_dsi(R):                          # R: 8 directions x N (Hz)
    th = np.deg2rad(np.arange(0, 360, 45))[:, None]; s = R.sum(0) + 1e-9
    return np.abs((R * np.exp(2j * th)).sum(0)) / s, np.abs((R * np.exp(1j * th)).sum(0)) / s
def grp(p):
    lay = '23' if p[1:3] == '23' else p[1]; L = {'1': 'L1', '23': 'L2/3', '4': 'L4', '5': 'L5', '6': 'L6'}[lay]
    t = 'Exc' if p[0] == 'e' else {'Pvalb': 'PV', 'Sst': 'SST', 'Vip': 'VIP', 'Htr3a': 'VIP'}[p[1 + len(lay):]]
    return f'{L} {t}'
def table(R, pops, mask=None):
    o, d = osi_dsi(R); g = np.array([grp(p) for p in pops]); rows = {}
    for k in sorted(set(g)):
        s = (g == k) if mask is None else (g == k) & mask
        rows[k] = dict(rate=R[:, s].mean(), OSI=np.median(o[s]), DSI=np.median(d[s]))
    return pd.DataFrame(rows).T
if __name__ == '__main__':
    m = np.load('core.npz'); pops = m['pop'][m['ttype']]
    R = np.load('grating_rates_full.npy'); T = table(R, pops)
    d = pd.read_csv(__import__('os').environ.get('V1_GLIF_REPO', 'V1_GLIF_model') + '/Neuropixels_data/OSI_DSI_neuropixels_v4.csv', sep=' ')
    E = d.groupby('cell_type')[['Ave_Rate(Hz)', 'OSI', 'DSI']].median().rename(columns=lambda c: 'np_' + c)
    print(T.join(E).round(2).to_string())
