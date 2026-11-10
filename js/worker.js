// Runs the cortex off the main thread.
//   in  {cmd:'init', base}                 -> out {cmd:'ready', ...cells, strings}
//   in  {cmd:'run', frames:[Float32Array]} -> out {cmd:'frames', steps:[Float32Array(nS)], r}
//   in  {cmd:'edges', k}                   -> out {cmd:'edges', src, tgt, w}
importScripts('engine.js');
let eng = null, sOf = null, sCount = null, nS = 0, NB = 7, scale = null;
const bin = (i) => eng.oriSrc[i] ? Math.min(5, Math.floor(eng.ori[i] / 30)) : 6;   // six 30° orientation bins + untuned

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.cmd === 'init') {
    const get = f => fetch(msg.base + f);
    // binaries as shipped; hosts that refuse .bin get a base64-in-JSON copy instead (data/*.b64.json)
    const loadBin = async f => { const r = await get(f + '.bin'); if (r.ok) return r.arrayBuffer();
      const s = (await (await get(f + '.b64.json')).json()).b64, u = Uint8Array.from(atob(s), c => c.charCodeAt(0)); return u.buffer; };
    const [meta, net, cells] = await Promise.all([get('meta.json').then(r => r.json()), loadBin('net'), loadBin('cells')]);
    eng = new MouseEngine(meta, net, cells);
    // strings: cell class (8) x area (4) x orientation bin (7)
    nS = 8 * 4 * NB; sOf = new Int32Array(eng.N); sCount = new Float32Array(nS);
    for (let i = 0; i < eng.N; i++) { const s = (eng.grp[i] * 4 + eng.area[i]) * NB + bin(i); sOf[i] = s; sCount[s]++; }
    scale = calibrate();
    eng.reset();
    self.postMessage({cmd: 'ready', meta: {...meta, func: undefined, bank: undefined}, N: eng.N, E: eng.E, nS, NB, sCount: Array.from(sCount), scale: Array.from(scale),
      pos: eng.pos.slice(), rfx: eng.rfx.slice(), rfy: eng.rfy.slice(), grp: eng.grp.slice(), area: eng.area.slice(), ori: eng.ori.slice(), oriSrc: eng.oriSrc.slice(), osi: eng.osi.slice(), mtype: eng.mtype.slice()});
  } else if (msg.cmd === 'run') {
    const steps = [];
    for (const img of msg.frames) { eng.frame(img); steps.push(stringAct()); }
    const r = eng.r.slice();
    self.postMessage({cmd: 'frames', steps, r}, [r.buffer, ...steps.map(s => s.buffer)]);
  } else if (msg.cmd === 'reset') eng.reset();
  else if (msg.cmd === 'edges') {
    const k = msg.k || 2, S = [], T = [], W = [];
    for (let i = 0; i < eng.N; i++) {
      const a = eng.rowptr[i], b = eng.rowptr[i + 1], idx = [];
      for (let p = a; p < b; p++) idx.push(p);
      idx.sort((p, q) => Math.abs(eng.w[q]) - Math.abs(eng.w[p]));
      for (let j = 0; j < Math.min(k, idx.length); j++) { S.push(eng.src[idx[j]]); T.push(i); W.push(eng.w[idx[j]]); }
    }
    const src = Int32Array.from(S), tgt = Int32Array.from(T), w = Float32Array.from(W);
    self.postMessage({cmd: 'edges', src, tgt, w}, [src.buffer, tgt.buffer, w.buffer]);
  }
};

function stringAct() {
  const a = new Float32Array(nS), r = eng.r;
  for (let i = 0; i < eng.N; i++) a[sOf[i]] += r[i];
  for (let s = 0; s < nS; s++) a[s] = sCount[s] ? a[s] / sCount[s] : 0;
  return a;
}

// each string's response range: peak mean activity over drifting gratings at six orientations and full-field flashes
function calibrate() {
  const [W, H] = eng.m.img, img = new Float32Array(W * H), sc = new Float32Array(nS).fill(1e-4);
  const take = () => { const a = stringAct(); for (let s = 0; s < nS; s++) sc[s] = Math.max(sc[s], a[s]); };
  for (let th = 0; th < 180; th += 30) {
    eng.reset(); const c = Math.cos(th * Math.PI / 180), s = Math.sin(th * Math.PI / 180);
    for (let t = 0; t < 14; t++) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = 0.5 + 0.5 * Math.cos(2 * Math.PI * (x * c - y * s) / 6 + 2 * Math.PI * 2 * t * 0.02);
      eng.frame(img); take();
    }
  }
  eng.reset();
  for (let t = 0; t < 20; t++) { img.fill(t % 10 < 5 ? 1 : 0); eng.frame(img); take(); }
  return sc;
}
