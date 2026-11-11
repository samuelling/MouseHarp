"""FilterNet LGN of the Allen biorealistic V1 model, reimplemented in numpy from the model's definition
(V1_GLIF_model/lgn_model/lgn.py, BMTK filternet). 17,400 units on a 120 x 80 deg screen (1 px = 1 deg):
Gaussian spatial filter, cosine-bump temporal kernel, rectified linear rate around a spontaneous rate;
ON/OFF two-subunit cells add a displaced non-dominant subunit. Rates in Hz at 1 ms resolution."""
import numpy as np, pandas as pd, h5py
from bmtk.simulator.filternet.lgnmodel.fitfuns import makeBasis_StimKernel
from bmtk.simulator.filternet.lgnmodel.temporalfilter import TemporalFilterCosineBump
from bmtk.simulator.filternet.lgnmodel.util_fns import get_tcross_from_temporal_kernel
from bmtk.simulator.filternet.lgnmodel.cellmetrics import get_data_metrics_for_each_subclass
from bmtk.simulator.filternet.lgnmodel.spatialfilter import GaussianSpatialFilter

ROWS, COLS = 80, 120

def _two_subunit(prs, ttp_exp):
    filt = TemporalFilterCosineBump(prs['opt_wts'], prs['opt_kpeaks'], prs['opt_delays'])
    k = filt.get_kernel(threshold=-1.0).kernel
    tcross = get_tcross_from_temporal_kernel(k); s = k[:tcross].sum()
    off = ttp_exp - tcross
    d = np.array(prs['opt_delays'], float); d[0] += off; d[1] += off
    return TemporalFilterCosineBump(prs['opt_wts'], prs['opt_kpeaks'], d), s

def build(net_dir):
    types = pd.read_csv(f'{net_dir}/lgn_node_types.csv', sep=' ')
    name_of = dict(zip(types.node_type_id, types.pop_name))
    f = h5py.File(f'{net_dir}/lgn_nodes.h5', 'r')['nodes/lgn']; g = f['0']
    model = np.array([name_of[t] for t in f['node_type_id'][:]])
    P = {k: g[k][:].astype(np.float64) for k in g.keys()}
    n = len(model)
    amp = np.array([1.0 if 'ON' in m else -1.0 for m in model]); amp_nd = np.zeros(n)
    comp = np.array([('ON' in m and 'OFF' in m) for m in model])
    spont = np.zeros(n)
    K = 700; dom = np.zeros((n, K)); nd = np.zeros((n, K))
    ndx = np.zeros(n); ndy = np.zeros(n)
    for i in range(n):
        m = model[i]
        kp = np.array([P['kpeaks_dom_0'][i], P['kpeaks_dom_1'][i]]); w = np.array([P['weight_dom_0'][i], P['weight_dom_1'][i]])
        dl = np.array([P['delay_dom_0'][i], P['delay_dom_1'][i]])
        if comp[i]:
            ndp = dict(opt_wts=np.array([P['weight_non_dom_0'][i], P['weight_non_dom_1'][i]]),
                       opt_kpeaks=np.array([P['kpeaks_non_dom_0'][i], P['kpeaks_non_dom_1'][i]]),
                       opt_delays=np.array([P['delay_non_dom_0'][i], P['delay_non_dom_1'][i]]))
            dp = dict(opt_wts=w, opt_kpeaks=kp, opt_delays=dl)
            if 'sONsOFF_001' in m:
                fn, sn = _two_subunit(ndp, 121.0); fd, sd = _two_subunit(dp, 115.0); sp, mroff, mron, c = 4.0, 35.0, 21.0, 1.0
            else:
                fn, sn = _two_subunit(ndp, 93.5); fd, sd = _two_subunit(dp, 64.8); sp, mroff, mron, c = 5.5, 46.0, 31.0, 0.7
            amp_nd[i] = 1.0
            amp[i] = -c * (mroff / mron) * (sn / sd) - (sp * (mroff - mron)) / (mron * sd)
            spont[i] = sp / 2.0
            th = np.deg2rad(P['tuning_angle'][i]); ndx[i] = np.cos(th) * P['sf_sep'][i] + P['x'][i]; ndy[i] = np.sin(th) * P['sf_sep'][i] + P['y'][i]
            dom[i, -len(fd.kernel_data):] = fd.kernel_data[::-1]; nd[i, -len(fn.kernel_data):] = fn.kernel_data[::-1]
        else:
            ct, tf_ = m[:m.find('_')], m[m.find('_') + 1:]
            spont[i] = get_data_metrics_for_each_subclass(ct)[tf_]['spont_exp'][0]
            dd = dict(neye=0, ncos=2, kpeaks=kp, b=0.3, delays=[dl.astype(int)])
            kd = np.dot(makeBasis_StimKernel(dd, 600), w); dom[i, -len(kd):] = kd
    # kernels stored oldest-sample-first (index -1 = current ms); trim the leading all-zero columns
    nz = np.where(np.abs(dom).sum(0) + np.abs(nd).sum(0) > 0)[0]; dom = dom[:, nz[0]:]; nd = nd[:, nz[0]:]
    x = np.clip(P['x'] * (COLS - 1) / COLS, 0, COLS - 1); y = np.clip(P['y'] * (ROWS - 1) / ROWS, 0, ROWS - 1)
    ndx = np.clip(ndx * (COLS - 1) / COLS, 0, COLS - 1); ndy = np.clip(ndy * (ROWS - 1) / ROWS, 0, ROWS - 1)
    # spatial filters: Gaussians binned by size (sigma = (bin + 0.5) / 3), normalised as BMTK does at the edges
    size = P['spatial_size']; sbin = np.floor(size).astype(int)
    sig = {b: (b + 0.5) / 3.0 for b in np.unique(sbin)}
    kern = {}
    for b, s in sig.items():
        k = GaussianSpatialFilter(translate=(0., 0.), sigma=(s, s), origin=(0., 0.)).get_kernel(np.arange(-50, 51), np.arange(-50, 51), amplitude=1.0).full()
        nzr = np.where(np.abs(k) > 1e-9); k = k[nzr[0].min():nzr[0].max() + 1, nzr[1].min():nzr[1].max() + 1]
        kern[b] = k
    return dict(model=model, amp=amp, amp_nd=amp_nd, comp=comp, spont=spont, dom=dom, nd=nd, x=x, y=y, ndx=ndx, ndy=ndy,
                sbin=sbin, kern=kern, tuning=P['tuning_angle'], n=n)

