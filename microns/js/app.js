// MouseHarp main thread: stimulus -> worker (cortex) -> string detectors -> notes; plus drawing.
(() => {
  const $ = id => document.getElementById(id);
  const DT_FRAME = 0.02;                       // simulated seconds per frame (2 steps of 10 ms)
  const CLASS_COL = ['#7DB0FF', '#4fb3a4', '#e0c35a', '#c98fe0', '#ff6b6b', '#ff9e5e', '#9ad17a', '#ff68ba'];
  const AREA_PAN = [0, -0.65, 0.65, 0.9];
  const BASE = [72, 60, 48, 36, 84, 72, 96, 60];  // MIDI base per class (C); orientation picks the scale degree
  const DUR = [0.5, 0.45, 0.8, 1.6, 0.15, 1.0, 1.2, 0.3];
  const ENGINES = {pluck: 'harp', modal: 'marimba', fm: 'FM bell', pad: 'bowed pad', glass: 'glass', click: 'pitched click'};
  const cls = [['pluck', 0.8], ['modal', 0.8], ['fm', 0.75], ['pad', 0.7], ['click', 0.6], ['glass', 0.6], ['fm', 0.5], ['click', 0.5]]
    .map(([engine, level], g) => ({engine, level, mute: false, solo: false}));
  const areaOn = [true, true, true, true];
  const SCALES = {majpent: [0, 2, 4, 7, 9], minpent: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    hirajoshi: [0, 2, 3, 7, 8], whole: [0, 2, 4, 6, 8, 10]};
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const worker = new Worker('js/worker.js');
  let ready = false, playing = false, busy = false, simT = 0, lastReal = 0, owed = 0, tokens = 20, M = null;
  let C = null, nS = 0, NB = 7, scale = null, sCount = null, lastR = null, base = null, armed = null, lastFire = null;
  const roll = [], traces = []; let rollW = 0;

  // ---------------------------------------------------------------- controls
  const P = {kind: 'webcam', contrast: 0.8, ori: 0, sf: 5, speed: 1, size: 6};
  const bind = (id, fmt, key) => { const el = $(id), out = el.parentElement.querySelector('output');
    const f = () => { if (key) P[key] = +el.value; if (out) out.textContent = fmt(+el.value); }; el.oninput = f; f(); };
  bind('contrast', v => v.toFixed(2), 'contrast'); bind('ori', v => v + '°', 'ori'); bind('sf', v => v + ' c/screen', 'sf');
  bind('speed', v => v.toFixed(1), 'speed'); bind('size', v => v, 'size'); bind('tempo', v => v.toFixed(2) + '×');
  bind('thresh', v => v.toFixed(2)); bind('rate', v => v); bind('vol', v => v.toFixed(2)); bind('rev', v => v.toFixed(2));
  $('vol').addEventListener('input', () => Sound.setVolume(+$('vol').value)); $('rev').addEventListener('input', () => Sound.setReverb(+$('rev').value));
  $('root').innerHTML = NAMES.map((n, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${n}</option>`).join('');
  $('kind').onchange = async () => { P.kind = $('kind').value; if (P.kind === 'webcam') useCamera(); updateHint(); };
  $('reset').onclick = () => worker.postMessage({cmd: 'reset'});
  $('go').onclick = async () => {
    if (!playing) { await Sound.start(); Sound.setVolume(+$('vol').value); Sound.setReverb(+$('rev').value); playing = true; $('go').textContent = '❚❚ Pause sound'; if (P.kind === 'webcam') useCamera(); if (C) status(`${C.N.toLocaleString()} neurons, ${(C.E / 1e6).toFixed(2)}M connections · playing`); }
    else { playing = false; Sound.allNotesOff(); $('go').textContent = '▶ Start'; }
  };
  Sound.initMIDI().then(list => { $('midiOut').innerHTML = '<option value="">none</option>' + list.map(o => `<option value="${o.id}">${o.name}</option>`).join(''); });
  $('midiOut').onchange = () => Sound.setOutput($('midiOut').value);
  async function useCamera() { const ok = await Stimuli.startCamera(); if (!ok) { status('camera unavailable: showing a rotating grating'); $('kind').value = 'rotate'; P.kind = 'rotate'; } updateHint(); }
  function status(s) { $('status').textContent = s; }
  function updateHint() {
    $('viewHint').textContent = P.kind === 'webcam' ? 'Move something with straight edges (a pen, your hand, a book) and turn it: each angle is a different string.'
      : P.kind === 'paint' ? 'Draw on the big view with your pointer.' : P.kind === 'rotate' ? 'The grating turns slowly, so the orientation strings play in order.' : '';
  }

  // class rows
  function renderClasses() {
    if (!M) return;
    const anySolo = cls.some(c => c.solo);
    $('classes').innerHTML = Info.groups.map((I, g) => `<div class="mclass ${cls[g].mute || (anySolo && !cls[g].solo) ? 'muted' : ''}" data-g="${g}">
      <i class="swatch" style="background:${CLASS_COL[g]}"></i><b>${I.short}</b><span class="nm">${I.name}</span>
      <select data-k="engine">${Object.entries(ENGINES).map(([k, n]) => `<option value="${k}" ${k === cls[g].engine ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="sm ${cls[g].solo ? 'on' : ''}" data-k="solo">S</button><button class="sm ${cls[g].mute ? 'on' : ''}" data-k="mute">M</button>
      <span class="cnt">${M.counts.per_group[g].toLocaleString()}</span></div>`).join('');
    $('classes').querySelectorAll('.mclass').forEach(row => {
      const g = +row.dataset.g;
      row.querySelector('select').onchange = e => { cls[g].engine = e.target.value; };
      row.querySelectorAll('button').forEach(b => b.onclick = () => { cls[g][b.dataset.k] = !cls[g][b.dataset.k]; renderClasses(); });
      row.onmouseenter = e => tipShow(e, `<h4 style="color:${CLASS_COL[g]}">${Info.groups[g].name}</h4><div class="k">${Info.groups[g].sub} · ${M.counts.per_group[g].toLocaleString()} cells</div>${Info.groups[g].text}`);
      row.onmousemove = tipMove; row.onmouseleave = tipHide;
    });
    $('areaRow').innerHTML = Info.areas.map((A, a) => `<button class="chip ${areaOn[a] ? 'on' : ''}" data-a="${a}">${A.name} <span>${M.counts.per_area[a].toLocaleString()}</span></button>`).join('');
    $('areaRow').querySelectorAll('.chip').forEach(b => {
      const a = +b.dataset.a; b.onclick = () => { areaOn[a] = !areaOn[a]; renderClasses(); };
      b.onmouseenter = e => tipShow(e, `<h4>${Info.areas[a].name}</h4>${Info.areas[a].text}`); b.onmousemove = tipMove; b.onmouseleave = tipHide;
    });
  }
  const tip = $('tip');
  function tipShow(e, html) { tip.innerHTML = html; tip.style.opacity = 1; tipMove(e); }
  function tipMove(e) { const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px'; tip.style.top = Math.min(innerHeight - h - 8, e.clientY + 12) + 'px'; }
  function tipHide() { tip.style.opacity = 0; }
  const audible = g => { const anySolo = cls.some(c => c.solo); return !cls[g].mute && (!anySolo || cls[g].solo); };

  // ---------------------------------------------------------------- lenses for the main view
  const LENSES = [
    {id: 'measured', name: 'Imaged neurons', sub: 'tuning measured in vivo', info: 'The neurons that were imaged while the mouse watched movies and then found in the EM volume. Their receptive-field centres and preferred orientations come from the MICrONS digital twin. These are the cortex\'s eyes in this model: the only cells the image reaches directly.', test: i => C.oriSrc[i] === 1},
    {id: 'L23', name: 'L2/3', sub: 'imaged + model-mapped', g: 0}, {id: 'L4', name: 'L4', sub: 'imaged + model-mapped', g: 1},
    {id: 'L5', name: 'L5', sub: 'imaged + model-mapped', g: 2}, {id: 'L6', name: 'L6', sub: 'almost all model-mapped', g: 3},
    {id: 'inh', name: 'Inhibitory', sub: 'all model-mapped', info: 'None of the interneurons were imaged, so the image never reaches them directly. Each tick shows the receptive field and orientation the cell acquires in the model through its synapses, mapped in silico with gratings and flickering patches the way you would map a real neuron. Many are broadly tuned and are left out.', test: i => C.grp[i] >= 4},
  ];
  LENSES.forEach(L => { if (L.g !== undefined) { L.test = i => C.grp[i] === L.g; L.info = `${Info.groups[L.g].text} Imaged cells show their measured tuning; the rest show the tuning they acquire in the model through their inputs.`; } });
  let lens = 'measured', lensCells = null;
  function renderLenses() {
    $('lenses').innerHTML = LENSES.map(L => `<button class="lens ${L.id === lens ? 'on' : ''}" data-l="${L.id}"><b>${L.name}</b><span>${L.sub}</span><em class="n" id="n_${L.id}"></em></button>`).join('');
    $('lenses').querySelectorAll('.lens').forEach(b => b.onclick = () => { lens = b.dataset.l; renderLenses(); pickLens(); });
    const L = LENSES.find(x => x.id === lens); $('lensInfo').textContent = L.info; $('lensTag').textContent = L.name;
    if (C) LENSES.forEach(x => { let n = 0; for (let i = 0; i < C.N; i++) if (x.test(i) && C.oriSrc[i] && !isNaN(C.rfx[i])) n++; $('n_' + x.id).textContent = n.toLocaleString() + ' ticks'; });
  }
  function pickLens() {
    const L = LENSES.find(x => x.id === lens), a = [];
    for (let i = 0; i < C.N; i++) if (L.test(i) && C.oriSrc[i] && !isNaN(C.rfx[i])) a.push(i);
    lensCells = Int32Array.from(a);
  }

  // ---------------------------------------------------------------- worker
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.cmd === 'ready') {
      M = m.meta; C = m; nS = m.nS; NB = m.NB; scale = Float32Array.from(m.scale); sCount = m.sCount;
      base = new Float32Array(nS); armed = new Uint8Array(nS).fill(1); lastFire = new Float32Array(nS).fill(-9);
      // per-cell response scale for drawing: the calibrated range of the cell's string
      C.cellScale = new Float32Array(C.N);
      for (let i = 0; i < C.N; i++) { const b = C.oriSrc[i] ? Math.min(5, Math.floor(C.ori[i] / 30)) : 6; C.cellScale[i] = Math.max(0.02, scale[(C.grp[i] * 4 + C.area[i]) * NB + b]); }
      // jitter so cells sharing a receptive-field pixel don't stack exactly
      C.jx = new Float32Array(C.N); C.jy = new Float32Array(C.N);
      let sd = 12345; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647 - 0.5;
      for (let i = 0; i < C.N; i++) { C.jx[i] = rnd() * 0.9; C.jy[i] = rnd() * 0.9; }
      renderClasses(); renderLenses(); pickLens(); drawOriKey();
      $('aboutData').innerHTML = `The cortex here is the <b>MICrONS cubic millimetre</b> of mouse visual cortex (V1 and higher areas RL, AL, LM): ${C.N.toLocaleString()} neurons reconstructed from electron microscopy, with ${(M.synapses_total / 1e6).toFixed(1)} million synapses between them. MouseHarp keeps the ${(M.E / 1e6).toFixed(2)} million connections made of two or more synapses (${(M.synapses_kept / 1e6).toFixed(1)}M synapses) and rescales each neuron's remaining excitatory and inhibitory input to its full total. ${M.counts.functional.toLocaleString()} of the neurons were also imaged in the living mouse.`;
      ready = true; status(`${C.N.toLocaleString()} neurons, ${(C.E / 1e6).toFixed(2)}M connections running · press Start for sound`);
      if (P.kind === 'webcam') useCamera();
      updateHint();
      window.MouseHarp = {C, M, r: () => lastR, requestEdges: k => worker.postMessage({cmd: 'edges', k})};
      window.dispatchEvent(new Event('mouseharp-ready'));
    } else if (m.cmd === 'edges') window.dispatchEvent(new CustomEvent('mouseharp-edges', {detail: m}));
    else if (m.cmd === 'frames') {
      busy = false; lastR = m.r;
      const events = [];
      m.steps.forEach((a, k) => { detect(a, simT + k * DT_FRAME, events, k); pushTrace(a); });
      simT += m.steps.length * DT_FRAME;
      events.sort((p, q) => q.vel - p.vel);
      const keep = events.slice(0, Math.max(0, Math.floor(tokens))); tokens -= keep.length;
      const tempo = +$('tempo').value;
      keep.forEach(ev => setTimeout(() => fire(ev), ev.k * DT_FRAME / tempo * 1000));
    }
  };
  worker.postMessage({cmd: 'init', base: new URL('data/', location.href).href});

  // ---------------------------------------------------------------- strings -> notes
  function detect(a, t, out, k) {
    const th = +$('thresh').value;
    for (let s = 0; s < nS; s++) {
      if (!sCount[s]) continue;
      const v = a[s] / scale[s], rise = v - base[s];
      base[s] += 0.03 * (v - base[s]);
      if (armed[s] && rise > th && t - lastFire[s] > 0.12) {
        const g = Math.floor(s / (4 * NB)), ar = Math.floor(s / NB) % 4, b = s % NB;
        armed[s] = 0; lastFire[s] = t;
        if (areaOn[ar]) out.push({s, g, ar, b, vel: Math.max(0.15, Math.min(1, rise * 2.2)), k});
      } else if (!armed[s] && rise < th * 0.4) armed[s] = 1;
    }
  }
  function pitch(g, b) {
    const sc = SCALES[$('scale').value], root = +$('root').value;
    if (b === 6) return BASE[g] + root - 12;                        // untuned cells: the root, an octave down
    const d = sc[b % sc.length] + 12 * Math.floor(b / sc.length);
    return BASE[g] + root + d;
  }
  function hash(n) { let h = 2166136261 ^ n; h = Math.imul(h ^ (h >>> 13), 16777619); return ((h >>> 0) % 1000) / 1000; }
  function timbre(g, ar) {
    const eng = cls[g].engine, h1 = hash(g * 7 + ar), h2 = hash(g * 13 + ar + 5), slow = [0.4, 0.35, 0.6, 0.9, 0.1, 0.7, 0.8, 0.2][g];
    switch (eng) {
      case 'pluck': return {decay: 0.990 + 0.0092 * slow, bright: 0.35 + 0.5 * h1};
      case 'modal': return {ratios: [1, 3.9 + 0.5 * h1, 9.2 + 2.5 * h2], decays: [0.2 + 1.1 * slow, 0.07 + 0.1 * slow, 0.03], amps: [1, 0.35, 0.12], attack: 0.002};
      case 'glass': return {ratios: [1, 1.0035, 2.32 + 0.12 * h1, 4.25 + 0.25 * h2], decays: [1.2 + 3 * slow, 1.2 + 3 * slow, 0.7, 0.35], amps: [0.6, 0.45, 0.22, 0.1], attack: 0.004};
      case 'fm': return {ratio: [1, 1.4142, 2, 3.5][ar], index: 1.2 + 3 * h1, idecay: 0.04 + 0.4 * slow, decay: 0.25 + 1.6 * slow};
      case 'pad': return {detune: 0.002 + 0.006 * h1, cutoff: 1.5 + 4 * h2, attack: 0.02 + 0.35 * slow, release: 0.25 + 1.4 * slow};
      case 'click': return {q: 12 + 70 * h1, decay: 0.04 + 0.35 * slow, gain: 0.07 + 0.05 * h2};
    }
  }
  function fire(ev) {
    const midi = pitch(ev.g, ev.b);
    roll.push({midi, g: ev.g, vel: ev.vel, x: rollW}); (window.__notes = window.__notes || [0, 0, 0, 0, 0, 0, 0, 0])[ev.g]++;
    flashes.push({g: ev.g, b: ev.b, born: performance.now()});
    if (!audible(ev.g) || !playing) return;
    Sound.play({midi, vel: ev.vel * cls[ev.g].level, pan: AREA_PAN[ev.ar] + (Math.random() - 0.5) * 0.15, dur: DUR[ev.g], engine: cls[ev.g].engine, p: timbre(ev.g, ev.ar), channel: ev.g},
      {internal: $('internal').checked, midi: true});
    jitter();
  }

  // ---------------------------------------------------------------- the mast plays along (as in FlyHarp)
  const logo = document.querySelector('.logo'), whiskers = [...document.querySelectorAll('#logo .strings')];
  let lastJit = 0; const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function doJit() { if (reduced) return; logo.classList.remove('jit'); void logo.offsetWidth; logo.classList.add('jit'); lastJit = performance.now(); }
  logo.addEventListener('animationend', e => { if (e.target.classList.contains('mis')) logo.classList.remove('jit'); });
  (function idle() { setTimeout(() => { if (!document.hidden && performance.now() - lastJit > 3000) doJit(); idle(); }, 3500 + Math.random() * 5500); })();
  function jitter() {
    if (performance.now() - lastJit > 420 && Math.random() < 0.3) doJit();
    const w = whiskers[Math.random() < 0.5 ? 0 : 1]; if (w && !w.classList.contains('ring')) { w.classList.add('ring'); setTimeout(() => w.classList.remove('ring'), 230); }
  }

  // ---------------------------------------------------------------- main loop
  function tick(now) {
    const tempo = +$('tempo').value;
    if (!lastReal) lastReal = now;
    const dt = Math.min(0.1, (now - lastReal) / 1000); lastReal = now;
    tokens = Math.min(+$('rate').value, tokens + dt * +$('rate').value);
    owed += dt * tempo / DT_FRAME;
    if (ready && !busy && owed >= 1) {
      const n = Math.min(4, Math.floor(owed)); owed -= n; if (owed > 8) owed = 0;
      const frames = [];
      for (let k = 0; k < n; k++) { Stimuli.render(P, simT + k * DT_FRAME); frames.push(Float32Array.from(Stimuli.pool())); }
      busy = true; worker.postMessage({cmd: 'run', frames}, frames.map(f => f.buffer));
    }
    drawView(); drawRoll(dt); drawTraces();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- drawing: what the cortex sees
  const view = $('view'), vx = view.getContext('2d'), raw = $('raw'), rx = raw.getContext('2d');
  const rawImg = rx.createImageData(Stimuli.W, Stimuli.H);
  const flashes = [];
  const oriCol = (o, a) => `hsla(${(o * 2) % 360}, 85%, ${30 + 45 * a}%, ${0.18 + 0.82 * a})`;
  function drawView() {
    const W = view.width, H = view.height, img = Stimuli.img;
    for (let i = 0; i < Stimuli.W * Stimuli.H; i++) { const v = Math.round(img[i] * 255); rawImg.data.set([v, v, v, 255], 4 * i); }
    rx.putImageData(rawImg, 0, 0);
    vx.fillStyle = '#07080a'; vx.fillRect(0, 0, W, H);
    if ($('underlay').checked) { vx.globalAlpha = 0.28; vx.imageSmoothingEnabled = true; vx.drawImage(raw, 0, 0, W, H); vx.globalAlpha = 1; }
    if (!C || !lensCells) return;
    const sx = W / M.img[0], sy = H / M.img[1], L = 0.55 * sx, r = lastR;
    // bucket by orientation and activity so the canvas does few state changes
    const B = 12, buckets = Array.from({length: 18 * B}, () => []);
    for (let k = 0; k < lensCells.length; k++) {
      const i = lensCells[k]; const a = r ? Math.min(1, r[i] / C.cellScale[i]) : 0;
      buckets[Math.floor(C.ori[i] / 10) * B + Math.min(B - 1, Math.floor(a * B))].push(i);
    }
    vx.lineCap = 'round';
    for (let q = 0; q < buckets.length; q++) {
      const list = buckets[q]; if (!list.length) continue;
      const o = Math.floor(q / B) * 10 + 5, a = (q % B + 0.5) / B;
      vx.strokeStyle = oriCol(o, a); vx.lineWidth = 1 + 2.2 * a; vx.beginPath();
      for (const i of list) {
        const th = C.ori[i] * Math.PI / 180, dx = -Math.sin(th) * L * (0.6 + C.osi[i] / 255), dy = -Math.cos(th) * L * (0.6 + C.osi[i] / 255);
        const x = (C.rfx[i] + C.jx[i] + 0.5) * sx, y = (C.rfy[i] + C.jy[i] + 0.5) * sy;
        vx.moveTo(x - dx / 2, y - dy / 2); vx.lineTo(x + dx / 2, y + dy / 2);
      }
      vx.stroke();
    }
  }
  function drawOriKey() {
    const c = $('oriKey'), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.lineCap = 'round';
    for (let k = 0; k < 6; k++) { const o = k * 30, th = o * Math.PI / 180, cx = 10 + k * 20, cy = 18;
      x.strokeStyle = oriCol(o + 15, 0.9); x.lineWidth = 3; x.beginPath(); x.moveTo(cx + Math.sin(th) * 7, cy + Math.cos(th) * 7); x.lineTo(cx - Math.sin(th) * 7, cy - Math.cos(th) * 7); x.stroke();
      x.fillStyle = '#8a8f98'; x.font = '9px "Courier Prime", monospace'; x.textAlign = 'center'; x.fillText(o + '°', cx, 40); }
  }
  // paint
  view.addEventListener('pointermove', e => { if (P.kind !== 'paint' || !e.buttons) return; const r = view.getBoundingClientRect();
    Stimuli.stroke((e.clientX - r.left) / r.width * Stimuli.W, (e.clientY - r.top) / r.height * Stimuli.H, simT, e.shiftKey ? -1 : 1); });
  view.addEventListener('pointerdown', e => { if (P.kind === 'paint') view.setPointerCapture(e.pointerId); });

  // ---------------------------------------------------------------- piano roll
  const rc = $('roll'), rcx = rc.getContext('2d');
  function drawRoll(dt) {
    const W = rc.width, H = rc.height, speed = 120; rollW += dt * speed;
    rcx.fillStyle = '#0a0b0d'; rcx.fillRect(0, 0, W, H);
    const lo = 24, hi = 110, y = m => H - 8 - (m - lo) / (hi - lo) * (H - 16);
    rcx.strokeStyle = '#1a1d24'; rcx.lineWidth = 1;
    for (let m = 24; m <= 108; m += 12) { rcx.beginPath(); rcx.moveTo(0, y(m)); rcx.lineTo(W, y(m)); rcx.stroke(); }
    while (roll.length && rollW - roll[0].x > W + 40) roll.shift();
    for (const n of roll) {
      const x = W - (rollW - n.x) - 4, w = Math.max(3, DUR[n.g] * speed * 0.5);
      rcx.fillStyle = CLASS_COL[n.g]; rcx.globalAlpha = 0.35 + 0.65 * n.vel; rcx.fillRect(x, y(n.midi) - 2.5, w, 5);
    }
    rcx.globalAlpha = 1; rcx.font = '10px "Courier Prime", monospace'; rcx.textAlign = 'left';
    Info.groups.forEach((I, g) => { rcx.fillStyle = CLASS_COL[g]; rcx.fillText(I.short, 8 + g * 46, 14); });
  }

  // ---------------------------------------------------------------- class traces
  const tc = $('traces'), tcx = tc.getContext('2d'), TN = 400;
  function pushTrace(a) {
    const v = new Float32Array(16);           // class x (V1, higher areas)
    const n = new Float32Array(16);
    for (let s = 0; s < nS; s++) { if (!sCount[s]) continue; const g = Math.floor(s / (4 * NB)), ar = Math.floor(s / NB) % 4, k = g * 2 + (ar ? 1 : 0); v[k] += a[s] * sCount[s]; n[k] += sCount[s]; }
    for (let k = 0; k < 16; k++) v[k] = n[k] ? v[k] / n[k] : 0;
    traces.push(v); if (traces.length > TN) traces.shift();
  }
  function drawTraces() {
    const W = tc.width, H = tc.height, rows = 8, rh = H / rows;
    tcx.fillStyle = '#0a0b0d'; tcx.fillRect(0, 0, W, H);
    if (!traces.length) return;
    const peak = new Float32Array(16).fill(0.02);
    for (const v of traces) for (let k = 0; k < 16; k++) peak[k] = Math.max(peak[k], v[k]);
    for (let g = 0; g < rows; g++) {
      const y0 = g * rh;
      tcx.fillStyle = CLASS_COL[g]; tcx.font = '11px "Courier Prime", monospace'; tcx.textAlign = 'left'; tcx.fillText(Info.groups[g].short, 8, y0 + rh / 2 + 4);
      for (const hv of [0, 1]) {
        const k = g * 2 + hv, pk = Math.max(peak[g * 2], peak[g * 2 + 1]);
        tcx.strokeStyle = CLASS_COL[g]; tcx.lineWidth = hv ? 1.2 : 1.8; tcx.setLineDash(hv ? [4, 3] : []); tcx.globalAlpha = hv ? 0.7 : 1;
        tcx.beginPath();
        traces.forEach((v, i) => { const x = 60 + (W - 70) * (i / (TN - 1)) + (W - 70) * (TN - traces.length) / (TN - 1), y = y0 + rh - 4 - (rh - 10) * v[k] / pk; i ? tcx.lineTo(x, y) : tcx.moveTo(x, y); });
        tcx.stroke();
      }
      tcx.setLineDash([]); tcx.globalAlpha = 1; tcx.strokeStyle = '#1a1d24'; tcx.beginPath(); tcx.moveTo(0, y0 + rh); tcx.lineTo(W, y0 + rh); tcx.stroke();
    }
  }
})();
