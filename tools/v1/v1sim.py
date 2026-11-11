"""Event-driven numpy simulator of the Allen V1 GLIF3 network, following V1_GLIF_model/v1_model_utils
(models.V1Column._dense_update_impl, glif_propagators.membrane_coefficients, 'exact' scheme, soft reset).
dt = 1 ms; LGN spikes are Bernoulli(1 - exp(-rate dt)); background = 100 Poisson sources at 250 Hz."""
import numpy as np

def _expm1_ratio(x):
    x = np.asarray(x, np.float64); out = np.empty_like(x); big = np.abs(x) >= 1e-6
    out[big] = np.expm1(x[big]) / x[big]; xs = x[~big]; out[~big] = 1.0 + xs / 2.0 + xs * xs / 6.0; return out
def _phi1(a, b, dt): return np.exp(-a * dt) * dt * _expm1_ratio((a - b) * dt)
def _phi2_factor(x):
    out = np.empty_like(x); small = np.abs(x) < 7.5e-3; xs = x[small]
    out[small] = 0.5 + xs / 3.0 + xs * xs / 8.0 + xs ** 3 / 30.0 + xs ** 4 / 144.0
    xb = x[~small]; out[~small] = 1.0 + (xb - 1.0) * ((np.expm1(xb) / xb) - 1.0) / xb; return out
def _phi2(a, b, dt):
    x = (a - b) * dt; return _phi2_factor(x) * dt * dt * np.exp(-a * dt)

def propagators(m, dt=1.0, tau_syn=None):
    from v1net import TAU_BASIS
    tau_syn = TAU_BASIS if tau_syn is None else tau_syn
    tau, g, k, asc = m['tau_m'], m['g'], m['k'], m['asc']
    decay = np.exp(-dt / tau); C = g * tau
    a = (1 / tau)[:, None]; beta = (1 / tau_syn)[None, :]
    A = _phi1(*np.broadcast_arrays(a, beta), dt) / C[:, None]; Bc = _phi2(*np.broadcast_arrays(a, beta), dt) / C[:, None]
    D = _phi1(*np.broadcast_arrays(a, k), dt) / C[:, None]
    return dict(decay=decay, A=A, B=Bc, D=D, reset=-decay, asc_spike=(D * asc).sum(-1), asc_jump=np.exp(-dt * k) * asc,
                asc_decay=np.exp(-dt * k), syn_decay=np.exp(-dt / tau_syn), psc_init=np.e / tau_syn,
                t_ref_steps=np.maximum(np.ceil(m['t_ref'] / dt), 1).astype(np.int16))

class CSR:
    """outgoing edges grouped by source, each with a target, a 4-vector of basis weights and a delay slot"""
    def __init__(self, src, tgt, w, syn, basis, n_src, delay=None):
        o = np.argsort(src, kind='stable'); self.tgt = tgt[o].astype(np.int32); self.w = w[o].astype(np.float32); self.syn = syn[o].astype(np.int16)
        self.delay = None if delay is None else delay[o].astype(np.int8)
        self.ptr = np.zeros(n_src + 1, np.int64); np.add.at(self.ptr, src + 1, 1); self.ptr = np.cumsum(self.ptr); self.basis = basis.astype(np.float32)
    def gather(self, sources, counts=None):
        st, en = self.ptr[sources], self.ptr[sources + 1]; ln = en - st; tot = int(ln.sum())
        if tot == 0: return None
        idx = np.repeat(st - np.r_[0, np.cumsum(ln)[:-1]], ln) + np.arange(tot)
        w = self.w[idx] if counts is None else self.w[idx] * np.repeat(counts, ln)
        return idx, w

