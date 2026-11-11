// MouseHarp network: a rate model on the MICrONS cubic-millimetre connectome (v1412), driven through the
// measured receptive fields and orientation tuning of 11,483 coregistered neurons. Mirrors tools/sim.py.
class MouseEngine {
  constructor(meta, net, cells) {
    const N = meta.N, E = meta.E; this.m = meta; this.N = N; this.E = E;
    let o = 0;
    this.rowptr = new Int32Array(net, o, N + 1); o += 4 * (N + 1);
    this.src = new Uint16Array(net, o, E); o += 2 * E;
    const cnt = new Uint8Array(net, o, E); o += E; o = Math.ceil(o / 4) * 4;
    // sE / sI were written right after cnt without padding: copy them out byte-exactly
    const tail = net.slice(4 * (N + 1) + 3 * E), f32 = new Float32Array(tail.byteLength >= 8 * N ? tail.slice(0, 8 * N) : tail);
    const sE = f32.subarray(0, N), sI = f32.subarray(N, 2 * N);
    let c = 0;
    this.pos = new Float32Array(cells, c, 3 * N); c += 12 * N;
    this.rfx = new Float32Array(cells, c, N); c += 4 * N; this.rfy = new Float32Array(cells, c, N); c += 4 * N;
    this.grp = new Uint8Array(cells, c, N); c += N; this.area = new Uint8Array(cells, c, N); c += N;
    this.ori = new Uint8Array(cells, c, N); c += N; this.oriSrc = new Uint8Array(cells, c, N); c += N;
    this.osi = new Uint8Array(cells, c, N); c += N; this.mtype = new Uint8Array(cells, c, N); c += N;
    this.inh = new Uint8Array(N); for (let i = 0; i < N; i++) this.inh[i] = this.grp[i] >= 4 ? 1 : 0;
    // signed weights: w = cnt * rescale(post, pre class) * gain(pre class -> post class) / norm
    const g = meta.gains, w = new Float32Array(E);
    for (let i = 0; i < N; i++) {
      const pi = this.inh[i];
      const gE = (pi ? g.gIE : g.gEE) / meta.normE, gI = -(pi ? g.gII : g.gEI) / meta.normI;
      for (let p = this.rowptr[i]; p < this.rowptr[i + 1]; p++) {
        const j = this.src[p];
        w[p] = this.inh[j] ? cnt[p] * sI[i] * gI : cnt[p] * sE[i] * gE;
      }
    }
    this.w = w; this.cnt = cnt;
    this.alpha = new Float32Array(N);
    for (let i = 0; i < N; i++) this.alpha[i] = 1 - Math.exp(-meta.dt / (this.inh[i] ? meta.tauI : meta.tauE));
    this.alphaA = 1 - Math.exp(-meta.dt / meta.tauA);
    this.r = new Float32Array(N); this.A = new Float32Array(N); this.sin = new Float32Array(N);
    const F = meta.func; this.fIdx = Int32Array.from(F.idx); this.nF = F.idx.length;
    this.fpx = Int32Array.from(F.px, x => Math.round(x)); this.fpy = Int32Array.from(F.py, y => Math.round(y));
    this.fo0 = Int32Array.from(F.o0); this.fo1 = Int32Array.from(F.o1); this.fof = Float32Array.from(F.of); this.fosi = Float32Array.from(F.osi);
    this.sbar = null; this.s = new Float32Array(this.nF);
    const [W, H] = meta.img; this.W = W; this.H = H; this.K = meta.K;
    this.bank = meta.bank.map(([e, od]) => [Float32Array.from(e), Float32Array.from(od)]);
    this.En = new Float32Array(meta.nori * W * H);
  }
  // oriented energy, 'same' convolution with symmetric boundary (scipy convolve2d 'symm'): kernels are flipped
  energy(img) {
    const {W, H, K} = this, h = K >> 1, n = W * H;
    let mean = 0; for (let i = 0; i < n; i++) mean += img[i]; mean /= n;
    const refl = (i, L) => { while (i < 0 || i >= L) i = i < 0 ? -i - 1 : 2 * L - i - 1; return i; };
    for (let o = 0; o < this.bank.length; o++) {
      const [ev, od] = this.bank[o], base = o * n;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let a = 0, b = 0;
        for (let ky = 0; ky < K; ky++) {
          const yy = refl(y + h - ky, H);
          for (let kx = 0; kx < K; kx++) { const v = img[yy * W + refl(x + h - kx, W)] - mean, q = ky * K + kx; a += v * ev[q]; b += v * od[q]; }
        }
        this.En[base + y * W + x] = Math.sqrt(a * a + b * b);
      }
    }
    return this.En;
  }
  drive(img) {
    const E = this.energy(img), n = this.W * this.H, no = this.bank.length, R = this.m.run;
    for (let k = 0; k < this.nF; k++) {
      const q = this.fpy[k] * this.W + this.fpx[k];
      const ep = (1 - this.fof[k]) * E[this.fo0[k] * n + q] + this.fof[k] * E[this.fo1[k] * n + q];
      let em = 0; for (let o = 0; o < no; o++) em += E[o * n + q]; em /= no;
      this.s[k] = this.fosi[k] * ep + (1 - this.fosi[k]) * em;
    }
    if (!this.sbar) this.sbar = Float32Array.from(this.s);
    else for (let k = 0; k < this.nF; k++) this.sbar[k] = R.adapt * this.sbar[k] + (1 - R.adapt) * this.s[k];
    this.sin.fill(0);
    for (let k = 0; k < this.nF; k++) { const s = this.s[k], d = s - this.sbar[k]; this.sin[this.fIdx[k]] = R.gain_in * (s + R.trans * (d > 0 ? d : 0)); }
  }
  step() {
    const {N, rowptr, src, w, r, A, sin, alpha} = this, R = this.m.run, h = R.h, k = R.k, rmax = R.rmax, b = R.b_ad, aA = this.alphaA;
    const f = this.f || (this.f = new Float32Array(N));
    for (let i = 0; i < N; i++) {
      let x = sin[i] + h - b * A[i];
      for (let p = rowptr[i], e = rowptr[i + 1]; p < e; p++) x += w[p] * r[src[p]];
      f[i] = x > 0 ? rmax * Math.tanh(k * x * x / rmax) : 0;
    }
    for (let i = 0; i < N; i++) { r[i] += alpha[i] * (f[i] - r[i]); A[i] += aA * (r[i] - A[i]); }
  }
  frame(img) { this.drive(img); for (let s = 0; s < this.m.steps_per_frame; s++) this.step(); }
  reset() { this.r.fill(0); this.A.fill(0); this.sbar = null; }
}
if (typeof module !== 'undefined') module.exports = MouseEngine;
