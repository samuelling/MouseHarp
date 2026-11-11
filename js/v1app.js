// MouseHarp (V1 model) main thread: stimulus -> worker (LGN + V1 spiking model) -> string detectors -> notes; plus drawing.
(() => {
  const $ = id => document.getElementById(id);
  const FRAME_MS = 20;                                  // simulated ms per stimulus frame (LGN filters update every 10 ms)
  const COL = ['#ffd27a', '#7fb3ff', '#7DB0FF', '#4fb3a4', '#e0c35a', '#c98fe0', '#ff6b6b', '#ff9e5e', '#ff68ba'];
  const BASE = [79, 67, 72, 60, 48, 36, 84, 72, 96];
  const DUR = [0.5, 0.25, 0.5, 0.45, 0.8, 1.6, 0.15, 1.0, 0.3];
  const ENGINES = {pluck: 'harp', modal: 'marimba', fm: 'FM bell', pad: 'bowed pad', glass: 'glass', click: 'pitched click'};
  const fam = [['glass', 0.55], ['click', 0.6], ['pluck', 0.8], ['modal', 0.8], ['fm', 0.7], ['pad', 0.7], ['click', 0.55], ['glass', 0.55], ['fm', 0.45]]
    .map(([engine, level]) => ({engine, level, mute: false, solo: false}));
  const SCALES = {majpent: [0, 2, 4, 7, 9], minpent: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], hirajoshi: [0, 2, 3, 7, 8], whole: [0, 2, 4, 6, 8, 10]};
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const worker = new Worker('js/v1worker.js');
  let ready = false, playing = false, busy = false, simT = 0, lastReal = 0, owed = 0, tokens = 20, C = null;
  let nS = 0, NB = 6, base = null, scale = null, armed = null, lastFire = null, act = null, lgnRate = null, lgnBase = null, simRate = 0, lastBatch = 0, speedEMA = 0;
  const roll = [], traces = []; let rollW = 0;

  // ---------------------------------------------------------------- controls
  const P = {kind: 'webcam', contrast: 0.8, ori: 0, sf: 0.04, speed: 2, size: 6};
  const bind = (id, fmt, key) => { const el = $(id), out = el.parentElement.querySelector('output');
    const f = () => { if (key) P[key] = +el.value; if (out) out.textContent = fmt(+el.value); }; el.oninput = f; f(); };
  bind('contrast', v => v.toFixed(2), 'contrast'); bind('ori', v => v + '°', 'ori'); bind('sf', v => v.toFixed(2) + ' c/deg', 'sf');
  bind('speed', v => v + ' Hz', 'speed'); bind('size', v => v + '°', 'size'); bind('tempo', v => v.toFixed(2) + '×');
  bind('thresh', v => v.toFixed(2)); bind('rate', v => v); bind('vol', v => v.toFixed(2)); bind('rev', v => v.toFixed(2));
  $('vol').addEventListener('input', () => Sound.setVolume(+$('vol').value)); $('rev').addEventListener('input', () => Sound.setReverb(+$('rev').value));
  $('root').innerHTML = NAMES.map((n, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${n}</option>`).join('');
  $('kind').onchange = () => { P.kind = $('kind').value; if (P.kind === 'webcam') useCamera(); updateHint(); };
  $('reset').onclick = () => worker.postMessage({cmd: 'reset'});
  $('go').onclick = async () => {
    if (!playing) { await Sound.start(); Sound.setVolume(+$('vol').value); Sound.setReverb(+$('rev').value); playing = true; $('go').textContent = '❚❚ Pause sound'; if (P.kind === 'webcam') useCamera(); }
    else { playing = false; Sound.allNotesOff(); $('go').textContent = '▶ Start'; }
  };
  Sound.initMIDI().then(list => { $('midiOut').innerHTML = '<option value="">none</option>' + list.map(o => `<option value="${o.id}">${o.name}</option>`).join(''); });
  $('midiOut').onchange = () => Sound.setOutput($('midiOut').value);
  async function useCamera() { const ok = await Stimuli.startCamera(); if (!ok) { status('camera unavailable: showing a rotating grating'); $('kind').value = 'rotate'; P.kind = 'rotate'; } updateHint(); }
  function status(s) { $('status').textContent = s; }
  function updateHint() {
    $('viewHint').textContent = P.kind === 'webcam' ? 'Hold up something with straight edges and turn it: each angle plays a different string. The column\'s receptive fields sit in the middle of the screen.'
      : P.kind === 'paint' ? 'Draw on the screen with your pointer (shift for dark strokes).' : P.kind === 'rotate' ? 'The grating turns 12° a second, so V1\'s orientation strings take turns.' : '';
  }
  const tip = $('tip');
  function tipShow(e, html) { tip.innerHTML = html; tip.style.opacity = 1; tipMove(e); }
  function tipMove(e) { const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px'; tip.style.top = Math.min(innerHeight - h - 8, e.clientY + 12) + 'px'; }
  function tipHide() { tip.style.opacity = 0; }
  const audible = g => { const anySolo = fam.some(c => c.solo); return !fam[g].mute && (!anySolo || fam[g].solo); };
  function renderFamilies() {
    const anySolo = fam.some(c => c.solo);
    $('classes').innerHTML = Info.groups.map((I, g) => `<div class="mclass ${fam[g].mute || (anySolo && !fam[g].solo) ? 'muted' : ''}" data-g="${g}">
      <i class="swatch" style="background:${COL[g]}"></i><b>${I.short}</b>
      <select>${Object.entries(ENGINES).map(([k, n]) => `<option value="${k}" ${k === fam[g].engine ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="sm ${fam[g].solo ? 'on' : ''}" data-k="solo">S</button><button class="sm ${fam[g].mute ? 'on' : ''}" data-k="mute">M</button></div>`).join('');
    $('classes').querySelectorAll('.mclass').forEach(row => {
      const g = +row.dataset.g;
      row.querySelector('select').onchange = e => { fam[g].engine = e.target.value; };
      row.querySelectorAll('button').forEach(b => b.onclick = () => { fam[g][b.dataset.k] = !fam[g][b.dataset.k]; renderFamilies(); });
      row.onmouseenter = e => tipShow(e, `<h4 style="color:${COL[g]}">${Info.groups[g].name}</h4><div class="k">${Info.groups[g].sub}${C ? ' · ' + count(g).toLocaleString() + ' cells' : ''}</div>${Info.groups[g].text}`);
      row.onmousemove = tipMove; row.onmouseleave = tipHide;
    });
  }
  const count = g => { if (g < 2) { let n = 0; C.lgn.model.forEach(m => { if ((g === 0) === m.startsWith('sON')) n++; }); return n; } let n = 0; for (let i = 0; i < C.N; i++) if (C.G[i] === g) n++; return n; };
  renderFamilies();

  // ---------------------------------------------------------------- lenses
  const LENSES = [
    {id: 'lgn', name: 'LGN', sub: 'ON / OFF thalamic cells', g: [0, 1]},
    {id: 'l4', name: 'L4', sub: 'thalamorecipient', g: [3]}, {id: 'l23', name: 'L2/3', sub: 'superficial', g: [2]},
    {id: 'l5', name: 'L5', sub: 'output layer', g: [4]}, {id: 'l6', name: 'L6', sub: 'corticothalamic', g: [5]},
    {id: 'inh', name: 'Inhibitory', sub: 'PV · SST · VIP', g: [6, 7, 8]},
  ];
  LENSES.forEach(L => L.info = L.id === 'lgn' ? `${Info.groups[0].text}` : L.id === 'inh' ? 'Interneurons of all layers, drawn at their receptive fields with the orientation of their LGN input. Most are far more broadly tuned than pyramidal cells.' : Info.groups[L.g[0]].text);
  let lens = 'l4', lensCells = null;
  function renderLenses() {
    $('lenses').innerHTML = LENSES.map(L => `<button class="lens ${L.id === lens ? 'on' : ''}" data-l="${L.id}"><b>${L.name}</b><span>${L.sub}</span><em class="n" id="n_${L.id}"></em></button>`).join('');
    $('lenses').querySelectorAll('.lens').forEach(b => b.onclick = () => { lens = b.dataset.l; renderLenses(); pickLens(); });
    const L = LENSES.find(x => x.id === lens); $('lensInfo').textContent = L.info; $('lensTag').textContent = L.name;
    $('lensLegend').innerHTML = lens === 'lgn' ? '<span class="key"><i style="background:#ffd27a"></i>ON cell firing above its resting rate <i style="background:#7fb3ff"></i>OFF cell firing above rest</span>'
      : '<canvas id="oriKey" width="120" height="44"></canvas><span>tick angle and colour: preferred orientation · brightness: spiking</span>';
    if (lens !== 'lgn') drawOriKey();
    if (C) LENSES.forEach(x => $('n_' + x.id).textContent = (x.id === 'lgn' ? C.lgn.n : x.g.reduce((a, g) => a + count(g), 0)).toLocaleString() + ' cells');
  }
  function pickLens() { const L = LENSES.find(x => x.id === lens); const a = []; if (lens !== 'lgn') for (let i = 0; i < C.N; i++) if (L.g.includes(C.G[i])) a.push(i); lensCells = Int32Array.from(a); }

  // ---------------------------------------------------------------- worker
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.cmd === 'ready') {
      C = m; nS = m.nS; NB = m.NB;
      base = new Float32Array(nS); scale = new Float32Array(nS).fill(3); armed = new Uint8Array(nS).fill(1); lastFire = new Float32Array(nS).fill(-9);
      act = new Float32Array(C.N); lgnRate = new Float32Array(C.lgn.n); lgnBase = null;
      C.jx = new Float32Array(C.N); C.jy = new Float32Array(C.N); let sd = 12345; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647 - 0.5;
      for (let i = 0; i < C.N; i++) { C.jx[i] = rnd() * 1.6; C.jy[i] = rnd() * 1.6; }
      // the patch of visual field the column covers: 2nd-98th percentile of RF centres, padded, at the view's 3:2 aspect
      const q = (a, f) => { const b = Array.from(a).sort((x, y) => x - y); return b[Math.floor(f * (b.length - 1))]; };
      let x0 = q(C.rx, 0.02) - 6, x1 = q(C.rx, 0.98) + 6, y0 = q(C.ry, 0.02) - 6, y1 = q(C.ry, 0.98) + 6;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; let w = x1 - x0, h = y1 - y0; if (w / h > 1.5) h = w / 1.5; else w = h * 1.5;
      C.win = [cx - w / 2, cy - h / 2, w, h];
      renderFamilies(); renderLenses(); pickLens(); writeAbout();
      ready = true; status(`${C.N.toLocaleString()} V1 neurons, ${C.lgn.n.toLocaleString()} LGN cells, ${((C.E.rec + C.E.lgn) / 1e6).toFixed(1)}M synapses · press Start for sound`);
      if (P.kind === 'webcam') useCamera();
      updateHint();
      window.MouseHarp = {C, act: () => act, requestEdges: k => worker.postMessage({cmd: 'edges', k})};
      window.dispatchEvent(new Event('mouseharp-ready'));
    } else if (m.cmd === 'edges') window.dispatchEvent(new CustomEvent('mouseharp-edges', {detail: m}));
    else if (m.cmd === 'frames') {
      busy = false;
      const now = performance.now(), simMs = m.steps.length * FRAME_MS;
      if (lastBatch) { const ratio = simMs / (now - lastBatch); speedEMA = speedEMA ? 0.9 * speedEMA + 0.1 * ratio : ratio; }
      lastBatch = now; simRate = m.rate;
      for (let i = 0; i < C.N; i++) act[i] = Math.min(1, act[i] * 0.45 + m.cells[i] * 0.6);
      lgnRate.set(m.lgn); if (!lgnBase) lgnBase = Float32Array.from(m.lgn); else for (let u = 0; u < lgnBase.length; u++) lgnBase[u] += 0.002 * (m.lgn[u] - lgnBase[u]);
      const events = [];
      m.steps.forEach((a, k) => { detect(a, simT + k * FRAME_MS / 1000, events, k); pushTrace(a); });
      simT += simMs / 1000;
      events.sort((p, q) => q.vel - p.vel);
      const keep = events.slice(0, Math.max(0, Math.floor(tokens))); tokens -= keep.length;
      const tempo = +$('tempo').value;
      keep.forEach(ev => setTimeout(() => fire(ev), ev.k * FRAME_MS / tempo));
      if (playing) status(`${C.N.toLocaleString()} V1 neurons · ${simRate.toFixed(1)} spikes/s per neuron · running at ${speedEMA.toFixed(2)}× real time`);
    }
  };
  worker.postMessage({cmd: 'init', base: new URL('data/v1/', location.href).href});

  // ---------------------------------------------------------------- strings -> notes
  function detect(a, t, out, k) {
    const th = +$('thresh').value;
    for (let s = 0; s < nS; s++) {
      const r = a[s]; scale[s] = Math.max(scale[s] * 0.9995, r, 1);
      const v = r / scale[s], rise = v - base[s]; base[s] += 0.06 * (v - base[s]);
      if (armed[s] && rise > th && t - lastFire[s] > 0.12) { armed[s] = 0; lastFire[s] = t; out.push({s, g: Math.floor(s / NB), b: s % NB, vel: Math.max(0.15, Math.min(1, rise * 1.6)), k}); }
      else if (!armed[s] && rise < th * 0.4) armed[s] = 1;
    }
  }
  function pitch(g, b) { const sc = SCALES[$('scale').value], root = +$('root').value; return BASE[g] + root + sc[b % sc.length] + 12 * Math.floor(b / sc.length); }
  function hash(n) { let h = 2166136261 ^ n; h = Math.imul(h ^ (h >>> 13), 16777619); return ((h >>> 0) % 1000) / 1000; }
  function timbre(g, b) {
    const eng = fam[g].engine, h1 = hash(g * 7 + b), h2 = hash(g * 13 + b + 5), slow = [0.5, 0.15, 0.4, 0.35, 0.6, 0.9, 0.1, 0.7, 0.25][g];
    switch (eng) {
      case 'pluck': return {decay: 0.990 + 0.0092 * slow, bright: 0.35 + 0.5 * h1};
      case 'modal': return {ratios: [1, 3.9 + 0.5 * h1, 9.2 + 2.5 * h2], decays: [0.2 + 1.1 * slow, 0.07 + 0.1 * slow, 0.03], amps: [1, 0.35, 0.12], attack: 0.002};
      case 'glass': return {ratios: [1, 1.0035, 2.32 + 0.12 * h1, 4.25 + 0.25 * h2], decays: [1.2 + 3 * slow, 1.2 + 3 * slow, 0.7, 0.35], amps: [0.6, 0.45, 0.22, 0.1], attack: 0.004};
      case 'fm': return {ratio: [1, 1.4142, 2, 3.5][b % 4], index: 1.2 + 3 * h1, idecay: 0.04 + 0.4 * slow, decay: 0.25 + 1.6 * slow};
      case 'pad': return {detune: 0.002 + 0.006 * h1, cutoff: 1.5 + 4 * h2, attack: 0.02 + 0.35 * slow, release: 0.25 + 1.4 * slow};
      case 'click': return {q: 12 + 70 * h1, decay: 0.04 + 0.35 * slow, gain: 0.07 + 0.05 * h2};
    }
  }
  function fire(ev) {
    const midi = pitch(ev.g, ev.b);
    roll.push({midi, g: ev.g, vel: ev.vel, x: rollW});
    if (!audible(ev.g) || !playing) return;
    const pan = ev.g < 2 ? (ev.b / (NB - 1) - 0.5) * 1.6 : (ev.b / (NB - 1) - 0.5) * 0.8;
    Sound.play({midi, vel: ev.vel * fam[ev.g].level, pan, dur: DUR[ev.g], engine: fam[ev.g].engine, p: timbre(ev.g, ev.b), channel: ev.g}, {internal: $('internal').checked, midi: true});
    jitter();
  }
  // the mast plays along
  const logo = document.querySelector('.logo'), whiskers = [...document.querySelectorAll('#logo .strings')];
  let lastJit = 0; const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function doJit() { if (reduced) return; logo.classList.remove('jit'); void logo.offsetWidth; logo.classList.add('jit'); lastJit = performance.now(); }
  logo.addEventListener('animationend', e => { if (e.target.classList.contains('mis')) logo.classList.remove('jit'); });
  (function idle() { setTimeout(() => { if (!document.hidden && performance.now() - lastJit > 3000) doJit(); idle(); }, 3500 + Math.random() * 5500); })();
  function jitter() { if (performance.now() - lastJit > 420 && Math.random() < 0.3) doJit(); const w = whiskers[Math.random() < 0.5 ? 0 : 1]; if (w && !w.classList.contains('ring')) { w.classList.add('ring'); setTimeout(() => w.classList.remove('ring'), 230); } }

  // ---------------------------------------------------------------- main loop
  function tick(now) {
    const tempo = +$('tempo').value;
    if (!lastReal) lastReal = now;
    const dt = Math.min(0.1, (now - lastReal) / 1000); lastReal = now;
    tokens = Math.min(+$('rate').value, tokens + dt * +$('rate').value);
    owed += dt * tempo * 1000 / FRAME_MS;
    if (ready && !busy && owed >= 1) {
      const n = Math.min(3, Math.floor(owed)); owed -= n; if (owed > 6) owed = 0;
      const frames = []; for (let k = 0; k < n; k++) frames.push(Float32Array.from(Stimuli.render(P, simT + k * FRAME_MS / 1000)));
      busy = true; worker.postMessage({cmd: 'run', frames, ms: FRAME_MS}, frames.map(f => f.buffer));
    }
    drawView(); drawRoll(dt); drawTraces();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- what V1 sees
  const view = $('view'), vx = view.getContext('2d'), raw = $('raw'), rx = raw.getContext('2d'), rawImg = rx.createImageData(120, 80);
  const oriCol = (o, a) => `hsla(${(o * 2) % 360}, 85%, ${30 + 45 * a}%, ${0.15 + 0.85 * a})`;
  function drawView() {
    const W = view.width, H = view.height, img = Stimuli.img;
    for (let i = 0; i < 9600; i++) { const v = Math.round((img[i] * 0.5 + 0.5) * 255); rawImg.data[4 * i] = rawImg.data[4 * i + 1] = rawImg.data[4 * i + 2] = v; rawImg.data[4 * i + 3] = 255; }
    rx.putImageData(rawImg, 0, 0);
    vx.fillStyle = '#07080a'; vx.fillRect(0, 0, W, H);
    // LGN lens: the whole screen; V1 lenses: zoomed onto the column's patch of visual field
    const win = !C || lens === 'lgn' ? [0, 0, 120, 80] : C.win, sx = W / win[2], X = x => (x - win[0]) * sx, Y = y => (y - win[1]) * sx;
    if ($('underlay').checked) { vx.globalAlpha = 0.3; vx.imageSmoothingEnabled = true; vx.drawImage(raw, win[0], win[1], win[2], win[3], 0, 0, W, H); vx.globalAlpha = 1; }
    if (!C) return;
    if (lens === 'lgn') {
      const L = C.lgn;
      for (let u = 0; u < L.n; u++) {
        const d = lgnBase ? (lgnRate[u] - lgnBase[u]) / 25 : 0, a = Math.max(0, Math.min(1, d)); if (a < 0.03) continue;
        vx.fillStyle = L.model[u].startsWith('sON') ? `rgba(255,210,122,${a})` : `rgba(127,179,255,${a})`;
        vx.beginPath(); vx.arc(X(L.x[u]), Y(L.y[u]), 2 + 4 * a, 0, 2 * Math.PI); vx.fill();
      }
      const w = C.win; vx.strokeStyle = '#ffffff55'; vx.setLineDash([6, 6]); vx.lineWidth = 1.5; vx.strokeRect(X(w[0]), Y(w[1]), w[2] * sx, w[3] * sx); vx.setLineDash([]);
      vx.fillStyle = '#cfccc4'; vx.font = '13px "Courier Prime", monospace'; vx.fillText("the V1 column's patch of visual field", X(w[0]) + 6, Y(w[1]) - 8);
      return;
    }
    const B = 10, buckets = Array.from({length: 18 * B}, () => []);
    for (let k = 0; k < lensCells.length; k++) { const i = lensCells[k]; buckets[Math.floor(C.pref[i] / 10) * B + Math.min(B - 1, Math.floor(act[i] * B))].push(i); }
    vx.lineCap = 'round'; const Lt = 1.2 * sx;
    for (let q = 0; q < buckets.length; q++) {
      const list = buckets[q]; if (!list.length) continue;
      const o = Math.floor(q / B) * 10 + 5, a = (q % B + 0.5) / B;
      vx.strokeStyle = oriCol(o, a); vx.lineWidth = 0.8 + 2.4 * a; vx.beginPath();
      for (const i of list) {
        const ph = Math.PI * (180 - C.pref[i]) / 180, dx = -Math.sin(ph) * Lt, dy = Math.cos(ph) * Lt;      // bars run perpendicular to the grating's (cos, sin) axis
        const x = X(C.rx[i] + C.jx[i] * 0.6), y = Y(C.ry[i] + C.jy[i] * 0.6);
        vx.moveTo(x - dx / 2, y - dy / 2); vx.lineTo(x + dx / 2, y + dy / 2);
      }
      vx.stroke();
    }
    vx.fillStyle = '#8a8f98'; vx.font = '13px "Courier Prime", monospace';
    vx.fillText(`zoomed: ${win[2].toFixed(0)}° × ${win[3].toFixed(0)}° of the 120° × 80° screen`, 14, H - 14);
  }
  function drawOriKey() {
    const c = $('oriKey'); if (!c) return; const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.lineCap = 'round';
    for (let k = 0; k < 6; k++) { const o = k * 30, ph = Math.PI * (180 - o) / 180, cx = 10 + k * 20, cy = 18, dx = -Math.sin(ph) * 7, dy = Math.cos(ph) * 7;
      x.strokeStyle = oriCol(o + 5, 0.9); x.lineWidth = 3; x.beginPath(); x.moveTo(cx - dx, cy - dy); x.lineTo(cx + dx, cy + dy); x.stroke();
      x.fillStyle = '#8a8f98'; x.font = '9px "Courier Prime", monospace'; x.textAlign = 'center'; x.fillText(o + '°', cx, 40); }
  }
  view.addEventListener('pointermove', e => { if (P.kind !== 'paint' || !e.buttons) return; const r = view.getBoundingClientRect(), w = !C || lens === 'lgn' ? [0, 0, 120, 80] : C.win;
    Stimuli.stroke(w[0] + (e.clientX - r.left) / r.width * w[2], w[1] + (e.clientY - r.top) / r.height * w[3], simT, e.shiftKey ? -1 : 1); });
  view.addEventListener('pointerdown', e => { if (P.kind === 'paint') view.setPointerCapture(e.pointerId); });

  // ---------------------------------------------------------------- piano roll and traces
  const rc = $('roll'), rcx = rc.getContext('2d');
  function drawRoll(dt) {
    const W = rc.width, H = rc.height, speed = 120; rollW += dt * speed;
    rcx.fillStyle = '#0a0b0d'; rcx.fillRect(0, 0, W, H);
    const lo = 30, hi = 112, y = m => H - 8 - (m - lo) / (hi - lo) * (H - 16);
    rcx.strokeStyle = '#1a1d24'; for (let m = 36; m <= 108; m += 12) { rcx.beginPath(); rcx.moveTo(0, y(m)); rcx.lineTo(W, y(m)); rcx.stroke(); }
    while (roll.length && rollW - roll[0].x > W + 40) roll.shift();
    for (const n of roll) { const x = W - (rollW - n.x) - 4, w = Math.max(3, DUR[n.g] * speed * 0.5); rcx.fillStyle = COL[n.g]; rcx.globalAlpha = 0.35 + 0.65 * n.vel; rcx.fillRect(x, y(n.midi) - 2.5, w, 5); }
    rcx.globalAlpha = 1; rcx.font = '10px "Courier Prime", monospace'; rcx.textAlign = 'left';
    Info.groups.forEach((I, g) => { rcx.fillStyle = COL[g]; rcx.fillText(I.short, 8 + g * 42, 14); });
  }
  const tc = $('traces'), tcx = tc.getContext('2d'), TN = 400;
  function pushTrace(a) {
    const v = new Float32Array(9), n = new Float32Array(9);
    for (let s = 0; s < nS; s++) { const g = Math.floor(s / NB), w = C.sCount[s]; v[g] += a[s] * w; n[g] += w; }
    for (let g = 0; g < 9; g++) v[g] = n[g] ? v[g] / n[g] : 0;
    traces.push(v); if (traces.length > TN) traces.shift();
  }
  function drawTraces() {
    const W = tc.width, H = tc.height, rows = 9, rh = H / rows;
    tcx.fillStyle = '#0a0b0d'; tcx.fillRect(0, 0, W, H); if (!traces.length) return;
    for (let g = 0; g < rows; g++) {
      let pk = 0.5; for (const v of traces) pk = Math.max(pk, v[g]);
      const y0 = g * rh; tcx.fillStyle = COL[g]; tcx.font = '11px "Courier Prime", monospace'; tcx.textAlign = 'left';
      tcx.fillText(Info.groups[g].short, 8, y0 + rh / 2); tcx.fillStyle = '#6f7580'; tcx.fillText(pk.toFixed(0) + ' Hz', 8, y0 + rh / 2 + 12);
      tcx.strokeStyle = COL[g]; tcx.lineWidth = 1.6; tcx.beginPath();
      traces.forEach((v, i) => { const x = 70 + (W - 80) * ((i + TN - traces.length) / (TN - 1)), y = y0 + rh - 4 - (rh - 10) * v[g] / pk; i ? tcx.lineTo(x, y) : tcx.moveTo(x, y); });
      tcx.stroke(); tcx.strokeStyle = '#1a1d24'; tcx.beginPath(); tcx.moveTo(0, y0 + rh); tcx.lineTo(W, y0 + rh); tcx.stroke();
    }
  }
  function writeAbout() {
    $('aboutText').innerHTML = `
      <p>This is the <b>Allen Institute's biorealistic model of mouse V1</b>, the point-neuron version of the model introduced by Billeh et al. (Neuron 2020) and rebuilt in the <a href="https://github.com/AllenInstitute/biorealistic-v1-model">biorealistic-v1-model</a> project: cell types, densities and intrinsic properties from the Allen Cell Types database (GLIF3 neuron models fit to patch-clamp recordings), connection probabilities and synaptic strengths from Allen synaptic physiology and MICrONS electron microscopy, and recurrent weights then trained (with constraints on their distributions) so the network matches Neuropixels recordings of mouse V1 (the <code>bio_trained</code> weights of network <code>core_nll_0</code>, from <a href="https://github.com/JavierGalvan9/V1_GLIF_model">V1_GLIF_model</a>).</p>
      <p><b>The input stage</b> is the model's own LGN (FilterNet): ${C.lgn.n.toLocaleString()} thalamic cells here (of 17,400), each a Gaussian receptive field with a temporal filter fit to recorded mouse dLGN responses (Durand et al. 2016): sustained ON, sustained and transient OFF, and ON/OFF cells with offset subfields. Their rates set Poisson spike trains into V1. A retinal stage is not modelled; these LGN filters already include what the retina does to the signal.</p>
      <h4>What runs in your browser</h4>
      <p>The full model column is 400 µm across, with ${C.full.N.toLocaleString()} neurons, ${(C.full.rec / 1e6).toFixed(1)}M recurrent and ${(C.full.lgn / 1e6).toFixed(1)}M LGN synapses: too large to download and run here. MouseHarp runs its central 200 µm (${C.N.toLocaleString()} neurons), keeping every one of their LGN and background inputs. Each synapse those neurons received from the outer ring is rewired to come from a stand-in inside the column: a neuron of the same cell type whose responses (to a grey screen and to gratings in 8 directions, in the full model) best match the missing cell's. Simpler stand-ins (average rates, with or without fluctuations) let layer 6 fall silent; these keep it alive.</p>
      <p>Each neuron is a GLIF3 point neuron (leaky integrate-and-fire with two after-spike currents), integrated exactly in 1 ms steps; synapses are sums of four alpha functions; recurrent connections have their own delays; background input is 100 Poisson sources at 250 Hz. The step and synapse model follow the trained model's TensorFlow implementation. Weights are stored to 8 bits (log scale) and the LGN filters run at 10 ms resolution.</p>
      <h4>How close is it?</h4>
      <p>My reimplementation of the full column, on a grey screen, against Neuropixels spontaneous rates (mean Hz):</p>
      <table><tr><th>class</th><th>model</th><th>recorded</th></tr>
      <tr><td>L2/3 excitatory</td><td>1.2</td><td>1.5</td></tr><tr><td>L4 excitatory</td><td>3.6</td><td>3.6</td></tr><tr><td>L5 excitatory</td><td>5.5</td><td>5.7</td></tr><tr><td>L6 excitatory</td><td>3.1</td><td>3.1</td></tr>
      <tr><td>L4 PV</td><td>9.7</td><td>10.5</td></tr><tr><td>L2/3 VIP</td><td>12.2</td><td>12.6</td></tr><tr><td>L2/3 SST</td><td>2.4</td><td>5.3</td></tr></table>
      <p>The 200 µm column with stand-ins reproduces the full column's grating-driven rates for most classes to within about 25% (the largest misses: L4 VIP 46% too high, L6 SST 27% too low). Storing weights at 8 bits changes nothing measurable. Its orientation selectivity is weaker, most in the deep layers (median OSI of L5 excitatory cells 0.23 against 0.35 in the full column). The browser engine matches the Python reference: LGN rates within 7% (RMS) and the same rates per class on a grey screen. SST cells fire less than recorded, as in the full model.</p>
      <p class="muted">Not modelled: the retina, feedback from V1 to the LGN, higher visual areas, running, arousal and anything learned. The MICrONS connectome version of MouseHarp is still here: <a href="microns/">MouseHarp · MICrONS wiring</a>. Sister project: <a href="https://github.com/samuelling/FlyHarp">FlyHarp</a>.</p>`;
  }
})();
