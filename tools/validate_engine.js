// node tools/validate_engine.js data ref.json : compare the JS engine with the Python reference simulator
const fs = require('fs'), path = require('path'), MouseEngine = require('../js/engine.js');
const dir = process.argv[2], ref = JSON.parse(fs.readFileSync(process.argv[3]));
const buf = f => { const b = fs.readFileSync(path.join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const eng = new MouseEngine(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'))), buf('net.bin'), buf('cells.bin'));
let worst = 0, t0 = Date.now();
ref.frames.forEach((fr, t) => {
  eng.frame(Float32Array.from(fr));
  let mean = 0; for (let i = 0; i < eng.N; i++) mean += eng.r[i]; mean /= eng.N;
  let err = 0; ref.pick.forEach((i, k) => err = Math.max(err, Math.abs(eng.r[i] - ref.r[t][k])));
  worst = Math.max(worst, err);
  console.log(`frame ${t}: mean js ${mean.toFixed(5)} py ${ref.mean[t].toFixed(5)}  max|dr| ${err.toExponential(2)}`);
});
console.log('worst', worst.toExponential(2), 'ms per frame', ((Date.now() - t0) / ref.frames.length).toFixed(1));
