// Allen biorealistic mouse V1 (Galvan, Arkhipov et al.; core_nll_0, bio_trained weights), central 200 um sub-column,
// with synapses from the outer column rewired onto response-matched proxies. GLIF3 neurons, exact integration at 1 ms,
// four alpha-function synaptic bases, per-connection delays; FilterNet LGN drives it from a 120 x 80 deg screen.
// Mirrors tools/v1/v1sim.py and tools/v1/lgn.py.
class V1Engine {
  constructor(meta, net, cells, lgnBuf) {
    const M = this.m = meta, N = this.N = M.N, NT = M.NT;
    // ---------------- cells
    let o = 0;
    this.pos = new Float32Array(cells, o, 3 * N); o += 12 * N;
    this.tuning = new Float32Array(cells, o, N); o += 4 * N;
    const v0 = new Float32Array(cells, o, N); o += 4 * N;
    this.ttype = new Uint8Array(cells, o, N); o += N;
    this.cls = new Uint8Array(cells, o, N); o += N;
    // ---------------- per-type constants
    const T = M.types, f32 = a => Float32Array.from(a.flat ? a.flat() : a);
    this.decay = f32(T.decay); this.resetC = f32(T.reset); this.ascSpike = f32(T.asc_spike); this.tref = Int16Array.from(T.tref);
    this.A = f32(T.A); this.B = f32(T.B); this.D = f32(T.D); this.ascJump = f32(T.asc_jump); this.ascDecay = f32(T.asc_decay);
    this.synDecay = f32(M.syn_decay); this.pscInit = f32(M.psc_init); this.basis = f32(M.basis);
    // ---------------- synapses
    const sec = M.sections, u8 = (k) => new Uint8Array(net, sec[k][0], sec[k][1]);
    const dequant = (q, [lo, hi]) => { const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = Math.exp(lo + i / 255 * (hi - lo)); const w = new Float32Array(q.length); for (let i = 0; i < q.length; i++) w[i] = lut[q[i]]; return w; };
    const unvarint = (bytes, ptr, n) => {         // per-source delta-coded targets
      const out = new Uint16Array(n); let p = 0, e = 0;
      for (let s = 0; s + 1 < ptr.length; s++) { let prev = 0; for (let k = ptr[s]; k < ptr[s + 1]; k++) {
        let v = 0, sh = 0, b; do { b = bytes[p++]; v |= (b & 127) << sh; sh += 7; } while (b & 128);
        prev = (k === ptr[s] ? v : prev + v); out[e++] = prev; } }
      return out;
    };
    const ptrOf = k => new Uint32Array(net.slice(sec[k][0], sec[k][0] + sec[k][1]));
    this.recPtr = ptrOf('rec_ptr'); this.recTgt = unvarint(u8('rec_tgt'), this.recPtr, M.E.rec);
    this.recW = dequant(u8('rec_w'), M.quant.rec);
    // per edge: basis row and delay, from (source class, target type); sign from source class
    this.recSyn = new Uint8Array(M.E.rec); this.recDel = new Uint8Array(M.E.rec);
    for (let s = 0; s < N; s++) {
      const c = this.cls[s], sg = M.inh_cls[c] ? -1 : 1, rowS = M.rec_syn[c], rowD = M.rec_delay[c];
      for (let k = this.recPtr[s]; k < this.recPtr[s + 1]; k++) { const tt = this.ttype[this.recTgt[k]]; this.recSyn[k] = rowS[tt]; this.recDel[k] = rowD[tt]; this.recW[k] *= sg; }
    }
    this.lgnPtr = ptrOf('lgn_ptr'); this.lgnTgt = unvarint(u8('lgn_tgt'), this.lgnPtr, M.E.lgn);
    this.lgnW = dequant(u8('lgn_w'), M.quant.lgn);
    this.lgnSyn = new Uint8Array(M.E.lgn); for (let k = 0; k < M.E.lgn; k++) this.lgnSyn[k] = M.lgn_syn[this.ttype[this.lgnTgt[k]]];
    // background: 100 Poisson sources, 4 edges per neuron -> CSR by source
    const bsrc = new Uint8Array(net, sec.bkg_src[0], 4 * N), bw = new Float32Array(net.slice(sec.bkg_w[0], sec.bkg_w[0] + 16 * N));
    const cnt = new Int32Array(101); for (let i = 0; i < 4 * N; i++) cnt[bsrc[i] + 1]++;
    for (let i = 0; i < 100; i++) cnt[i + 1] += cnt[i];
    this.bkgPtr = Int32Array.from(cnt); this.bkgTgt = new Uint16Array(4 * N); this.bkgW = new Float32Array(4 * N); this.bkgSyn = new Uint8Array(4 * N);
    const fill = Int32Array.from(cnt);
    for (let i = 0; i < 4 * N; i++) { const s = bsrc[i], k = fill[s]++, n = i >> 2; this.bkgTgt[k] = n; this.bkgW[k] = bw[i]; this.bkgSyn[k] = M.bkg_syn[this.ttype[n]]; }
    // ---------------- state
    this.Dslots = 4; this.acc = new Float32Array(this.Dslots * N * 4);
    this.v = Float32Array.from(v0); this.r = new Int16Array(N); this.asc = new Float32Array(2 * N);
    this.rise = new Float32Array(4 * N); this.psc = new Float32Array(4 * N); this.z = new Uint8Array(N); this.spk = new Int32Array(N); this.nspk = 0;
    this.t = 0; this.seed = 123456789;
    this.lgn = new LGNModel(M.lgn, lgnBuf);
    this.lgnP = new Float32Array(this.lgn.n); this.updateP();
  }
  updateP() { const R = this.lgn.rate; for (let u = 0; u < R.length; u++) this.lgnP[u] = 1 - Math.exp(-R[u] / 1000); }
  rand() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 4294967296; }
  poisson025() { const L = 0.7788007830714049; let k = 0, p = 1; do { k++; p *= this.rand(); } while (p > L); return k - 1; }
  deliver(slot, tgt, w, syn, a, b, scale) {
    const acc = this.acc, base = slot * this.N * 4, B = this.basis;
    for (let k = a; k < b; k++) { const q = base + tgt[k] * 4, s = syn[k] * 4, x = w[k] * scale; acc[q] += x * B[s]; acc[q + 1] += x * B[s + 1]; acc[q + 2] += x * B[s + 2]; acc[q + 3] += x * B[s + 3]; }
  }
  step() {
    const N = this.N, t = this.t, D = this.Dslots, M = this.m;
    // background (acts now) and LGN (acts next step, delay 2)
    const sb = (t + M.bkg_delay - 1) % D;
    for (let s = 0; s < 100; s++) { const c = this.poisson025(); if (c) this.deliver(sb, this.bkgTgt, this.bkgW, this.bkgSyn, this.bkgPtr[s], this.bkgPtr[s + 1], c); }
    const sl = (t + M.lgn_delay - 1) % D, P = this.lgnP, lp = this.lgnPtr;
    for (let u = 0; u < P.length; u++) if (this.rand() < P[u]) this.deliver(sl, this.lgnTgt, this.lgnW, this.lgnSyn, lp[u], lp[u + 1], 1);
    // neuron update (exact propagators), reading the input that arrives this step
    const acc = this.acc, base = (t % D) * N * 4, v = this.v, r = this.r, asc = this.asc, rise = this.rise, psc = this.psc, z = this.z;
    const sd = this.synDecay, pi = this.pscInit, A = this.A, B = this.B, Dc = this.D, tt = this.ttype, spk = this.spk;
    let ns = 0;
    for (let i = 0; i < N; i++) {
      const ty = tt[i], zi = z[i], j4 = i * 4, t4 = ty * 4, t2 = ty * 2, i2 = i * 2;
      let dv = 0;
      for (let b = 0; b < 4; b++) {
        const ri = rise[j4 + b], pc = psc[j4 + b];
        dv += A[t4 + b] * pc + B[t4 + b] * ri;
        rise[j4 + b] = ri * sd[b] + acc[base + j4 + b] * pi[b];
        psc[j4 + b] = pc * sd[b] + sd[b] * ri;
        acc[base + j4 + b] = 0;
      }
      const a0 = asc[i2], a1 = asc[i2 + 1];
      dv += Dc[t2] * a0 + Dc[t2 + 1] * a1;
      asc[i2] = this.ascDecay[t2] * a0 + zi * this.ascJump[t2]; asc[i2 + 1] = this.ascDecay[t2 + 1] * a1 + zi * this.ascJump[t2 + 1];
      const nv = this.decay[ty] * v[i] + dv + (this.resetC[ty] + this.ascSpike[ty]) * zi;
      let nr = r[i] + zi * this.tref[ty] - 1; if (nr < 0) nr = 0;
      v[i] = nv; r[i] = nr;
      const fire = nv > 1 && nr === 0 ? 1 : 0; z[i] = fire; if (fire) spk[ns++] = i;
    }
    this.nspk = ns;
    // recurrent delivery with per-connection delay
    const rp = this.recPtr, rt = this.recTgt, rw = this.recW, rs = this.recSyn, rd = this.recDel, Bs = this.basis;
    for (let k = 0; k < ns; k++) {
      const s = spk[k];
      for (let e = rp[s]; e < rp[s + 1]; e++) {
        const q = ((t + rd[e]) % D) * N * 4 + rt[e] * 4, b = rs[e] * 4, x = rw[e];
        acc[q] += x * Bs[b]; acc[q + 1] += x * Bs[b + 1]; acc[q + 2] += x * Bs[b + 2]; acc[q + 3] += x * Bs[b + 3];
      }
    }
    this.t++;
    if (this.t % 10 === 0) this.updateLGN();
  }
  // LGN rates for the next 10 ms bin -> per-ms spike probabilities
  updateLGN() { this.lgn.binStep(); this.updateP(); }
  setFrame(img) { this.lgn.setFrame(img); }
  reset() { this.v.fill(0); this.r.fill(0); this.asc.fill(0); this.rise.fill(0); this.psc.fill(0); this.z.fill(0); this.acc.fill(0); this.lgn.reset(); this.updateP(); }
}

