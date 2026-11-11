"""Export the proxy sub-column (R = 200 um) of the Allen V1 core for the browser.
data/v1meta.json   constants, lookup tables, LGN unit parameters
data/v1net.bin     recurrent + LGN synapses (CSR by source; varint target deltas; 8-bit log weights), background
data/v1cells.bin   positions, tuning angle, node type, class, starting state
data/v1lgn.bin     LGN temporal kernels at 10 ms resolution
Also writes v1_dequant.npz (the network with the quantised weights) for checking the quantisation in Python."""
import sys, json, numpy as np; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import v1sim
OUT = sys.argv[1]
s = dict(np.load('sub200p.npz', allow_pickle=False)); L = dict(np.load('lgn_params.npz'))
N = int(s['N']); P = v1sim.propagators(s); pops = [str(p) for p in s['pops']]; C = len(pops); NT = len(s['pop'])
def varint(a):
    out = bytearray()
    for v in a.tolist():
        while v >= 128: out.append((v & 127) | 128); v >>= 7
        out.append(v)
    return bytes(out)
def csr(src, tgt, w, nsrc, lo, hi):
    o = np.lexsort((tgt, src)); src, tgt, w = src[o], tgt[o], np.abs(w[o])
    ptr = np.zeros(nsrc + 1, np.int64); np.add.at(ptr, src + 1, 1); ptr = np.cumsum(ptr)
    d = tgt.astype(np.int64).copy(); first = ptr[:-1][np.diff(ptr) > 0]; d[1:] -= tgt[:-1]; d[first] = tgt[first]
    q = np.clip(np.round((np.log(np.maximum(w, 1e-12)) - lo) / (hi - lo) * 255), 0, 255).astype(np.uint8)
    wq = np.exp(lo + q.astype(np.float64) / 255 * (hi - lo))
    return ptr.astype(np.uint32), varint(d), q, (src, tgt, wq)
# ---- recurrent: sign from presynaptic class; synapse model and delay from (source class, target node type)
rs, rt = s['rec_src'].astype(np.int64), s['rec_tgt'].astype(np.int64); scls = s['cls'][rs]
syn_lut = np.zeros((C, NT), np.int16); del_lut = np.ones((C, NT), np.int8)
syn_lut[scls, s['ttype'][rt]] = s['rec_syn']; del_lut[scls, s['ttype'][rt]] = s['rec_delay']
inh_cls = np.array([p.startswith('i') for p in pops])
rlo, rhi = np.log(1e-3), np.log(np.abs(s['rec_w']).max())
rptr, rdel, rq, (rs2, rt2, rwq) = csr(rs, rt, s['rec_w'], N, rlo, rhi)
# ---- LGN: only units that reach the column; synapse model from target node type
used = np.unique(s['lgn_src']); lmap = -np.ones(17400, np.int64); lmap[used] = np.arange(len(used))
lsyn = np.zeros(NT, np.int16); lsyn[s['ttype'][s['lgn_tgt']]] = s['lgn_syn']
llo, lhi = np.log(np.abs(s['lgn_w']).min()), np.log(np.abs(s['lgn_w']).max())
lptr, ldel, lq, (ls2, lt2, lwq) = csr(lmap[s['lgn_src']], s['lgn_tgt'].astype(np.int64), s['lgn_w'], len(used), llo, lhi)
# ---- background: 4 edges per neuron
bo = np.argsort(s['bkg_tgt'], kind='stable'); assert np.all(np.bincount(s['bkg_tgt'], minlength=N) == 4)
bsrc = s['bkg_src'][bo].astype(np.uint8); bw = s['bkg_w'][bo].astype(np.float32)
bsyn = np.zeros(NT, np.int16); bsyn[s['ttype'][s['bkg_tgt']]] = s['bkg_syn']
with open(f'{OUT}/v1net.bin', 'wb') as f:
    sec = {}
    def put(name, b): sec[name] = [f.tell(), len(b)]; f.write(b); f.write(b'\0' * ((-f.tell()) % 4))
    put('rec_ptr', rptr.tobytes()); put('rec_tgt', rdel); put('rec_w', rq.tobytes())
    put('lgn_ptr', lptr.tobytes()); put('lgn_tgt', ldel); put('lgn_w', lq.tobytes())
    put('bkg_src', bsrc.tobytes()); put('bkg_w', bw.tobytes())
# ---- cells
inside = s['inside_idx']; full = np.load('core.npz', allow_pickle=False)
warm = np.load('warm_state_sub200.npz')
with open(f'{OUT}/v1cells.bin', 'wb') as f:
    f.write(s['pos'].astype(np.float32).tobytes()); f.write(s['tuning'].astype(np.float32).tobytes())
    f.write(warm['v'].astype(np.float32).tobytes())
    f.write(s['ttype'].astype(np.uint8).tobytes()); f.write(s['cls'].astype(np.uint8).tobytes())
