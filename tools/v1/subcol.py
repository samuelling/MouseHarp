"""Cut the central radius-R sub-column out of the full core. Inside neurons keep all their LGN and background input and
their recurrent input from inside; input they received from outside is aggregated per presynaptic cell class (22 classes)
and basis into W_out[i, c, b], to be driven by a mean-field stand-in for the outer annulus."""
import sys, numpy as np
R = float(sys.argv[1]) if len(sys.argv) > 1 else 200.0
m = dict(np.load('core.npz', allow_pickle=False))
pos = m['pos']; inside = np.hypot(pos[:, 0], pos[:, 2]) < R
new = -np.ones(m['N'], np.int64); new[inside] = np.arange(inside.sum())
pops = sorted(set(m['pop'])); cls = np.array([pops.index(p) for p in m['pop'][m['ttype']]], np.int16)
out = {k: v for k, v in m.items() if not k.startswith(('rec_', 'lgn_', 'bkg_'))}
out['N'] = int(inside.sum()); out['pos'] = pos[inside]; out['tuning'] = m['tuning'][inside]; out['ttype'] = m['ttype'][inside]
out['lgn_delay'], out['bkg_delay'] = m['lgn_delay'], m['bkg_delay']
s, t = m['rec_src'], m['rec_tgt']; tin = inside[t]; both = tin & inside[s]; drop = tin & ~inside[s]
for k in ['w', 'syn', 'delay']: out[f'rec_{k}'] = m[f'rec_{k}'][both]
out['rec_src'], out['rec_tgt'] = new[s[both]].astype(np.int32), new[t[both]].astype(np.int32)
for p in ['lgn', 'bkg']:
    keep = inside[m[f'{p}_tgt']]
    out[f'{p}_src'], out[f'{p}_tgt'] = m[f'{p}_src'][keep], new[m[f'{p}_tgt'][keep]].astype(np.int32)
    out[f'{p}_w'], out[f'{p}_syn'] = m[f'{p}_w'][keep], m[f'{p}_syn'][keep]
# dropped recurrent input, by (target, presynaptic class, basis)
C = len(pops); basis = m['basis']
wb = m['rec_w'][drop][:, None] * basis[m['rec_syn'][drop]]
key = new[t[drop]] * C + cls[s[drop]]
W_out = np.stack([np.bincount(key, wb[:, b], out['N'] * C) for b in range(4)], -1).reshape(out['N'], C, 4)
Q_out = np.stack([np.bincount(key, wb[:, b] ** 2, out['N'] * C) for b in range(4)], -1).reshape(out['N'], C, 4)
out['Q_out'] = Q_out.astype(np.float32)
out['W_out'] = W_out.astype(np.float32); out['cls'] = cls[inside]; out['cls_full'] = cls; out['pops'] = np.array(pops, dtype='U16')
out['inside_idx'] = np.nonzero(inside)[0]
np.savez(f'sub{int(R)}.npz', **out)
fin = np.bincount(out['rec_tgt'], np.abs(out['rec_w']), out['N']); fdr = np.abs(W_out.sum(2)).sum(1)
print(f'R={R}: N={out["N"]}, rec {len(out["rec_w"])/1e6:.2f}M, lgn {len(out["lgn_w"])/1e6:.2f}M, kept |w| share median {np.median(fin / (fin + fdr + 1e-9)):.2f}')
