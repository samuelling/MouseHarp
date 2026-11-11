import numpy as np, json
m = np.load('core.npz'); R = np.load('grating_rates_full.npy'); L = dict(np.load('lgn_params.npz'))
th = np.deg2rad(np.arange(0, 360, 45))[:, None]; z1 = (R * np.exp(1j * th)).sum(0); z2 = (R * np.exp(2j * th)).sum(0)
pref_dir = np.rad2deg(np.angle(z1)) % 360; pref_ori = (np.rad2deg(np.angle(z2)) / 2) % 180
osi = np.abs(z2) / (R.sum(0) + 1e-9); tun = m['tuning']; sel = (osi > 0.3) & (R.max(0) > 2)
for off in [0, 90]:
    d = np.abs((pref_ori[sel] - (tun[sel] + off) % 180 + 90) % 180 - 90)
    print(f'tuning_angle + {off}: median |pref ori - tuning| = {np.median(d):.1f} deg (chance 45), n={sel.sum()}')
# receptive-field centre from LGN inputs (weight-averaged LGN unit positions, deg on the 120 x 80 screen)
w = m['lgn_w']; x = L['x'][m['lgn_src']]; y = L['y'][m['lgn_src']]; t = m['lgn_tgt']
sw = np.bincount(t, w, m['N']); print('neurons with LGN input', (sw > 0).mean().round(3))
rx = np.bincount(t, w * x, m['N']) / np.maximum(sw, 1e-9); ry = np.bincount(t, w * y, m['N']) / np.maximum(sw, 1e-9)
print('RF centre range x', np.percentile(rx[sw > 0], [1, 50, 99]).round(1), 'y', np.percentile(ry[sw > 0], [1, 50, 99]).round(1))
np.savez('v1_rf.npz', rx=rx, ry=ry, has=sw > 0, pref_ori=pref_ori, osi=osi)
