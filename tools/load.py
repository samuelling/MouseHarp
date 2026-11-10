import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('MICRONS_DATA', os.path.join(HERE, 'microns_data'))   # downloaded source files
BUILD = os.environ.get('MOUSEHARP_BUILD', os.path.join(HERE, 'build'))      # intermediate arrays
WEB = os.path.join(HERE, '..', 'data')
os.makedirs(BUILD, exist_ok=True)
import h5py, numpy as np, pandas as pd, sys
sys.path.insert(0, HERE); import safe_pickle as sp
H = os.path.join(DATA, 'connectome_v1412.h5')
def vertices():
    f = h5py.File(H, 'r'); g = f['connectivity/condensed/vertex_properties']; t = g['table'][:]
    cat = lambda k: {i: s.decode() for i, s in g['meta'][f'values_block_{k}']['meta']['table'][:]}
    v = pd.DataFrame({'layer': [cat(0)[x] for x in t['values_block_0'][:, 0]], 'mtype': [cat(1)[x] for x in t['values_block_1'][:, 0]],
                      'syn': [cat(2)[x] for x in t['values_block_2'][:, 0]]})
    v['volume'], v['x'], v['y'], v['z'] = t['values_block_5'].T
    v['root'], v['sv'], v['x_nm'], v['y_nm'], v['z_nm'] = t['values_block_6'].T
    v['st_dend'], v['st_axon'] = [s.decode() for s in t['values_block_7'][:, 0]], [s.decode() for s in t['values_block_7'][:, 1]]
    return v
def edges():
    f = h5py.File(H, 'r'); ij = f['connectivity/condensed/edge_indices/block0_values'][:]; c = f['connectivity/condensed/edges/block0_values'][:, 0]
    cols = [s.decode() for s in f['connectivity/condensed/edge_indices/block0_items'][:]]
    return ij[:, cols.index('row')], ij[:, cols.index('col')], c, cols
def func(): return sp.load(os.path.join(DATA, 'node_data_v1.pkl'))
