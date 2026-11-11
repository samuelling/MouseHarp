// Stimuli on the model's 120 x 80 deg screen (1 px = 1 deg), contrast units: grey 0, black -1, white +1.
// Gratings use the V1 model's own convention (V1_GLIF_model stim_dataset): phi = pi (180 - theta) / 180,
// L = c sin(2 pi (cpd (x cos phi + y sin phi) + tf t) + pi), x right, y down.
const Stimuli = (() => {
  const W = 120, H = 80, img = new Float32Array(W * H);
  const cam = {video: null, canvas: null, ctx: null, ok: false};
  const paint = {pts: []}; let dots = null;
  function grating(theta, cpd, tf, c, t) {
    const ph = Math.PI * (180 - theta) / 180, cx = Math.cos(ph), sy = Math.sin(ph);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = c * Math.sin(2 * Math.PI * (cpd * (x * cx + y * sy) + tf * t) + Math.PI);
  }
  // p: {kind, contrast, ori, sf (cycles/deg), speed (Hz), size (deg)}; t: simulated seconds
  function render(p, t) {
    const c = p.contrast;
    switch (p.kind) {
      case 'grating': grating(p.ori, p.sf, p.speed, c, t); break;
      case 'rotate': grating((p.ori + 12 * t) % 360, p.sf, 2, c, t); break;   // turns 12 deg/s: one orientation string after another
      case 'bar': {
        const ph = Math.PI * (180 - p.ori) / 180, cx = Math.cos(ph), sy = Math.sin(ph), span = Math.hypot(W, H), half = Math.max(1, p.size / 2);
        const pos = -span / 2 + ((t * p.speed * 40) % span);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const u = (x - W / 2) * cx + (y - H / 2) * sy; img[y * W + x] = Math.abs(u - pos) < half ? c : 0; }
        break;
      }
      case 'flash': { const ph = (t * p.speed) % 1; img.fill(ph < 0.25 ? c : ph < 0.5 ? 0 : ph < 0.75 ? -c : 0); break; }
      case 'dots': {
        const n = Math.round(p.size * 8);
        if (!dots || dots.length !== n) dots = Array.from({length: n}, () => [Math.random() * W, Math.random() * H, Math.random() < 0.5 ? -1 : 1]);
        img.fill(0); const ph = Math.PI * (180 - p.ori) / 180, vx = Math.cos(ph) * p.speed * 20, vy = Math.sin(ph) * p.speed * 20;
        for (const [x0, y0, s] of dots) {
          const x = ((x0 + vx * t) % W + W) % W, y = ((y0 + vy * t) % H + H) % H;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { if (dx * dx + dy * dy > 5) continue; const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx >= 0 && yy >= 0 && xx < W && yy < H) img[yy * W + xx] = c * s; }
        }
        break;
      }
      case 'paint': {
        img.fill(0); paint.pts = paint.pts.filter(q => t - q.t < 1.5 && t >= q.t - 0.01);
        for (const q of paint.pts) { const a = Math.exp(-(t - q.t) * 2.5) * c * q.sign;
          for (let y = Math.max(0, q.y - 7 | 0); y < Math.min(H, q.y + 8); y++) for (let x = Math.max(0, q.x - 7 | 0); x < Math.min(W, q.x + 8); x++) {
            const d2 = (x - q.x) ** 2 + (y - q.y) ** 2, i = y * W + x; img[i] = Math.max(-1, Math.min(1, img[i] + a * Math.exp(-d2 / 10))); } }
        break;
      }
      case 'webcam': {
        if (!cam.ok) { img.fill(0); break; }
        cam.ctx.drawImage(cam.video, 0, 0, W, H);
        const px = cam.ctx.getImageData(0, 0, W, H).data; let mean = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + (W - 1 - x)) * 4; const v = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255; img[y * W + x] = v; mean += v; }
        mean /= W * H; let sd = 0; for (let i = 0; i < W * H; i++) sd += (img[i] - mean) ** 2; sd = Math.sqrt(sd / (W * H)) + 1e-3;
        const g = Math.min(6, 0.35 / sd) * c / 0.8;               // automatic exposure: comparable contrast to the gratings
        for (let i = 0; i < W * H; i++) img[i] = Math.max(-1, Math.min(1, (img[i] - mean) * g));
        break;
      }
    }
    return img;
  }
  async function startCamera() {
    if (cam.ok) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480, facingMode: 'user'}, audio: false});
      cam.video = document.createElement('video'); cam.video.srcObject = s; cam.video.muted = true; cam.video.playsInline = true; cam.video.setAttribute('playsinline', '');
      await cam.video.play(); cam.canvas = document.createElement('canvas'); cam.canvas.width = W; cam.canvas.height = H;
      cam.ctx = cam.canvas.getContext('2d', {willReadFrequently: true}); cam.ok = true; return true;
    } catch (e) { console.warn('camera unavailable', e); return false; }
  }
  function stroke(x, y, t, sign) { paint.pts.push({x, y, t, sign}); }
  return {W, H, img, render, startCamera, stroke, cam};
})();