# ---- LGN units: 10 ms kernels (sum of the 1 ms kernel over each bin; index 0 = the most recent 10 ms)
def k10(K):
    K = K[:, ::-1]; nb = int(np.ceil(K.shape[1] / 10)); K = np.pad(K, ((0, 0), (0, nb * 10 - K.shape[1])))
    return K.reshape(K.shape[0], nb, 10).sum(2)
dom10 = k10(L['dom'][used]); nd10 = k10(L['nd'][used]); comp = L['comp'][used]
with open(f'{OUT}/v1lgn.bin', 'wb') as f:
    f.write(dom10.astype(np.float32).tobytes()); f.write(nd10[comp].astype(np.float32).tobytes())
lgn_meta = dict(n=int(len(used)), taps=int(dom10.shape[1]), x=L['x'][used].round(4).tolist(), y=L['y'][used].round(4).tolist(),
                ndx=L['ndx'][used].round(4).tolist(), ndy=L['ndy'][used].round(4).tolist(), sbin=L['sbin'][used].astype(int).tolist(),
                amp=L['amp'][used].round(6).tolist(), amp_nd=L['amp_nd'][used].round(6).tolist(), spont=L['spont'][used].round(5).tolist(),
                comp=comp.astype(int).tolist(), model=[str(x) for x in L['model'][used]], full_id=used.tolist(),
                sigma={int(b): (int(b) + 0.5) / 3.0 for b in np.unique(L['sbin'][used])},
                kR={int(b): int((L[f'kern_{b}'].shape[0] - 1) // 2) for b in L['kern_bins']})
types = dict(decay=P['decay'], A=P['A'], B=P['B'], D=P['D'], reset=P['reset'], asc_spike=P['asc_spike'], asc_jump=P['asc_jump'],
             asc_decay=P['asc_decay'], tref=P['t_ref_steps'])
meta = dict(N=N, NT=NT, C=C, pops=pops, type_pop=[str(p) for p in s['pop']], inh_cls=inh_cls.astype(int).tolist(),
            types={k: np.asarray(v).round(9).tolist() for k, v in types.items()}, syn_decay=P['syn_decay'].tolist(), psc_init=P['psc_init'].tolist(),
            basis=s['basis'].round(9).tolist(), basis_names=[str(b) for b in s['basis_names']],
            rec_syn=syn_lut.tolist(), rec_delay=del_lut.tolist(), lgn_syn=lsyn.tolist(), bkg_syn=bsyn.tolist(),
            lgn_delay=int(s['lgn_delay']), bkg_delay=int(s['bkg_delay']), bkg_rate=250.0,
            quant=dict(rec=[float(rlo), float(rhi)], lgn=[float(llo), float(lhi)]), sections=sec, E=dict(rec=int(len(rq)), lgn=int(len(lq))), lgn=lgn_meta,
            screen=[120, 80], radius_um=200, full=dict(N=int(full['N']), rec=int(len(full['rec_w'])), lgn=int(len(full['lgn_w']))))
json.dump(meta, open(f'{OUT}/v1meta.json', 'w'), separators=(',', ':'))
# ---- dequantised network for the Python check
d = dict(s); sign_r = np.where(inh_cls[s['cls'][rs2]], -1.0, 1.0)
d['rec_src'], d['rec_tgt'], d['rec_w'] = rs2.astype(np.int32), rt2.astype(np.int32), (rwq * sign_r).astype(np.float32)
d['rec_syn'] = syn_lut[s['cls'][rs2], s['ttype'][rt2]]; d['rec_delay'] = del_lut[s['cls'][rs2], s['ttype'][rt2]]
d['lgn_src'], d['lgn_tgt'], d['lgn_w'], d['lgn_syn'] = used[ls2].astype(np.int32), lt2.astype(np.int32), lwq.astype(np.float32), lsyn[s['ttype'][lt2]]
np.savez('v1_dequant.npz', **d)
import os
print('sizes MB:', {f: round(os.path.getsize(f'{OUT}/{f}') / 1e6, 1) for f in ['v1net.bin', 'v1cells.bin', 'v1lgn.bin', 'v1meta.json']})
print('recurrent negative-sign check (should match inhibitory share):', (s['rec_w'] < 0).mean().round(3), inh_cls[s['cls'][rs]].mean().round(3))
# receptive-field centre (LGN-weighted, deg), preferred orientation in grating-theta convention (= -tuning angle), full-column OSI
r = np.load('v1_rf.npz'); idx = s['inside_idx']
with open(f'{OUT}/v1rf.bin', 'wb') as f:
    f.write(r['rx'][idx].astype(np.float32).tobytes()); f.write(r['ry'][idx].astype(np.float32).tobytes())
    f.write(((-s['tuning']) % 180).astype(np.float32).tobytes()); f.write(np.clip(r['osi'][idx], 0, 1).astype(np.float32).tobytes())
