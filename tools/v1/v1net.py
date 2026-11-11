"""Assemble the Allen biorealistic V1 core (core_nll_0, bio_trained weights) into normalised arrays, following
V1_GLIF_model (load_sparse.py, models.py): voltages scaled so E_L = 0, V_th = 1; weights / (V_th - E_L) of the target;
each synapse projects onto 4 alpha basis functions (synaptic_data/basis_function_weights.csv); delays rounded to 1 ms."""
import json, os, numpy as np, pandas as pd, h5py
NET = os.environ.get('V1_NET', 'core_nll_0')          # extracted Allen network folder (network/, components/)
BASIS_CSV = os.environ.get('V1_BASIS_CSV', 'V1_GLIF_model/synaptic_data/basis_function_weights.csv')
TAU_BASIS = np.array([0.98958772, 1.88019093, 3.62895928, 5.65340431])     # synaptic_data/tau_basis.npy
DT = 1.0

def edge_table(fn, grp, types_csv, target_type_of, basis_index, pre_types=None):
    E = h5py.File(fn, 'r')['edges'][grp]
    src = E['source_node_id'][:].astype(np.int32); tgt = E['target_node_id'][:].astype(np.int32)
    et = E['edge_type_id'][:].astype(np.int32); w = E['0/syn_weight'][:].astype(np.float64)
    T = pd.read_csv(types_csv, sep=' ')
    lut_delay = np.zeros(et.max() + 1); lut_syn = np.zeros(et.max() + 1, np.int16)
    for _, row in T.iterrows():
        lut_delay[row.edge_type_id] = row.delay; lut_syn[row.edge_type_id] = basis_index[row.dynamics_params.replace('.json', '')]
    return src, tgt, w, lut_delay[et], lut_syn[et]

def build(net=NET, weights='bio_trained'):
    nd = h5py.File(f'{net}/network/v1_nodes.h5', 'r')['nodes/v1']
    ntid = nd['node_type_id'][:].astype(np.int64); N = len(ntid)
    pos = np.stack([nd['0/x'][:], nd['0/y'][:], nd['0/z'][:]], 1).astype(np.float32); tuning = nd['0/tuning_angle'][:].astype(np.float32)
    NT = pd.read_csv(f'{net}/network/v1_node_types.csv', sep=' ')
    tid = {t: i for i, t in enumerate(NT.node_type_id)}; ttype = np.array([tid[t] for t in ntid], np.int16)
    prm = []
    for _, r in NT.iterrows():
        p = json.load(open(f'{net}/components/cell_models/{r.dynamics_params}'))
        prm.append(dict(V_th=p['V_th'], E_L=p['E_L'], g=p['g'], C_m=p['C_m'], t_ref=p['t_ref'], k=p['asc_decay'], asc=p['asc_amps']))
    vscale = np.array([p['V_th'] - p['E_L'] for p in prm])
    B = pd.read_csv(BASIS_CSV, index_col=0); bidx = {n: i for i, n in enumerate(B.index)}; basis = B.values.astype(np.float64)
    out = dict(N=N, pos=pos, tuning=tuning, ttype=ttype, pop=np.array(list(NT.pop_name), dtype='U16'), ei=np.array(list(NT.ei), dtype='U2'),
               location=np.array(list(NT.location), dtype='U12'), basis=basis, basis_names=np.array(list(B.index), dtype='U24'), vscale=vscale,
               tau_m=np.array([p['C_m'] / p['g'] for p in prm]), g=np.array([p['g'] for p in prm]), C=np.array([p['C_m'] for p in prm]),
               t_ref=np.array([p['t_ref'] for p in prm]), k=np.array([p['k'] for p in prm]), asc=np.array([p['asc'] for p in prm]) / vscale[:, None])
    sfx = '' if weights == 'plain' else f'_{weights}'
    for name, fn, grp, types in [('rec', f'v1_v1_edges{sfx}.h5', 'v1_to_v1', 'v1_v1_edge_types.csv'),
                                 ('lgn', 'lgn_v1_edges.h5', 'lgn_to_v1', 'lgn_v1_edge_types.csv'),
                                 ('bkg', f'bkg_v1_edges{sfx}.h5', 'bkg_to_v1', 'bkg_v1_edge_types.csv')]:
        s, t, w, d, syn = edge_table(f'{net}/network/{fn}', grp, f'{net}/network/{types}', None, bidx)
        out[f'{name}_src'], out[f'{name}_tgt'] = s, t
        out[f'{name}_w'] = (w / vscale[ttype[t]]).astype(np.float32)
        out[f'{name}_syn'] = syn
        steps = np.round(np.clip(d, DT, np.ceil(d.max())) / DT).astype(np.int8) if name == 'rec' else None
        if name == 'rec': out['rec_delay'] = steps
        else:
            st = np.round(np.maximum(d, DT) / DT).astype(int); out[f'{name}_delay'] = int(np.bincount(st).argmax())
    return out

if __name__ == '__main__':
    import time; t = time.time(); m = build()
    print('built in', round(time.time() - t), 's; N', m['N'], 'rec', len(m['rec_w']), 'lgn', len(m['lgn_w']), 'bkg', len(m['bkg_w']),
          'delays', np.bincount(m['rec_delay']), 'lgn delay', m['lgn_delay'], 'bkg delay', m['bkg_delay'])
    print('types', len(m['pop']), sorted(set(m['pop']))[:30])
    np.savez('core.npz', **m)
