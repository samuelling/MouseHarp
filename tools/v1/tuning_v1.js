// node tools/tuning_v1.js data/v1 : drifting gratings at 0 and 90 deg; rate of L4/L2/3 excitatory cells grouped by preferred orientation
const fs = require('fs'), path = require('path'), {V1Engine} = require('../../js/v1engine.js');
const dir = process.argv[2]; const buf = f => { const b = fs.readFileSync(path.join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'v1meta.json'))), E = new V1Engine(meta, buf('v1net.bin'), buf('v1cells.bin'), buf('v1lgn.bin'));
const rf = buf('v1rf.bin'), pref = new Float32Array(rf, 8 * E.N, E.N), img = new Float32Array(9600);
const grating = (theta, t) => { const ph = Math.PI * (180 - theta) / 180; for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) img[y * 120 + x] = 0.8 * Math.sin(2 * Math.PI * (0.04 * (x * Math.cos(ph) + y * Math.sin(ph)) + 2 * t) + Math.PI); return img; };
for (const th of [0, 90]) {
  E.reset(); const cnt = new Float32Array(E.N);
  for (let t = 0; t < 1500; t++) { if (t % 20 === 0) E.setFrame(grating(th, t / 1000)); E.step(); if (t >= 500) for (let k = 0; k < E.nspk; k++) cnt[E.spk[k]]++; }
  for (const [label, test] of [['L4 E', p => p.startsWith('e4')], ['L2/3 E', p => p.startsWith('e23')]]) {
    const near = [0, 0], far = [0, 0];
    for (let i = 0; i < E.N; i++) { if (!test(meta.pops[E.cls[i]])) continue; const d = Math.abs(((pref[i] - th) % 180 + 270) % 180 - 90); if (d < 20) { near[0] += cnt[i]; near[1]++; } else if (d > 70) { far[0] += cnt[i]; far[1]++; } }
    console.log(`grating ${th} deg, ${label}: preferring it ${(near[0] / near[1]).toFixed(2)} Hz, preferring orthogonal ${(far[0] / far[1]).toFixed(2)} Hz`);
  }
}
