import sys, time, numpy as np; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import lgn as LG, v1sim
m = dict(np.load('core.npz', allow_pickle=False))
t = time.time(); L = LG.build(__import__('os').environ.get('V1_NET', 'core_nll_0') + '/network'); print('lgn built', round(time.time() - t, 1), 's; kernel length', L['dom'].shape[1])
np.savez('lgn_params.npz', **{k: v for k, v in L.items() if k != 'kern'}, kern_bins=np.array(sorted(L['kern'])), **{f'kern_{b}': k for b, k in L['kern'].items()})
t = time.time(); S = v1sim.V1Sim(m); print('sim built', round(time.time() - t, 1), 's')
grey = np.tile(L['spont'] * np.where(L['comp'], 2, 1), (1000, 1))      # grey screen: every unit at its spontaneous rate
t = time.time(); tot, _ = v1sim.run(S, grey); el = time.time() - t; print(f'1000 ms in {el:.1f} s')
t = time.time(); tot2, _ = v1sim.run(S, grey); print(f'second 1000 ms in {time.time()-t:.1f} s')
pop = m['pop'][m['ttype']]
print('spontaneous rates (Hz), second second:')
for p in sorted(set(pop)): print(f'  {p:10s} n={np.sum(pop == p):6d}  {tot2[pop == p].mean():6.2f}')
np.save('grey_rates.npy', tot2)
