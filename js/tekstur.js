"use strict";
// =====================================================================
//  tekstur.js — semua tekstur dibuat secara prosedural memakai Canvas 2D,
//  lalu diunggah ke WebGL. Keuntungan: tidak perlu file gambar & tidak kena
//  masalah CORS saat halaman dibuka langsung dari file (file://).
//  Semua tekstur dibuat "tileable" (bisa diulang tanpa sambungan terlihat).
// =====================================================================

// Value noise yang bisa diulang (tileable). Hasil 0..1 per piksel.
function tileNoise(size, cells, rng) {
  const lat = new Float32Array(cells * cells).map(() => rng());
  const out = new Float32Array(size * size);
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = y / size * cells, iy = Math.floor(fy), ty = sm(fy - iy);
    const y0 = (iy % cells) * cells, y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x / size * cells, ix = Math.floor(fx), tx = sm(fx - ix);
      const x0 = ix % cells, x1 = (ix + 1) % cells;
      const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * tx;
      const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}
// Fractal noise (gabungan beberapa oktaf)
function fbm(size, cells, oct, rng) {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = tileNoise(size, cells << o, rng);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// Isi canvas per piksel: fn(x, y, i) -> [r,g,b]
function paintPixels(ctx, size, fn) {
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, c = fn(x, y, i);
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function createTextures(gl) {
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic") ||
                gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  const maxAniso = aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0;

  function upload(canvas) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
    // warna rata-rata, dipakai saat tekstur dimatikan
    const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const avg = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { avg[0] += d[i]; avg[1] += d[i + 1]; avg[2] += d[i + 2]; }
    t.avg = avg.map((v) => v / (d.length / 4) / 255);
    return t;
  }
  function make(size, painter) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    painter(cv.getContext("2d"), size);
    return upload(cv);
  }

  const T = {};

  // ---- Lantai keramik abu gelap, dipasang diagonal (pola belah ketupat) ----
  T.lantai = make(512, (ctx, S) => {
    const rng = makeRng(11), n = fbm(S, 8, 4, rng), sp = tileNoise(S, 128, rng);
    const tint = [[62, 63, 67], [59, 60, 64], [64, 65, 69], [61, 62, 66]];
    paintPixels(ctx, S, (x, y, i) => {
      const a = (x + y) / 256, b = (x - y + 512) / 256;
      const da = Math.abs(a - Math.round(a)) * 181, db = Math.abs(b - Math.round(b)) * 181;
      const id = ((Math.floor(a) & 1) << 1) | (Math.floor(b) & 1);
      let c = tint[id].map((v) => v + (n[i] - 0.5) * 10 + (sp[i] - 0.5) * 8);
      if (Math.min(da, db) < 1.4) c = [84, 85, 88];
      return c;
    });
  });

  // ---- Sisi bawah atap spandek (abu terang dengan noda tipis) ----
  T.atap = make(256, (ctx, S) => {
    const rng = makeRng(21), n = fbm(S, 4, 4, rng), st = tileNoise(S, 64, rng);
    paintPixels(ctx, S, (x, y, i) => {
      const v = 212 + (n[i] - 0.5) * 22 + (st[(y % 8) * S + x] - 0.5) * 6;
      return [v, v, v - 4];
    });
  });

  // ---- Rumput: campuran hijau & bagian kering kecoklatan ----
  T.rumput = make(512, (ctx, S) => {
    const rng = makeRng(31), m = fbm(S, 8, 5, rng), d = tileNoise(S, 256, rng), d2 = tileNoise(S, 96, rng);
    const hijau = [74, 112, 34], hijauTua = [50, 84, 26], kering = [138, 122, 80];
    paintPixels(ctx, S, (x, y, i) => {
      const dry = smoothstep(0.52, 0.72, m[i]) * 0.85;
      let c = mixc(mixc(hijau, hijauTua, d2[i]), kering, dry);
      const k = 0.78 + d[i] * 0.42;
      return c.map((v) => v * k);
    });
  });

  // ---- Tanah / kerikil area parkir ----
  T.tanah = make(256, (ctx, S) => {
    const rng = makeRng(41), n = fbm(S, 4, 4, rng), g = tileNoise(S, 128, rng);
    paintPixels(ctx, S, (x, y, i) => {
      const k = 0.85 + n[i] * 0.25 + (g[i] > 0.72 ? 0.12 : 0) - (g[i] < 0.25 ? 0.08 : 0);
      return [172 * k, 156 * k, 128 * k];
    });
  });

  // ---- Paving block abu, pola susun bata ----
  T.paving = make(256, (ctx, S) => {
    const rng = makeRng(51), n = fbm(S, 8, 3, rng);
    const cols = 6, rows = 12, bw = S / cols, bh = S / rows;
    const shade = []; for (let k = 0; k < cols * rows * 2; k++) shade.push(0.86 + rng() * 0.2);
    paintPixels(ctx, S, (x, y, i) => {
      const r = Math.floor(y / bh), off = (r & 1) ? bw / 2 : 0;
      const xx = (x + off) % S, c = Math.floor(xx / bw);
      const jx = Math.min(xx % bw, bw - xx % bw), jy = Math.min(y % bh, bh - y % bh);
      if (jx < 1.3 || jy < 1.3) return [88, 88, 86];
      const k = shade[r * cols + c] * (0.92 + n[i] * 0.16);
      return [150 * k, 150 * k, 146 * k];
    });
  });

  // ---- Beton ----
  T.beton = make(256, (ctx, S) => {
    const rng = makeRng(61), n = fbm(S, 4, 5, rng);
    paintPixels(ctx, S, (x, y, i) => { const v = 175 + (n[i] - 0.5) * 40; return [v, v, v - 3]; });
  });

  // ---- Fasad gedung: 1 petak = lebar 4 m x tinggi 1 lantai (3,6 m) ----
  T.fasad = make(512, (ctx, S) => {
    const rng = makeRng(71), n = fbm(S, 4, 4, rng);
    paintPixels(ctx, S, (x, y, i) => {
      const v = 172 + (n[i] - 0.5) * 24; return [v, v + 2, v + 4];
    });
    // pelat lantai / balok (pita putih di bawah)
    ctx.fillStyle = "#e4e4e0"; ctx.fillRect(0, S * 0.84, S, S * 0.16);
    // jendela kaca gelap
    const wx = S * 0.08, wy = S * 0.2, ww = S * 0.84, wh = S * 0.56;
    const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
    g.addColorStop(0, "#5f7486"); g.addColorStop(0.55, "#33414f"); g.addColorStop(1, "#28323c");
    ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
    // pantulan langit diagonal
    ctx.fillStyle = "rgba(200,220,235,0.18)";
    ctx.beginPath(); ctx.moveTo(wx + ww * 0.15, wy); ctx.lineTo(wx + ww * 0.4, wy);
    ctx.lineTo(wx + ww * 0.15, wy + wh); ctx.lineTo(wx - ww * 0.1, wy + wh); ctx.fill();
    // kusen putih
    ctx.strokeStyle = "#ececea"; ctx.lineWidth = 7; ctx.strokeRect(wx, wy, ww, wh);
    ctx.lineWidth = 5;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(wx + ww * k / 4, wy); ctx.lineTo(wx + ww * k / 4, wy + wh); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(wx, wy + wh * 0.32); ctx.lineTo(wx + ww, wy + wh * 0.32); ctx.stroke();
    // unit AC kecil
    ctx.fillStyle = "#dcdcd8"; ctx.fillRect(S * 0.7, S * 0.06, S * 0.16, S * 0.1);
  });

  // ---- Daun pohon ----
  T.daun = make(256, (ctx, S) => {
    const rng = makeRng(81), n = fbm(S, 8, 4, rng), d = tileNoise(S, 64, rng);
    paintPixels(ctx, S, (x, y, i) => {
      const k = 0.55 + n[i] * 0.6 + (d[i] > 0.7 ? 0.25 : 0);
      return [58 * k, 98 * k, 40 * k];
    });
  });

  // ---- Kulit batang pohon ----
  T.kulit = make(128, (ctx, S) => {
    const rng = makeRng(91), n = tileNoise(S, 16, rng), s = fbm(S, 4, 3, rng);
    paintPixels(ctx, S, (x, y, i) => {
      const k = 0.6 + n[(y >> 3) * S + x] * 0.3 + s[i] * 0.3;
      return [96 * k, 78 * k, 60 * k];
    });
  });

  // ---- Atap logam gedung (garis-garis) ----
  T.logam = make(128, (ctx, S) => {
    const rng = makeRng(101), n = fbm(S, 4, 3, rng);
    paintPixels(ctx, S, (x, y, i) => {
      const rib = (x % 16) < 3 ? 22 : 0;
      const v = 150 + rib + (n[i] - 0.5) * 20; return [v, v + 3, v + 8];
    });
  });

  return T;
}