// FilterNet LGN: Gaussian spatial filter (BMTK edge-normalised), temporal kernel at 10 ms resolution, rectified around spontaneous rate.
class LGNModel {
  constructor(L, buf) {
    const n = this.n = L.n, K = this.K = L.taps; this.L = L;
    this.kd = new Float32Array(buf, 0, n * K);
    const nc = L.comp.reduce((a, b) => a + b, 0); this.kn = new Float32Array(buf, n * K * 4, nc * K);
    this.compIdx = new Int32Array(n).fill(-1); let c = 0; L.comp.forEach((v, i) => { if (v) this.compIdx[i] = c++; });
    this.W = 120; this.H = 80;
    this.bins = Object.keys(L.sigma).map(Number);
    this.kern = {}; this.edge = {};
    for (const b of this.bins) {                     // 1-D Gaussian (truncated where the 2-D kernel drops below 1e-9, as BMTK trims)
      const s = L.sigma[b], R = L.kR[b], k = new Float32Array(2 * R + 1);
      let sum = 0; for (let i = -R; i <= R; i++) { k[i + R] = Math.exp(-i * i / (2 * s * s)); sum += k[i + R]; }
      for (let i = 0; i < k.length; i++) k[i] /= sum; this.kern[b] = k;
      const ones = new Float32Array(this.W * this.H).fill(1); this.edge[b] = this.blur(ones, k);
    }
    this.byBin = {}; for (const b of this.bins) this.byBin[b] = [];
    L.sbin.forEach((b, i) => this.byBin[b].push(i));
    this.sd = new Float32Array(n); this.sn = new Float32Array(n);
    this.hd = new Float32Array(n * K); this.hn = new Float32Array(Math.max(1, nc) * K); this.head = 0;
    this.rate = new Float32Array(n); this.reset();
  }
  blur(img, k) {
    const W = this.W, H = this.H, R = (k.length - 1) >> 1, tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let j = -R; j <= R; j++) { const xx = x + j; if (xx >= 0 && xx < W) a += img[y * W + xx] * k[j + R]; } tmp[y * W + x] = a; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let j = -R; j <= R; j++) { const yy = y + j; if (yy >= 0 && yy < H) a += tmp[yy * W + x] * k[j + R]; } out[y * W + x] = a; }
    return out;
  }
  setFrame(img) {                                    // img: 120 x 80, grey 0, contrast about -1..1
    const L = this.L, W = this.W;
    const samp = (f, x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.ceil(x), y1 = Math.ceil(y), fx = x - x0, fy = y - y0;
      return (1 - fx) * (1 - fy) * f[y0 * W + x0] + (1 - fx) * fy * f[y1 * W + x0] + fx * (1 - fy) * f[y0 * W + x1] + fx * fy * f[y1 * W + x1]; };
    for (const b of this.bins) {
      const bl = this.blur(img, this.kern[b]), e = this.edge[b];
      for (let i = 0; i < bl.length; i++) bl[i] /= e[i];
      for (const u of this.byBin[b]) { this.sd[u] = samp(bl, L.x[u], L.y[u]); if (L.comp[u]) this.sn[u] = samp(bl, L.ndx[u], L.ndy[u]); }
    }
  }
  binStep() {                                        // push the current spatial response, filter, rectify
    const n = this.n, K = this.K, L = this.L; this.head = (this.head + 1) % K; const h = this.head;
    for (let u = 0; u < n; u++) {
      this.hd[u * K + h] = this.sd[u];
      let f = 0; const kd = this.kd, o = u * K; for (let j = 0; j < K; j++) f += kd[o + j] * this.hd[o + (h - j + K) % K];
      let r = f * L.amp[u] + L.spont[u]; r = r > 0 ? r : 0;
      const c = this.compIdx[u];
      if (c >= 0) { this.hn[c * K + h] = this.sn[u]; let g = 0; const oc = c * K; for (let j = 0; j < K; j++) g += this.kn[oc + j] * this.hn[oc + (h - j + K) % K]; const r2 = g * L.amp_nd[u] + L.spont[u]; r += r2 > 0 ? r2 : 0; }
      this.rate[u] = r;
    }
    return this.rate;
  }
  reset() { this.sd.fill(0); this.sn.fill(0); this.hd.fill(0); this.hn.fill(0); this.head = 0; for (let u = 0; u < this.n; u++) this.rate[u] = this.L.spont[u] * (this.L.comp[u] ? 2 : 1); }
}
if (typeof module !== 'undefined') module.exports = {V1Engine, LGNModel};
