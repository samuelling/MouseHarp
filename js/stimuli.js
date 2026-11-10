// Visual stimuli as images (luminance 0..1, grey 0.5) on a 128 x 72 screen; the cortex reads a 4x4-pooled 32 x 18 copy.
// Orientation convention follows the MICrONS digital twin: 0° = vertical bar, angles increase counter-clockwise.
const Stimuli = (() => {
  const W = 128, H = 72, PW = 32, PH = 18;
  const img = new Float32Array(W * H), pooled = new Float32Array(PW * PH);
  const cam = {video: null, canvas: null, ctx: null, ok: false};
  const paint = {pts: []};
  const deg = Math.PI / 180;
  let dots = null;

  // p: {kind, contrast, ori, sf (cycles per screen width), speed (cycles/s or deg/s), size}
  function render(p, t) {
    const c = p.contrast;
    switch (p.kind) {
      case 'grating': case 'rotate': {
        const th = (p.kind === 'rotate' ? p.ori + t * p.speed * 15 : p.ori) * deg, ct = Math.cos(th), st = Math.sin(th), k = 2 * Math.PI * p.sf / W;
        const drift = p.kind === 'rotate' ? 2 * Math.PI * 1.5 * t : 2 * Math.PI * p.speed * t;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = 0.5 * (1 + c * Math.cos(k * (x * ct - y * st) - drift));
        break;
      }
      case 'bar': {
        const th = p.ori * deg, ct = Math.cos(th), st = Math.sin(th), span = Math.hypot(W, H), half = Math.max(1.5, p.size / 2);
        const pos = -span / 2 + ((t * p.speed * 40) % span);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const u = (x - W / 2) * ct - (y - H / 2) * st;
          img[y * W + x] = 0.5 * (1 + (Math.abs(u - pos) < half ? c : 0));
        }
        break;
      }
      case 'flash': {
        const ph = (t * p.speed) % 1, v = ph < 0.25 ? c : ph < 0.5 ? 0 : ph < 0.75 ? -c : 0;
        img.fill(0.5 * (1 + v)); break;
      }
      case 'dots': {
        const n = Math.round(p.size * 12);
        if (!dots || dots.length !== n) dots = Array.from({length: n}, () => [Math.random() * W, Math.random() * H, Math.random() < 0.5 ? -1 : 1]);
        img.fill(0.5);
        const th = p.ori * deg, vx = Math.cos(th) * p.speed * 25, vy = -Math.sin(th) * p.speed * 25;
        for (const [x0, y0, s] of dots) {
          const x = ((x0 + vx * t) % W + W) % W, y = ((y0 + vy * t) % H + H) % H;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            if (dx * dx + dy * dy > 5) continue;
            const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            img[yy * W + xx] = 0.5 * (1 + c * s);
          }
        }
        break;
      }
      case 'paint': {
        img.fill(0.5);
        paint.pts = paint.pts.filter(q => t - q.t < 1.2 && t >= q.t - 0.01);
        for (const q of paint.pts) {
          const a = Math.exp(-(t - q.t) * 3) * c * q.sign;
          for (let y = Math.max(0, q.y - 6 | 0); y < Math.min(H, q.y + 7); y++) for (let x = Math.max(0, q.x - 6 | 0); x < Math.min(W, q.x + 7); x++) {
            const d2 = (x - q.x) ** 2 + (y - q.y) ** 2; const i = y * W + x; img[i] = Math.max(0, Math.min(1, img[i] + 0.5 * a * Math.exp(-d2 / 8)));
          }
        }
        break;
      }
      case 'webcam': {
        if (!cam.ok) { img.fill(0.5); break; }
        cam.ctx.drawImage(cam.video, 0, 0, W, H);
        const px = cam.ctx.getImageData(0, 0, W, H).data;
        let mean = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + (W - 1 - x)) * 4;     // mirrored like a selfie
          const v = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255; img[y * W + x] = v; mean += v;
        }
        // automatic exposure: re-centre on grey and stretch so contrast is comparable to the synthetic stimuli
        mean /= W * H; let sd = 0; for (let i = 0; i < W * H; i++) sd += (img[i] - mean) ** 2; sd = Math.sqrt(sd / (W * H)) + 1e-3;
        const g = Math.min(4, 0.22 / sd) * c / 0.8;
        for (let i = 0; i < W * H; i++) img[i] = Math.max(0, Math.min(1, 0.5 + (img[i] - mean) * g));
        break;
      }
    }
    return img;
  }
  function pool() {
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      let a = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) a += img[(4 * y + dy) * W + 4 * x + dx];
      pooled[y * PW + x] = a / 16;
    }
    return pooled;
  }
  async function startCamera() {
    if (cam.ok) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 360, facingMode: 'user'}, audio: false});
      cam.video = document.createElement('video'); cam.video.srcObject = s; cam.video.muted = true; cam.video.playsInline = true;
      cam.video.setAttribute('playsinline', ''); await cam.video.play();
      cam.canvas = document.createElement('canvas'); cam.canvas.width = W; cam.canvas.height = H;
      cam.ctx = cam.canvas.getContext('2d', {willReadFrequently: true}); cam.ok = true; return true;
    } catch (e) { console.warn('camera unavailable', e); return false; }
  }
  function stroke(x, y, t, sign) { paint.pts.push({x, y, t, sign}); }
  return {W, H, PW, PH, render, pool, startCamera, stroke, cam, img};
})();
