// node tools/validate_v1.js data/v1 <lgn_ref.json> : LGN rates vs the Python FilterNet, and V1 speed / rates on grey
const fs = require('fs'), path = require('path'), {V1Engine} = require('../../js/v1engine.js');
const dir = process.argv[2], ref = JSON.parse(fs.readFileSync(process.argv[3]));
const buf = f => { const b = fs.readFileSync(path.join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
let t0 = Date.now();
const E = new V1Engine(JSON.parse(fs.readFileSync(path.join(dir, 'v1meta.json'))), buf('v1net.bin'), buf('v1cells.bin'), buf('v1lgn.bin'));
console.log('built in', Date.now() - t0, 'ms; N', E.N, 'rec', E.recW.length, 'lgn', E.lgnW.length);
// grating identical to tools/v1/gratings.py (theta, cpd 0.04, 2 Hz, contrast 0.8, grey before onset)
const img = new Float32Array(9600), th = Math.PI * (180 - ref.frames_theta) / 180;
const frame = t => { for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) img[y * 120 + x] = t < ref.pre ? 0 : 0.8 * Math.sin(2 * Math.PI * (0.04 * (x * Math.cos(th) + y * Math.sin(th)) + 2 * (t - ref.pre) / 1000) + Math.PI); return img; };
const L = E.lgn; L.reset(); let worst = 0, num = 0, den = 0;
for (let b = 0; b < ref.T / 10; b++) {
  L.setFrame(frame(b * 10)); const R = L.binStep();
  if (b > 0) ref.pick.forEach((u, k) => { const d = R[u] - ref.rates[b][k]; num += d * d; den += ref.rates[b][k] ** 2; });
}
console.log('LGN: relative RMS error vs Python (1 ms) over 1.2 s grating:', Math.sqrt(num / den).toFixed(3));
// V1 on grey
E.reset(); E.lgn.reset(); for (let u = 0; u < E.lgnP.length; u++) E.lgnP[u] = 1 - Math.exp(-E.lgn.rate[u] / 1000);
E.v.set(new Float32Array(buf('v1cells.bin'), 16 * E.N, E.N));
const counts = new Float32Array(E.N); t0 = Date.now();
for (let t = 0; t < 1500; t++) { E.step(); if (t >= 500) for (let k = 0; k < E.nspk; k++) counts[E.spk[k]]++; }
const ms = (Date.now() - t0) / 1500;
console.log(`V1: ${ms.toFixed(2)} ms per simulated ms (${(1 / ms).toFixed(2)}x real time)`);
const pops = E.m.pops, byPop = {};
for (let i = 0; i < E.N; i++) { const p = pops[E.cls[i]]; (byPop[p] = byPop[p] || [0, 0]); byPop[p][0] += counts[i]; byPop[p][1]++; }
console.log(JSON.stringify(Object.fromEntries(Object.entries(byPop).map(([p, [c, n]]) => [p, +(c / n).toFixed(2)]))));
