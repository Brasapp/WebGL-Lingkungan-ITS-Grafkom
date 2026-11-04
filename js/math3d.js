"use strict";
// =====================================================================
//  math3d.js — matematika 3D & pembuat geometri (tanpa library)
//    1. Matriks 4x4 & vektor 3D (column-major, sesuai WebGL)
//    2. Geometri mesh: kotak, silinder, bola, torus, prisma, bidang,
//       spandek bergelombang, pita jalan + unggah ke GPU (VBO)
// =====================================================================

// #####################################################################
//  BAGIAN: 1. MATRIKS & VEKTOR
// #####################################################################
// =====================================================================
//  Pustaka matriks 4x4 & vektor 3D kecil buatan sendiri.
//  Format COLUMN-MAJOR (sama dengan yang diharapkan WebGL):
//  elemen (baris r, kolom c) disimpan di indeks c*4 + r.
// =====================================================================

const M4 = {
  identity(out) {
    out = out || new Float32Array(16);
    out.fill(0); out[0] = out[5] = out[10] = out[15] = 1;
    return out;
  },

  // out = a * b  (titik ditransformasi oleh b dulu, lalu a)
  multiply(a, b, out) {
    out = out || new Float32Array(16);
    const r = (out === a || out === b) ? new Float32Array(16) : out;
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      r[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
      r[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
      r[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      r[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    if (r !== out) out.set(r);
    return out;
  },

  translation(x, y, z) {
    const m = M4.identity(); m[12] = x; m[13] = y; m[14] = z; return m;
  },
  scaling(x, y, z) {
    const m = M4.identity(); m[0] = x; m[5] = y; m[10] = z; return m;
  },
  rotationX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1, 0, 0, 0,  0, c, s, 0,  0, -s, c, 0,  0, 0, 0, 1]);
  },
  rotationY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0,  0, 1, 0, 0,  s, 0, c, 0,  0, 0, 0, 1]);
  },
  rotationZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, s, 0, 0,  -s, c, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);
  },

  // Proyeksi perspektif (fovy dalam radian)
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },

  // Proyeksi ortografis (dipakai kamera cahaya matahari untuk shadow map)
  ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l), 0, 0, 0,
      0, 2 / (t - b), 0, 0,
      0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
    ]);
  },

  // Matriks view: kamera di 'eye' melihat ke 'target'
  lookAt(eye, target, up) {
    const z = V3.normalize(V3.sub(eye, target));
    const x = V3.normalize(V3.cross(up, z));
    const y = V3.cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -V3.dot(x, eye), -V3.dot(y, eye), -V3.dot(z, eye), 1,
    ]);
  },

  inverse(a, out) {
    out = out || new Float32Array(16);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M4.identity(out);
    det = 1 / det;
    out[0]  = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1]  = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2]  = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3]  = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4]  = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5]  = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6]  = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7]  = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8]  = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9]  = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },

  transpose(a, out) {
    out = out || new Float32Array(16);
    const t = Float32Array.from(a);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = t[r * 4 + c];
    return out;
  },

  // Matriks normal = transpose(invers(model)) — agar normal tetap benar saat skala tidak seragam
  normalMatrix(model, out) {
    return M4.transpose(M4.inverse(model), out);
  },

  transformPoint(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  },
  transformDir(m, d) {
    return [
      m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
      m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
      m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
    ];
  },
};

// T * Ry * Rx * Rz — urutan transformasi standar untuk objek (posisi + rotasi)
function trs(tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0) {
  let m = M4.translation(tx, ty, tz);
  if (ry) m = M4.multiply(m, M4.rotationY(ry));
  if (rx) m = M4.multiply(m, M4.rotationX(rx));
  if (rz) m = M4.multiply(m, M4.rotationZ(rz));
  return m;
}
// Matriks bentuk: geser + rotasi + skala (hanya untuk mesh, tidak diwariskan ke anak)
function shapeM(sx, sy, sz, tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0) {
  return M4.multiply(trs(tx, ty, tz, rx, ry, rz), M4.scaling(sx, sy, sz));
}

const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

// Bilangan acak dengan seed (hasil selalu sama setiap halaman dibuka)
function makeRng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// #####################################################################
//  BAGIAN: 2. GEOMETRI MESH
// #####################################################################
// =====================================================================
//  Pembuat data mesh (posisi, normal, koordinat tekstur, indeks).
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

  // Prisma segitiga (pengisi pelana atap): alas di y=0 selebar z -0.5..0.5,
  // puncak di (y=1, z=0), memanjang sepanjang sumbu X (-0.5..0.5).
  prism() {
    const P = [], N = [], U = [], I = [];
    const quad = (a, b, c, d, n) => {
      const base = P.length / 3;
      for (const p of [a, b, c, d]) { P.push(...p); N.push(...n); }
      U.push(0, 0, 1, 0, 1, 1, 0, 1);
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const tri = (a, b, c, n) => {
      const base = P.length / 3;
      for (const p of [a, b, c]) { P.push(...p); N.push(...n); }
      U.push(0, 0, 1, 0, 0.5, 1);
      I.push(base, base + 1, base + 2);
    };
    const s = V3.normalize([0, 0.5, 1]);                       // normal sisi miring
    quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0], [0, s[1], s[2]]);
    quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0], [0, s[1], -s[2]]);
    quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, -1, 0]);
    tri([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0], [1, 0, 0]);
    tri([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], [-1, 0, 0]);
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

  // Pita jalan mengikuti lintasan (array titik [x,z]) di atas tanah.
  // tertutup = true -> ujung bertemu pangkal (loop); false -> jalan biasa dengan dua ujung.
  pathStrip(points, width, tile = 1, tertutup = true) {
    const P = [], N = [], U = [], I = [];
    let dist = 0;
    const n = points.length;
    const titik = (i) => tertutup ? points[(i + n) % n] : points[clamp(i, 0, n - 1)];
    const akhir = tertutup ? n : n - 1;
    for (let i = 0; i <= akhir; i++) {
      const p = titik(i), q = titik(i + 1), o = titik(i - 1);
      if (i > 0) dist += Math.hypot(p[0] - o[0], p[1] - o[1]);
      const t = V3.normalize([q[0] - o[0], 0, q[1] - o[1]]);
      const nx = -t[2] * width / 2, nz = t[0] * width / 2;
      P.push(p[0] + nx, 0, p[1] + nz, p[0] - nx, 0, p[1] - nz);
      N.push(0, 1, 0, 0, 1, 0);
      U.push(0, dist / tile, width / tile, dist / tile);
    }
    for (let i = 0; i < akhir; i++) {
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