class V1Sim:
    def __init__(self, m, seed=0, cells=None, closure=None, rho0=None, tau_rho=10.0):
        """closure: None | 'grey' (outer annulus fires at fixed per-class rates rho0, spikes/ms) |
        'dynamic' (outer annulus fires like the same class inside, smoothed with tau_rho ms)"""
        self.m = m; self.N = N = int(m['N']); t = m['ttype']; P = propagators(m)
        self.closure = closure
        if closure:
            self.W_out = m['W_out'].astype(np.float64); self.cls = m['cls'].astype(np.int64); self.C = self.W_out.shape[1]
            self.n_cls = np.maximum(np.bincount(self.cls, minlength=self.C), 1); self.rho0 = np.asarray(rho0, float)
            self.a_rho = 1 - np.exp(-1.0 / tau_rho)
            if closure == 'noise':      # Poisson input from the missing annulus at fixed rates, as mean + Gaussian fluctuation
                self.mu_out = np.einsum('ncb,c->nb', self.W_out, self.rho0); self.sd_out = np.sqrt(np.einsum('ncb,c->nb', m['Q_out'].astype(np.float64), self.rho0))
        per = lambda a: a[t]
        self.decay, self.reset, self.asc_spike = per(P['decay']), per(P['reset']), per(P['asc_spike'])
        self.A, self.B, self.D = per(P['A']), per(P['B']), per(P['D'])
        self.asc_jump, self.asc_decay, self.tref = per(P['asc_jump']), per(P['asc_decay']), per(P['t_ref_steps'])
        self.syn_decay, self.psc_init = P['syn_decay'], P['psc_init']
        basis = m['basis']
        self.rec = CSR(m['rec_src'], m['rec_tgt'], m['rec_w'], m['rec_syn'], basis, N, m['rec_delay'])
        self.lgn = CSR(m['lgn_src'], m['lgn_tgt'], m['lgn_w'], m['lgn_syn'], basis, 17400)
        self.bkg = CSR(m['bkg_src'], m['bkg_tgt'], m['bkg_w'], m['bkg_syn'], basis, 100)
        self.n_bkg = 100; self.lgn_delay = int(m['lgn_delay']); self.bkg_delay = int(m['bkg_delay'])
        self.Dmax = int(max(m['rec_delay'].max(), self.lgn_delay, self.bkg_delay)) + 1
        self.rng = np.random.default_rng(seed); self.reset_state()
    def reset_state(self):
        N = self.N; self.v = np.zeros(N); self.r = np.zeros(N, np.int16); self.asc = np.zeros((N, 2))
        self.rise = np.zeros((N, 4)); self.psc = np.zeros((N, 4)); self.z = np.zeros(N, bool)
        self.acc = np.zeros((self.Dmax, N * 4)); self.t = 0
        if self.closure: self.rho = self.rho0.copy()
    def _deliver(self, csr, sources, slot_of_delay, counts=None):
        g = csr.gather(sources, counts)
        if g is None: return
        idx, w = g; tg = csr.tgt[idx]; b = csr.basis[csr.syn[idx]] * w[:, None]          # n x 4
        flat = (tg[:, None] * 4 + np.arange(4)[None, :]).ravel(); vals = b.ravel()
        if csr.delay is None:
            self.acc[slot_of_delay(None)] += np.bincount(flat, vals, self.N * 4)
        else:
            dl = np.repeat(csr.delay[idx], 4)
            for d in np.unique(dl): s = dl == d; self.acc[slot_of_delay(d)] += np.bincount(flat[s], vals[s], self.N * 4)
    def step(self, lgn_spikes):
        """lgn_spikes: bool array of LGN units spiking in the frame emitted at this step"""
        t = self.t; D = self.Dmax
        # background sampled now acts at t + (bkg_delay - 1); LGN at t + (lgn_delay - 1)
        cnt = self.rng.poisson(0.25, self.n_bkg); src = np.nonzero(cnt)[0]
        self._deliver(self.bkg, src, lambda d: (t + self.bkg_delay - 1) % D, cnt[src].astype(np.float32))
        self._deliver(self.lgn, np.nonzero(lgn_spikes)[0], lambda d: (t + self.lgn_delay - 1) % D)
        inp = self.acc[t % D].reshape(self.N, 4).copy(); self.acc[t % D] = 0
        if self.closure == 'noise':
            inp += self.mu_out + self.sd_out * self.rng.standard_normal((self.N, 4))
        elif self.closure == 'pnd':     # per-neuron annulus rates, scaled by how active each class is inside right now
            g = self.rho / self.rho0
            inp += np.einsum('ncb,c->nb', self.Mc, g) + np.sqrt(np.maximum(np.einsum('ncb,c->nb', self.Vc, g), 0)) * self.rng.standard_normal((self.N, 4))
        elif self.closure: inp += np.einsum('ncb,c->nb', self.W_out, self.rho)
        z = self.z.astype(np.float64)
        new_rise = self.rise * self.syn_decay + inp * self.psc_init
        new_psc = self.psc * self.syn_decay + self.syn_decay * self.rise
        new_asc = self.asc_decay * self.asc + z[:, None] * self.asc_jump
        dv = (self.A * self.psc + self.B * self.rise).sum(1) + (self.D * self.asc).sum(1)
        v = self.decay * self.v + dv + self.reset * z + self.asc_spike * z
        r = np.maximum(self.r + self.z * self.tref - 1, 0).astype(np.int16)
        spk = (v > 1.0) & (r == 0)
        self.v, self.r, self.asc, self.rise, self.psc, self.z = v, r, new_asc, new_rise, new_psc, spk
        s = np.nonzero(spk)[0]
        if len(s): self._deliver(self.rec, s, lambda d: (t + int(d)) % D)
        if self.closure in ('dynamic', 'pnd'):
            inst = np.bincount(self.cls[s], minlength=self.C) / self.n_cls
            self.rho += self.a_rho * (inst - self.rho)
        self.t += 1
        return spk

def run(sim, lgn_rates, record=None):
    """lgn_rates: T x n_lgn (Hz). Returns spike counts per neuron (or record(spk) per step)."""
    T = lgn_rates.shape[0]; out = []
    p = -np.expm1(-lgn_rates / 1000.0)
    tot = np.zeros(sim.N, np.int32)
    for k in range(T):
        spk = sim.step(sim.rng.random(p.shape[1]) < p[k]); tot += spk
        if record is not None: out.append(record(spk))
    return tot, out
