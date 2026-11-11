// Inside the column: every simulated V1 neuron at its model position, strongest inputs as sticks, flashing as it spikes.
import * as THREE from './vendor/three.module.min.js';
import {OrbitControls} from './vendor/OrbitControls.js';

const $ = id => document.getElementById(id);
const box = $('lobeWrap'), canvas = $('lobe'), tip = $('tipLobe') || $('lobeTip'), labelsEl = $('lobeLabels');
const EXC = new THREE.Color('#ffae42'), INH = new THREE.Color('#6a7dff'), HOT = new THREE.Color('#fff1c9');
const REST_E = new THREE.Color('#1f2228'), REST_I = new THREE.Color('#232845');
let api, C, N, renderer, scene, camera, controls, points, lines, pos, colAttr, sizeAttr, act, eSrc, eTgt, eW, eCol, lastR = null;
let visible = false, started = false, showSticks = true, lastDraw = 0, labels = [];
const S = 260;                                   // µm per world unit; model y is depth below pia (negative)
const toWorld = (x, y, z) => [x / S, (y + 440) / S, z / S];

function layout() {
  C = api.C; N = C.N;
  pos = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) pos.set(toWorld(C.pos[3 * i], C.pos[3 * i + 1], C.pos[3 * i + 2]), 3 * i);
  act = new Float32Array(N);
}
const VS = `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
  void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const FS = `varying vec3 vC;
  void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c,c)*4.0; if (r2 > 1.0) discard;
    float sph = sqrt(1.0 - r2); vec2 l = normalize(vec2(-0.6,0.6)); float hl = pow(max(0.0, dot(c*2.0, l)*0.5 + sph*0.6), 3.0);
    gl_FragColor = vec4(vC * (0.25 + 0.75*sph) + vC*hl*0.6, 1.0); }`;

function build() {
  renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.5; controls.minDistance = 0.8; controls.maxDistance = 10;
  view34();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  colAttr = new THREE.BufferAttribute(new Float32Array(3 * N), 3); colAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr = new THREE.BufferAttribute(new Float32Array(N).fill(0.008), 1); sizeAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('color', colAttr); g.setAttribute('size', sizeAttr);
  points = new THREE.Points(g, new THREE.ShaderMaterial({vertexShader: VS, fragmentShader: FS, uniforms: {uScale: {value: 600}}}));
  scene.add(points);
  // layer labels down the depth axis (median depth of each layer's excitatory cells)
  const mk = (text, cls, p) => { const d = document.createElement('span'); d.className = 'lobeLabel ' + cls; d.textContent = text; labelsEl.appendChild(d); labels.push({d, p: new THREE.Vector3(...p)}); };
  const xL = -(C.radius + 40) / S, zL = (C.radius + 20) / S;
  mk('pia', 'dim', toWorld(-(C.radius + 40), -40, C.radius + 20));
  [['L2/3', 2], ['L4', 3], ['L5', 4], ['L6', 5]].forEach(([n, g]) => { const ys = []; for (let i = 0; i < N; i++) if (C.G[i] === g) ys.push(C.pos[3 * i + 1]); ys.sort((a, b) => a - b); mk(n, '', toWorld(-(C.radius + 40), ys[ys.length >> 1], C.radius + 20)); });
  mk('white matter', 'dim', toWorld(-(C.radius + 40), -860, C.radius + 20));
  resize(); new ResizeObserver(resize).observe(box);
  paint(null); api.requestEdges(2); bindHover();
}
function buildSticks(m) {
  eSrc = m.src; eTgt = m.tgt; const E = eSrc.length, P = new Float32Array(6 * E);
  let wmax = 0; for (let e = 0; e < E; e++) wmax = Math.max(wmax, Math.abs(m.w[e]));
  eW = Float32Array.from(m.w, w => Math.sign(w) * Math.sqrt(Math.abs(w) / wmax));
  for (let e = 0; e < E; e++) { const a = eSrc[e], b = eTgt[e]; P.set([pos[3 * a], pos[3 * a + 1], pos[3 * a + 2], pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]], 6 * e); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  eCol = new THREE.BufferAttribute(new Float32Array(8 * E), 4); eCol.setUsage(THREE.DynamicDrawUsage); g.setAttribute('color', eCol);
  lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({transparent: true, depthWrite: false,
    vertexShader: 'attribute vec4 color; varying vec4 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec4 vC; void main(){ gl_FragColor = vC; }'}));
  lines.visible = showSticks; scene.add(lines);
  $('lobeCount').textContent = `${N.toLocaleString()} neurons · ${E.toLocaleString()} strongest of ${C.E.rec.toLocaleString()} recurrent synapses shown`;
  paint(api.act());
}
function paint(A) {
  const c = colAttr.array, s = sizeAttr.array;
  for (let i = 0; i < N; i++) {
    const a = A ? A[i] : 0, inh = C.G[i] >= 6, R0 = inh ? REST_I : REST_E, Ac = inh ? INH : EXC, h = inh ? 0 : a * a, k = 3 * i;
    act[i] = a;
    c[k] = R0.r + (Ac.r + (HOT.r - Ac.r) * h - R0.r) * a; c[k + 1] = R0.g + (Ac.g + (HOT.g - Ac.g) * h - R0.g) * a; c[k + 2] = R0.b + (Ac.b + (HOT.b - Ac.b) * h - R0.b) * a;
    s[i] = (inh ? 0.016 : 0.012) + 0.03 * a;
  }
  colAttr.needsUpdate = true; sizeAttr.needsUpdate = true;
  if (eCol) {
    const ec = eCol.array, E = eSrc.length;
    for (let e = 0; e < E; e++) {
      const m = act[eSrc[e]], q = m * m, col = eW[e] > 0 ? EXC : INH, k8 = 8 * e, al = 0.015 + 0.6 * q * Math.min(1, Math.abs(eW[e]) * 1.5);
      ec[k8] = col.r; ec[k8 + 1] = col.g; ec[k8 + 2] = col.b; ec[k8 + 3] = al; ec[k8 + 4] = col.r; ec[k8 + 5] = col.g; ec[k8 + 6] = col.b; ec[k8 + 7] = al * 0.3;
    }
    eCol.needsUpdate = true;
  }
}
function resize() {
  const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  points.material.uniforms.uScale.value = h * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * Math.PI / 360));
}
const tmp = new THREE.Vector3();
function placeLabels() {
  const w = box.clientWidth, h = box.clientHeight;
  for (const L of labels) { tmp.copy(L.p).project(camera); L.d.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px) translate(-50%,-50%)`; L.d.style.opacity = tmp.z < 1 ? 1 : 0; }
}
function bindHover() {
  const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.012; const ptr = new THREE.Vector2(); let pending = false, last = null;
  canvas.addEventListener('pointermove', e => {
    if (e.buttons) { tip.style.opacity = 0; return; } last = e; if (pending) return; pending = true;
    setTimeout(() => {
      pending = false; const r = canvas.getBoundingClientRect();
      ptr.set(((last.clientX - r.left) / r.width) * 2 - 1, -((last.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObject(points)[0]; if (!hit) { tip.style.opacity = 0; return; }
      const i = hit.index, a = act[i], pop = C.pops[C.cls[i]];
      tip.innerHTML = `<b>${pop}</b> · ${Info.groups[C.G[i]].name}<br>preferred orientation ${Math.round(C.pref[i])}° · receptive field at (${C.rx[i].toFixed(0)}°, ${C.ry[i].toFixed(0)}°)<br><span class="${a > 0.05 ? 'dep' : ''}">${a > 0.05 ? 'spiking' : 'quiet'}</span><br><span class="muted">${Math.round(-C.pos[3 * i + 1])} µm below the pia</span>`;
      tip.style.left = (last.clientX - r.left + 14) + 'px'; tip.style.top = (last.clientY - r.top + 10) + 'px'; tip.style.opacity = 1;
    }, 60);
  });
  canvas.addEventListener('pointerleave', () => tip.style.opacity = 0);
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; $('lobeSpin').classList.remove('on'); });
}
function frame() {
  if (!visible) { started = false; return; }
  requestAnimationFrame(frame);
  const now = performance.now(); if (now - lastDraw < 32) return; lastDraw = now;
  paint(api.act());
  controls.update(); renderer.render(scene, camera); placeLabels();
}
function start() { if (!api) return; if (!renderer) { layout(); build(); } if (!started) { started = true; requestAnimationFrame(frame); } }
function view34() { camera.position.set(4.0, 1.3, 4.4); controls.target.set(0, 0, 0); }
function stopSpin() { controls.autoRotate = false; $('lobeSpin').classList.remove('on'); }
window.addEventListener('mouseharp-edges', e => { if (renderer) buildSticks(e.detail); });
window.addEventListener('mouseharp-ready', () => { api = window.MouseHarp; if (visible) start(); });
if (window.MouseHarp) api = window.MouseHarp;
new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) start(); }, {rootMargin: '120px'}).observe(box);
$('lobeSpin').onclick = e => { controls.autoRotate = !controls.autoRotate; e.currentTarget.classList.toggle('on', controls.autoRotate); };
$('lobeSticks').onclick = e => { showSticks = !showSticks; if (lines) lines.visible = showSticks; e.currentTarget.classList.toggle('on', showSticks); };
$('lobeView').onclick = () => view34();
$('lobeSide').onclick = () => { camera.position.set(0.01, 0, 5.6); controls.target.set(0, 0, 0); stopSpin(); };
$('lobeTop').onclick = () => { camera.position.set(0.01, 4.6, 0.01); controls.target.set(0, 0, 0); stopSpin(); };