def _conv_same(img, k):
    from scipy.signal import fftconvolve
    return fftconvolve(img, k, mode='same')

def spatial(L, movie):
    """movie: T x ROWS x COLS (grey 0, range about -1..1). Returns T x n dominant and T x n non-dominant responses."""
    T = movie.shape[0]; dom = np.zeros((T, L['n'])); nd = np.zeros((T, L['n']))
    ones = np.ones((ROWS, COLS))
    for b, k in L['kern'].items():
        sel = np.where(L['sbin'] == b)[0]
        edge = _conv_same(ones, k)                               # BMTK-compatible edge renormalisation
        conv = np.stack([_conv_same(fr, k) for fr in movie]) / edge
        flat = conv.reshape(T, -1)
        def samp(x, y):
            x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int); x1, y1 = np.ceil(x).astype(int), np.ceil(y).astype(int)
            fx, fy = x - x0, y - y0
            return ((1 - fx) * (1 - fy) * flat[:, y0 * COLS + x0] + (1 - fx) * fy * flat[:, y1 * COLS + x0]
                    + fx * (1 - fy) * flat[:, y0 * COLS + x1] + fx * fy * flat[:, y1 * COLS + x1])
        dom[:, sel] = samp(L['x'][sel], L['y'][sel]); nd[:, sel] = samp(L['ndx'][sel], L['ndy'][sel])
    return dom, nd

def rates(L, movie):
    """LGN firing rates (Hz), T x n, for a 1 kHz movie."""
    from scipy.signal import fftconvolve
    sd, sn = spatial(L, movie); T = movie.shape[0]; K = L['dom'].shape[1]
    # causal temporal filtering: out[t] = sum_k kernel[K-1-k] * s[t-k], zero history before the movie (grey = 0)
    fd = np.stack([fftconvolve(sd[:, i], L['dom'][i, ::-1])[:T] for i in range(L['n'])], 1)
    r = np.maximum(fd * L['amp'] + L['spont'], 0)
    ci = np.where(L['comp'])[0]
    if len(ci):
        fn = np.stack([fftconvolve(sn[:, i], L['nd'][i, ::-1])[:T] for i in ci], 1)
        r[:, ci] += np.maximum(fn * L['amp_nd'][ci] + L['spont'][ci], 0)
    return r
