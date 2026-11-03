"use strict";
// =====================================================================
//  geometri.js — pembuat data mesh (posisi, normal, koordinat tekstur, indeks).
//  Semua bentuk dibuat dari nol (tanpa library 3D).
//  Ukuran dasar: kotak 1x1x1, silinder diameter 1 tinggi 1, bola diameter 1
//  -> ukuran sebenarnya diatur lewat matriks "shape" di scene graph.
// =====================================================================

const Geo = {
  // Kotak. Jika tu/tv > 0, UV dihitung per meter (tekstur berulang sesuai ukuran asli).
  box(w = 1, h = 1, d = 1, tu = 0, tv = 0) {
    const P = [], N = [], U = [], I = [];
    const faces = [
      // normal,      sumbu u,      sumbu v,     ukuran u, ukuran v, jarak dari pusat
      [[1, 0, 0],  [0, 0, -1], [0, 1, 0],  d, h, w / 2],
      [[-1, 0, 0], [0, 0, 1],  [0, 1, 0],  d, h, w / 2],
      [[0, 1, 0],  [1, 0, 0],  [0, 0, -1], w, d, h / 2],
      [[0, -1, 0], [1, 0, 0],  [0, 0, 1],  w, d, h / 2],
      [[0, 0, 1],  [1, 0, 0],  [0, 1, 0],  w, h, d / 2],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0],  w, h, d / 2],
    ];
    for (const [n, u, v, su, sv, off] of faces) {
      const base = P.length / 3;
      const ru = tu > 0 ? su / tu : 1, rv = tv > 0 ? sv / tv : 1;
      for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        for (let k = 0; k < 3; k++) P.push(n[k] * off + u[k] * s * su / 2 + v[k] * t * sv / 2);
        N.push(...n);
        U.push((s + 1) / 2 * ru, (t + 1) / 2 * rv);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { P, N, U, I };
  },

  // Silinder sumbu Y, diameter 1, tinggi 1 (y: -0.5..0.5). arc < 2π -> silinder sebagian.
  cylinder(seg = 16, arc = Math.PI * 2, caps = true) {
    const P = [], N = [], U = [], I = [];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * arc, c = Math.cos(a), s = Math.sin(a);
      P.push(c * 0.5, -0.5, s * 0.5, c * 0.5, 0.5, s * 0.5);
      N.push(c, 0, s, c, 0, s);
      U.push(i / seg, 0, i / seg, 1);
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);   // CCW dilihat dari luar
    }
    if (caps) {
      for (const y of [-0.5, 0.5]) {
        const center = P.length / 3;
        P.push(0, y, 0); N.push(0, Math.sign(y), 0); U.push(0.5, 0.5);
        for (let i = 0; i <= seg; i++) {
          const a = i / seg * arc, c = Math.cos(a), s = Math.sin(a);
          P.push(c * 0.5, y, s * 0.5); N.push(0, Math.sign(y), 0); U.push(0.5 + c * 0.5, 0.5 + s * 0.5);
        }
        for (let i = 0; i < seg; i++)
          if (y > 0) I.push(center, center + 2 + i, center + 1 + i);
          else I.push(center, center + 1 + i, center + 2 + i);
      }
    }
    return { P, N, U, I };
  },

  // Bola diameter 1
  sphere(lat = 12, lon = 18) {
    const P = [], N = [], U = [], I = [];
    for (let i = 0; i <= lat; i++) {
      const th = i / lat * Math.PI, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= lon; j++) {
        const ph = j / lon * Math.PI * 2;
        const x = Math.cos(ph) * st, y = ct, z = Math.sin(ph) * st;
        P.push(x * 0.5, y * 0.5, z * 0.5); N.push(x, y, z); U.push(j / lon * 2, i / lat);
      }
    }
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = i * (lon + 1) + j, b = a + lon + 1;
      I.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return { P, N, U, I };
  },

  // Torus dengan sumbu X (dipakai untuk ban motor). R = jari-jari besar, r = tebal.
  torus(R = 0.2, r = 0.06, seg = 20, side = 8) {
    const P = [], N = [], U = [], I = [];
    for (let i = 0; i <= seg; i++) {
      const u = i / seg * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= side; j++) {
        const v = j / side * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
        P.push(r * sv, (R + r * cv) * cu, (R + r * cv) * su);
        N.push(sv, cv * cu, cv * su);
        U.push(i / seg, j / side);
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < side; j++) {
      const a = i * (side + 1) + j, b = a + side + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return { P, N, U, I };
  },

  // Bidang datar XZ menghadap +Y
  plane(w, d, tu = 1, tv = 1) {
    const P = [-w / 2, 0, d / 2, w / 2, 0, d / 2, w / 2, 0, -d / 2, -w / 2, 0, -d / 2];
    const N = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    const U = [0, 0, w / tu, 0, w / tu, d / tv, 0, d / tv];
    return { P, N, U, I: [0, 1, 2, 0, 2, 3] };
  },

  // Lembaran atap bergelombang (spandek): gelombang sinus melintang (sumbu X),
  // rusuknya memanjang searah selasar (sumbu Z).
  corrugated(W, L, pitch = 0.2, amp = 0.018, tile = 1) {
    const P = [], N = [], U = [], I = [];
    const cols = Math.ceil(W / pitch) * 8;
    const k = Math.PI * 2 / pitch;
    for (let i = 0; i <= cols; i++) {
      const x = -W / 2 + W * i / cols;
      const y = amp * Math.sin(k * x);
      const n = V3.normalize([-amp * k * Math.cos(k * x), 1, 0]);
      for (const z of [-L / 2, L / 2]) {
        P.push(x, y, z); N.push(...n); U.push((z + L / 2) / tile, (x + W / 2) / tile);
      }
    }
    for (let i = 0; i < cols; i++) {
      const a = i * 2;
      I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    return { P, N, U, I };
  },

  // Pita jalan mengikuti lintasan tertutup (array titik [x,z]) di atas tanah
  pathStrip(points, width, tile = 1) {
    const P = [], N = [], U = [], I = [];
    let dist = 0;
    const n = points.length;
    for (let i = 0; i <= n; i++) {
      const p = points[i % n], q = points[(i + 1) % n], o = points[(i - 1 + n) % n];
      if (i > 0) dist += Math.hypot(p[0] - o[0], p[1] - o[1]);
      const t = V3.normalize([q[0] - o[0], 0, q[1] - o[1]]);
      const nx = -t[2] * width / 2, nz = t[0] * width / 2;
      P.push(p[0] + nx, 0, p[1] + nz, p[0] - nx, 0, p[1] - nz);
      N.push(0, 1, 0, 0, 1, 0);
      U.push(0, dist / tile, width / tile, dist / tile);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    return { P, N, U, I };
  },
};

// Unggah data mesh ke GPU (VBO). Data CPU tetap disimpan untuk penggabungan objek statis.
let meshCounter = 0;
function uploadMesh(gl, data) {
  const buf = (target, arr) => {
    const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b;
  };
  return {
    id: meshCounter++,
    data,
    pos: buf(gl.ARRAY_BUFFER, new Float32Array(data.P)),
    nor: buf(gl.ARRAY_BUFFER, new Float32Array(data.N)),
    uv:  buf(gl.ARRAY_BUFFER, new Float32Array(data.U)),
    idx: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.I)),
    count: data.I.length,
  };
}
