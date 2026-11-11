"""Sub-column with proxies: every synapse from a neuron outside radius R is rewired to come from a randomly chosen inside
neuron of the same node type and similar preferred orientation (tuning angle within +-15 deg, circular), keeping its
weight, synapse model and delay. Live activity of the proxies stands in for the missing ring."""
import sys, numpy as np
R = float(sys.argv[1]) if len(sys.argv) > 1 else 200.0
m = dict(np.load('core.npz', allow_pickle=False)); s = dict(np.load(f'sub{int(R)}.npz', allow_pickle=False))
inside = np.zeros(m['N'], bool); inside[s['inside_idx']] = True; new = -np.ones(m['N'], np.int64); new[inside] = np.arange(inside.sum())
rng = np.random.default_rng(0); tt = m['ttype']; proxy = np.full(m['N'], -1, np.int64)
# response fingerprint of every neuron in the full column: grey-screen rate + rates to 8 grating directions (sqrt-compressed)
fp = np.sqrt(np.vstack([np.load('grey_rates.npy')[None].astype(float), np.load('grating_rates_full.npy')]).T)
for t in np.unique(tt[~inside]):
    cand = np.nonzero(inside & (tt == t))[0]; outs = np.nonzero(~inside & (tt == t))[0]
    if len(cand) == 0: continue
    from scipy.spatial import cKDTree
    _, nn = cKDTree(fp[cand]).query(fp[outs] + 1e-6 * rng.standard_normal(fp[outs].shape), k=min(3, len(cand)))
    nn = nn.reshape(len(outs), -1); proxy[outs] = cand[nn[np.arange(len(outs)), rng.integers(0, nn.shape[1], len(outs))]]
src, tgt = m['rec_src'], m['rec_tgt']; drop = inside[tgt] & ~inside[src] & (proxy[src] >= 0)
s['rec_src'] = np.concatenate([s['rec_src'], new[proxy[src[drop]]]]).astype(np.int32)
s['rec_tgt'] = np.concatenate([s['rec_tgt'], new[tgt[drop]]]).astype(np.int32)
for k in ['w', 'syn', 'delay']: s[f'rec_{k}'] = np.concatenate([s[f'rec_{k}'], m[f'rec_{k}'][drop]])
print(f'proxied {drop.sum()/1e6:.2f}M synapses; recurrent now {len(s["rec_w"])/1e6:.2f}M; unmapped {(inside[tgt] & ~inside[src] & (proxy[src] < 0)).sum()}')
np.savez(f'sub{int(R)}p.npz', **s)
