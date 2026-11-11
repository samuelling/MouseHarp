"""Load the MICrONS node/edge tables with a whitelisting unpickler (Python docs: 'Restricting Globals').
Only the pandas/numpy data classes these files reference may be constructed; anything else raises."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('MICRONS_DATA', os.path.join(HERE, 'microns_data'))   # downloaded source files
BUILD = os.environ.get('MOUSEHARP_BUILD', os.path.join(HERE, 'build'))      # intermediate arrays
WEB = os.path.join(HERE, '..', '..', 'microns', 'data')
os.makedirs(BUILD, exist_ok=True)

import pickle, numpy as np, pandas as pd, importlib
ALLOW = {
    ('pandas.core.frame', 'DataFrame'), ('pandas.core.internals.managers', 'BlockManager'),
    ('pandas._libs.internals', '_unpickle_block'), ('numpy.core.numeric', '_frombuffer'), ('numpy', 'dtype'),
    ('builtins', 'slice'), ('pandas._libs.arrays', '__pyx_unpickle_NDArrayBacked'),
    ('pandas.core.arrays.categorical', 'Categorical'), ('pandas.core.dtypes.dtypes', 'CategoricalDtype'),
    ('pandas.core.indexes.base', '_new_Index'), ('pandas.core.indexes.base', 'Index'),
    ('numpy.core.multiarray', '_reconstruct'), ('numpy', 'ndarray'), ('pandas.core.indexes.numeric', 'Int64Index'),
    ('pandas.core.indexes.range', 'RangeIndex'), ('pandas.core.series', 'Series'),
}
REMAP = {('pandas.core.indexes.numeric', 'Int64Index'): ('pandas.core.indexes.base', 'Index')}
class Safe(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) not in ALLOW: raise pickle.UnpicklingError(f'blocked {module}.{name}')
        module, name = REMAP.get((module, name), (module, name))
        if module.startswith('numpy.core'):
            try: return getattr(importlib.import_module(module.replace('numpy.core', 'numpy._core')), name)
            except ImportError: pass
        return getattr(importlib.import_module(module), name)
def load(path):
    with open(path, 'rb') as f: return Safe(f).load()
