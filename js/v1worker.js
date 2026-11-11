// Runs the V1 model off the main thread.
//   in  {cmd:'init', base}                     -> out {cmd:'ready', ...}
//   in  {cmd:'run', frames:[Float32Array(9600)], ms} -> each frame shown for `ms` simulated ms
//       out {cmd:'frames', steps:[Float32Array(nS)], cells:Uint8Array(N), lgn:Float32Array(nLgn), spikesPerMs}
//   in  {cmd:'edges', k} -> out {cmd:'edges', src, tgt, w}
importScripts('v1engine.js');
let E = null, sOf = null, sCount = null, nS = 0, lgnS = null, G = null;
const NB = 6;
// instrument families: LGN ON, LGN OFF, then V1 classes
const GROUPS = ['LGN ON', 'LGN OFF', 'L2/3 E', 'L4 E', 'L5 E', 'L6 E', 'PV', 'SST', 'VIP'];
function groupOfPop(p) {
  if (p[0] === 'e') return p.startsWith('e23') ? 2 : p.startsWith('e4') ? 3 : p.startsWith('e5') ? 4 : 5;
  return p.includes('Pvalb') ? 6 : p.includes('Sst') ? 7 : 8;       // Vip and L1 Htr3a
}
self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.cmd === 'init') {
    const get = f => fetch(msg.base + f);
    // binaries as shipped; hosts that refuse .bin get base64-in-JSON copies, split into parts (data/v1/<name>.parts.json)
    const loadBin = async f => {
      const r = await get(f + '.bin'); if (r.ok) return r.arrayBuffer();
      const parts = (await (await get(f + '.parts.json')).json()).n, chunks = [];
      for (let k = 0; k < parts; k++) { const s = (await (await get(`${f}.${k}.b64.json`)).json()).b64; chunks.push(Uint8Array.from(atob(s), c => c.charCodeAt(0))); }
      const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out.buffer; };
    const [meta, net, cells, lgn, rf] = await Promise.all([get('v1meta.json').then(r => r.json()), loadBin('v1net'), loadBin('v1cells'), loadBin('v1lgn'), loadBin('v1rf')]);
    E = new V1Engine(meta, net, cells, lgn);
    const N = E.N, rx = new Float32Array(rf, 0, N), ry = new Float32Array(rf, 4 * N, N), pref = new Float32Array(rf, 8 * N, N), osi = new Float32Array(rf, 12 * N, N);
    // strings: V1 group x preferred-orientation bin (30 deg); LGN ON/OFF x azimuth bin
    G = new Uint8Array(N); nS = GROUPS.length * NB; sOf = new Int32Array(N); sCount = new Float32Array(nS);
    for (let i = 0; i < N; i++) { G[i] = groupOfPop(meta.pops[E.cls[i]]); const s = G[i] * NB + Math.min(NB - 1, Math.floor(pref[i] / 30)); sOf[i] = s; sCount[s]++; }
    const L = meta.lgn, nL = L.n; lgnS = new Int32Array(nL);
    let x0 = 1e9, x1 = -1e9; for (let u = 0; u < nL; u++) { x0 = Math.min(x0, L.x[u]); x1 = Math.max(x1, L.x[u]); }
    for (let u = 0; u < nL; u++) { const on = L.model[u].startsWith('sON'), s = (on ? 0 : 1) * NB + Math.min(NB - 1, Math.floor((L.x[u] - x0) / (x1 - x0 + 1e-6) * NB)); lgnS[u] = s; sCount[s]++; }
    self.postMessage({cmd: 'ready', N, E: meta.E, full: meta.full, groups: GROUPS, NB, nS, sCount: Array.from(sCount), pops: meta.pops,
      cls: E.cls.slice(), G: G.slice(), pos: E.pos.slice(), rx: rx.slice(), ry: ry.slice(), pref: pref.slice(), osi: osi.slice(),
      lgn: {n: nL, x: L.x, y: L.y, model: L.model}, radius: meta.radius_um});
  } else if (msg.cmd === 'run') {
    const N = E.N, ms = msg.ms || 10, steps = [], cells = new Uint8Array(N); let tot = 0;
    for (const img of msg.frames) {
      E.setFrame(img); const a = new Float32Array(nS);
      for (let k = 0; k < ms; k++) {
        E.step(); tot += E.nspk;
        for (let j = 0; j < E.nspk; j++) { const i = E.spk[j]; a[sOf[i]]++; if (cells[i] < 255) cells[i]++; }
      }
      // LGN: expected spikes in the window from the current rates (the engine samples them; this is their mean)
      const R = E.lgn.rate; for (let u = 0; u < R.length; u++) a[lgnS[u]] += R[u] * ms / 1000;
      for (let s = 0; s < nS; s++) a[s] = sCount[s] ? a[s] / sCount[s] * (1000 / ms) : 0;      // mean rate per string, Hz
      steps.push(a);
    }
    const lgn = Float32Array.from(E.lgn.rate);
    self.postMessage({cmd: 'frames', steps, cells, lgn, rate: tot / N / (msg.frames.length * ms) * 1000}, [cells.buffer, lgn.buffer, ...steps.map(s => s.buffer)]);
  } else if (msg.cmd === 'reset') E.reset();
  else if (msg.cmd === 'edges') {
    // strongest k inputs per neuron (by |w| x basis sum), for the 3D view
    const k = msg.k || 2, N = E.N, best = new Float32Array(N * k), bsrc = new Int32Array(N * k).fill(-1);
    for (let s = 0; s < N; s++) for (let e = E.recPtr[s]; e < E.recPtr[s + 1]; e++) {
      const t = E.recTgt[e], w = Math.abs(E.recW[e]);
      for (let j = 0; j < k; j++) if (w > best[t * k + j]) { for (let q = k - 1; q > j; q--) { best[t * k + q] = best[t * k + q - 1]; bsrc[t * k + q] = bsrc[t * k + q - 1]; } best[t * k + j] = w; bsrc[t * k + j] = s; break; }
    }
    const S = [], T = [], W = [];
    for (let t = 0; t < N; t++) for (let j = 0; j < k; j++) if (bsrc[t * k + j] >= 0) { S.push(bsrc[t * k + j]); T.push(t); W.push(best[t * k + j] * (E.m.inh_cls[E.cls[bsrc[t * k + j]]] ? -1 : 1)); }
    const src = Int32Array.from(S), tgt = Int32Array.from(T), w = Float32Array.from(W);
    self.postMessage({cmd: 'edges', src, tgt, w}, [src.buffer, tgt.buffer, w.buffer]);
  }
};
