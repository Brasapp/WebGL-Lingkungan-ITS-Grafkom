"use strict";
// =====================================================================
//  main.js — seluruh program WebGL (memakai math3d.js)
//    1. Tekstur prosedural (Canvas 2D)
//    2. Shader GLSL
//    3. Scene graph / hierarchical modelling (objek & animasi)
//    4. Render loop, bayangan, siklus siang-malam, kamera, UI
//    5. Halaman: tombol layar penuh / perkecil
// =====================================================================

// #####################################################################
//  BAGIAN: 1. TEKSTUR PROSEDURAL
// #####################################################################
// =====================================================================
//  Semua tekstur dibuat secara prosedural memakai Canvas 2D,
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

// #####################################################################
//  BAGIAN: 2. SHADER
// #####################################################################
// =====================================================================
//  Kode GLSL (WebGL 1 / GLSL ES 1.00)
// =====================================================================
const MAX_LAMPU = 20; // jumlah maksimum point light

const SHADER = {};

// -------- Shader utama: pencahayaan Blinn-Phong + tekstur + bayangan --------
SHADER.mainVS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uModel, uView, uProj, uNormalMat, uLightVP;
uniform vec2 uUVScale;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec4 vLightPos;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize((uNormalMat * vec4(aNormal, 0.0)).xyz);
  vUV = aUV * uUVScale;
  // "normal offset": geser sedikit searah normal agar tidak muncul shadow acne
  vLightPos = uLightVP * (wp + vec4(vNormal * 0.04, 0.0));
  gl_Position = uProj * uView * wp;
}`;

SHADER.mainFS = `
precision highp float;
#define MAX_PL ${MAX_LAMPU}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec4 vLightPos;

// material
uniform vec3 uColor;
uniform sampler2D uTex;
uniform bool uUseTex;
uniform float uDetail;                    // tekstur detail (diulang lebih rapat) agar tidak buram dari dekat
uniform vec3 uTexAvg;
uniform float uShininess, uSpecular;
uniform vec3 uEmissive;
uniform float uReflect;                   // pantulan langit (lantai keramik mengkilap)
uniform vec3 uEnvTop, uEnvBottom;

// cahaya utama (matahari / bulan) + ambient hemisfer (langit & tanah)
uniform vec3 uKeyDir, uKeyColor;
uniform vec3 uSkyAmb, uGroundAmb;
uniform vec3 uCamPos;

// point light (lampu selasar & lampu taman)
uniform int uPLCount;
uniform vec3 uPLPos[MAX_PL];
uniform vec3 uPLColor[MAX_PL];

// spotlight (lampu depan motor)
uniform vec3 uSpotPos, uSpotDir, uSpotColor;
uniform float uSpotCos;

// bayangan
uniform sampler2D uShadowMap;
uniform bool uShadowOn;
uniform float uShadowTexel, uShadowBias;

uniform vec3 uFogColor;
uniform float uFogDensity;

float unpackDepth(vec4 c) {
  return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

// PCF 3x3: rata-rata 9 sampel agar tepi bayangan halus
float shadowFactor() {
  if (!uShadowOn) return 1.0;
  vec3 p = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float lit = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++) {
      float d = unpackDepth(texture2D(uShadowMap, p.xy + vec2(x, y) * uShadowTexel));
      lit += (p.z - uShadowBias > d) ? 0.0 : 1.0;
    }
  return lit / 9.0;
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;              // pencahayaan dua sisi
  vec3 base = uColor;
  if (uUseTex) {
    base *= texture2D(uTex, vUV).rgb;
    if (uDetail > 0.0) base *= mix(vec3(1.0), texture2D(uTex, vUV * 7.3).rgb / uTexAvg, uDetail);
  }
  vec3 V = normalize(uCamPos - vWorldPos);

  // 1) Ambient hemisfer: dari atas warna langit, dari bawah pantulan tanah
  vec3 col = base * mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);

  // 2) Cahaya utama berarah (diffuse Lambert + specular Blinn-Phong) dengan bayangan
  float ndl = max(dot(N, uKeyDir), 0.0);
  if (ndl > 0.0) {
    vec3 H = normalize(uKeyDir + V);
    float spec = pow(max(dot(N, H), 0.0), uShininess) * uSpecular;
    col += (base * ndl + spec) * uKeyColor * shadowFactor();
  }

  // 3) Point light dengan atenuasi jarak
  for (int i = 0; i < MAX_PL; i++) {
    if (i >= uPLCount) break;
    vec3 L = uPLPos[i] - vWorldPos;
    float d = length(L); L /= d;
    float att = 1.0 / (1.0 + 0.2 * d + 0.12 * d * d);
    float nl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), uShininess) * uSpecular;
    col += (base * nl + spec) * uPLColor[i] * att;
  }

  // 4) Spotlight lampu motor (kerucut cahaya dengan tepi halus)
  vec3 Ls = uSpotPos - vWorldPos;
  float ds = length(Ls); Ls /= ds;
  float cone = smoothstep(uSpotCos, uSpotCos + 0.05, dot(-Ls, uSpotDir));
  col += base * max(dot(N, Ls), 0.0) * uSpotColor * cone / (1.0 + 0.04 * ds * ds);

  // 5) Pantulan langit dengan efek Fresnel (makin miring sudut pandang, makin memantul)
  if (uReflect > 0.0) {
    vec3 R = reflect(-V, N);
    vec3 env = mix(mix(uEnvBottom, uEnvTop, clamp(R.y * 0.4, 0.0, 1.0)), vec3(0.8), 0.45);
    float fr = uReflect * (0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0));
    col = mix(col, env, fr);
  }

  col = col * 1.1 + uEmissive;
  // tone mapping filmic (ACES) — highlight tidak "pecah", bayangan tetap terbaca
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);

  // kabut atmosfer (jarak jauh memudar ke warna horizon)
  float dist = length(uCamPos - vWorldPos);
  float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, 1.0);
}`;

// -------- Shader shadow map: simpan kedalaman (dikemas ke RGBA) --------
SHADER.depthVS = `
attribute vec3 aPos;
uniform mat4 uModel, uLightVP;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;

SHADER.depthFS = `
precision highp float;
vec4 packDepth(float d) {
  vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * d);
  return e - e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
}
void main() { gl_FragColor = packDepth(gl_FragCoord.z); }`;

// -------- Shader langit: gradien + matahari + bintang --------
SHADER.skyVS = `
attribute vec3 aPos;
uniform mat4 uViewRot, uProj;
varying vec3 vDir;
void main() {
  vDir = aPos;
  gl_Position = uProj * uViewRot * vec4(aPos * 500.0, 1.0);
}`;

SHADER.skyFS = `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoonDir;
uniform float uNight;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
  if (d.y < 0.0) c = uHorizon * 0.85;
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
  float m = max(dot(d, uMoonDir), 0.0);
  c += vec3(0.85, 0.88, 1.0) * smoothstep(0.9993, 0.9996, m) * uNight;
  if (d.y > 0.0) {
    float st = hash(floor(d * 260.0));
    c += vec3(step(0.9965, st) * uNight * (0.5 + 0.5 * h));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// -------- Kompilasi & link program shader --------
function compileProgram(gl, vsSrc, fsSrc) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  // simpan lokasi attribute & uniform supaya tidak dicari ulang setiap frame
  p.a = {}; p.u = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const n = gl.getActiveAttrib(p, i).name; p.a[n] = gl.getAttribLocation(p, n); }
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const n = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, "");
    p.u[n] = gl.getUniformLocation(p, n);
  }
  return p;
}

// #####################################################################
//  BAGIAN: 3. SCENE GRAPH
// #####################################################################
// =====================================================================
//  HIERARCHICAL MODELLING (scene graph)
//
//  Setiap objek adalah Node. Node punya:
//    local : transformasi relatif terhadap induknya (DIWARISKAN ke anak)
//    shape : transformasi khusus bentuk/mesh (skala dll, TIDAK diwariskan)
//    world : induk.world * local  -> dihitung tiap frame
//  Jadi kalau "Rangka" motor dimiringkan, semua anaknya (roda, setang,
//  pengendara, ...) ikut miring; kalau "Kemudi" diputar, hanya roda depan
//  & setang yang ikut berputar.
// =====================================================================

class Node {
  constructor(name, o = {}) {
    this.name = name;
    this.local = o.local || M4.identity();
    this.shape = o.shape || null;
    this.mesh = o.mesh || null;
    this.mat = o.mat || null;
    this.group = o.group || null;       // label kelompok untuk objek berulang (mis. "Segmen")
    this.castShadow = o.castShadow !== false;
    this.light = o.light || null;       // {color, power, offset} -> point light
    this.info = o.info || null;         // keterangan singkat objek
    this.update = null;                 // fungsi animasi: (waktu, dt) => {...}
    this.children = [];
    this.parent = null;
    this.world = M4.identity();
    this.model = M4.identity();
  }
  add(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } return nodes[0]; }
  // telusuri semua node dalam subtree
  walk(fn) { fn(this); for (const c of this.children) c.walk(fn); }
}

function buildScene(gl, T) {
  // ------------------------------------------------------------------
  //  Mesh (dibuat sekali, dipakai ulang oleh banyak node)
  // ------------------------------------------------------------------
  const cache = new Map();
  const mesh = (key, fn) => { if (!cache.has(key)) cache.set(key, uploadMesh(gl, fn())); return cache.get(key); };
  const MS = {
    box: mesh("box", () => Geo.box()),
    cyl: mesh("cyl", () => Geo.cylinder(16)),
    cyl8: mesh("cyl8", () => Geo.cylinder(8)),
    sph: mesh("sph", () => Geo.sphere(14, 20)),
    sphLo: mesh("sphLo", () => Geo.sphere(8, 12)),
    prisma: mesh("prisma", () => Geo.prism()),
    ban: mesh("ban", () => Geo.torus(0.19, 0.065, 18, 8)),
  };

  // ------------------------------------------------------------------
  //  Material: warna dasar, tekstur, specular. 'glow' = warna pijar saat malam.
  // ------------------------------------------------------------------
  let matId = 0;
  const mat = (name, color, o = {}) => ({
    id: matId++, name, color, tex: o.tex || null, uv: o.uv || [1, 1],
    shin: o.shin || 24, spec: o.spec !== undefined ? o.spec : 0.15,
    glow: o.glow || null, emissive: [0, 0, 0], refl: o.refl || 0, detail: o.detail || 0,
  });
  const MT = {
    kuning:    mat("Baja cat kuning", [0.76, 0.55, 0.08], { spec: 0.35, shin: 40 }),
    atapBawah: mat("Spandek (bawah)", [1, 1, 1], { tex: T.atap, spec: 0.12 }),
    atapAtas:  mat("Spandek (atas)", [0.5, 0.47, 0.44], { tex: T.atap, spec: 0.35, shin: 30 }),
    atapCoklat: mat("Atap cokelat", [0.56, 0.43, 0.3], { tex: T.atap, spec: 0.2 }),
    lantai:    mat("Keramik lantai", [0.82, 0.8, 0.78], { tex: T.lantai, spec: 0.6, shin: 80, refl: 0.6 }),
    tepi:      mat("List tepi putih", [1.02, 1.02, 1.0], { tex: T.beton, spec: 0.12 }),
    beton:     mat("Beton", [0.86, 0.86, 0.84], { tex: T.beton, spec: 0.05 }),
    rumput:    mat("Rumput", [1, 1, 1], { tex: T.rumput, spec: 0.02, detail: 0.6 }),
    tanah:     mat("Tanah parkir", [0.66, 0.63, 0.58], { tex: T.tanah, spec: 0.02, detail: 0.5 }),
    paving:    mat("Paving", [0.64, 0.64, 0.62], { tex: T.paving, spec: 0.06 }),
    fasad:     mat("Fasad gedung", [1, 1, 1], { tex: T.fasad, spec: 0.25, shin: 50 }),
    fasad2:    mat("Fasad gedung 2", [0.92, 0.95, 1.0], { tex: T.fasad, spec: 0.25, shin: 50 }),
    atapGedung: mat("Atap gedung (spandek)", [0.86, 0.87, 0.88], { tex: T.atap, spec: 0.4, shin: 40 }),
    pagarBalkon: mat("Pagar balkon", [0.88, 0.89, 0.9], { spec: 0.5, shin: 50 }),
    dindingAtas: mat("Dinding pelana", [0.8, 0.81, 0.82], { spec: 0.05 }),
    pelat:     mat("Pelat lantai gedung", [1.0, 1.0, 0.98], { tex: T.beton, spec: 0.05 }),
    logam:     mat("Atap logam", [1, 1, 1], { tex: T.logam, spec: 0.5, shin: 40 }),
    pintu:     mat("Pintu gelap", [0.16, 0.17, 0.19], { spec: 0.3 }),
    daun:      mat("Daun", [1, 1, 1], { tex: T.daun, spec: 0.04 }),
    kulit:     mat("Kulit kayu", [1, 1, 1], { tex: T.kulit, spec: 0.02 }),
    tiang:     mat("Tiang lampu", [0.78, 0.79, 0.8], { spec: 0.7, shin: 60 }),
    bolaLampu: mat("Bola lampu taman", [0.95, 0.95, 0.93], { spec: 0.6, shin: 60, glow: [1.0, 0.9, 0.7] }),
    neon:      mat("Lampu neon", [0.95, 0.96, 0.98], { spec: 0.3, glow: [0.9, 0.96, 1.0] }),
    hitam:     mat("Plastik hitam", [0.07, 0.07, 0.08], { spec: 0.35, shin: 40 }),
    ban:       mat("Karet ban", [0.04, 0.04, 0.04], { spec: 0.08 }),
    krom:      mat("Krom", [0.72, 0.72, 0.74], { spec: 0.9, shin: 90, refl: 0.3 }),
    lampuRem:  mat("Lampu rem", [0.7, 0.05, 0.05], { spec: 0.5, glow: [0.6, 0.02, 0.02] }),
    lampuMotor: mat("Lampu motor", [1.0, 1.0, 0.92], { spec: 0.6 }),
    kulitOrang: mat("Kulit", [0.76, 0.56, 0.43], { spec: 0.1 }),
    rambut:    mat("Rambut", [0.07, 0.05, 0.04], { spec: 0.1 }),
    bajuBiru:  mat("Baju biru", [0.1, 0.2, 0.48], { spec: 0.05 }),
    bajuPutih: mat("Baju putih", [0.88, 0.88, 0.86], { spec: 0.05 }),
    celana:    mat("Celana", [0.13, 0.13, 0.17], { spec: 0.05 }),
    helm:      mat("Helm", [0.82, 0.12, 0.1], { spec: 0.8, shin: 80 }),
  };
  const warnaMotor = [
    mat("Bodi hitam", [0.08, 0.08, 0.09], { spec: 0.7, shin: 70 }),
    mat("Bodi merah", [0.62, 0.06, 0.06], { spec: 0.7, shin: 70 }),
    mat("Bodi putih", [0.88, 0.88, 0.88], { spec: 0.7, shin: 70 }),
    mat("Bodi biru", [0.08, 0.2, 0.55], { spec: 0.7, shin: 70 }),
    mat("Bodi abu", [0.45, 0.46, 0.48], { spec: 0.7, shin: 70 }),
  ];

  // Pembantu pembuat node
  const part = (name, m, material, local, shape, o = {}) =>
    new Node(name, { mesh: m, mat: material, local: local || M4.identity(), shape, ...o });
  const grp = (name, local, o = {}) => new Node(name, { local: local || M4.identity(), ...o });

  const root = grp("Dunia (Scene)", null, { info: "akar scene graph" });

  // ==================================================================
  //  0. PETA: tata letak diambil dari citra satelit
  //     (footage/Screenshot from 2026-11-05 03-17-41.png, 714 x 630 piksel).
  //  Sumbu dunia disejajarkan dengan selasar:
  //    -z = sepanjang selasar (dari gedung barat menuju Gedung ITS ROBOCON)
  //    +x = ke kanan saat berjalan (selatan pada peta), -x = utara (Gedung IRIS)
  //  Titik A = ujung barat selasar pada citra (z = +1, ujung lantai).
  // ==================================================================
  const PETA = { A: [45, 499], d: [0.97834, -0.20701], s: 0.1469 };   // s = meter per piksel
  const PETA_N = [-PETA.d[1], PETA.d[0]];                               // arah "kanan" selasar pada citra
  function peta(u, v) {                                                 // piksel -> [x, z] dunia
    const r = [u - PETA.A[0], v - PETA.A[1]];
    return [(r[0] * PETA_N[0] + r[1] * PETA_N[1]) * PETA.s, 1 - (r[0] * PETA.d[0] + r[1] * PETA.d[1]) * PETA.s];
  }
  function piksel(x, z) {                                               // kebalikan: [x, z] dunia -> piksel
    const sepanjang = (1 - z) / PETA.s, melintang = x / PETA.s;
    return [PETA.A[0] + sepanjang * PETA.d[0] + melintang * PETA_N[0], PETA.A[1] + sepanjang * PETA.d[1] + melintang * PETA_N[1]];
  }
  // Rangka gedung dari tiga sudut atap pada citra [kiri-atas, kanan-atas, kiri-bawah]:
  // pusat, lebar (sumbu x lokal), kedalaman (sumbu z lokal), dan sudut putar
  function rangkaPiksel([kiriAtas, kananAtas, kiriBawah]) {
    const a = peta(...kiriAtas), b = peta(...kananAtas), c = peta(...kiriBawah);
    return {
      cx: (b[0] + c[0]) / 2, cz: (b[1] + c[1]) / 2,
      w: Math.hypot(b[0] - a[0], b[1] - a[1]), d: Math.hypot(c[0] - a[0], c[1] - a[1]),
      yaw: Math.atan2(-(b[1] - a[1]), b[0] - a[0]),
    };
  }
  const PX_ROBOCON = [[404, 357], [554, 343], [443, 536]];          // gedung di depan (ujung timur selasar)

  // ==================================================================
  //  1. LINGKUNGAN: rumput, tanah kering, jalan setapak paving
  // ==================================================================
  const lingkungan = root.add(grp("Lingkungan"));
  lingkungan.add(part("Rumput", mesh("rumput", () => Geo.plane(700, 700, 13, 13)), MT.rumput, null, null,
    { castShadow: false, info: "tekstur rumput prosedural" }));
  // tanah kering di selatan selasar dan di timur gedung (cokelat pada citra)
  lingkungan.add(part("Tanah Selatan", mesh("tanahSelatan", () => Geo.plane(38, 56, 3, 3)), MT.tanah,
    trs(23, 0.008, -26), null, { castShadow: false }));
  lingkungan.add(part("Tanah Timur", mesh("tanahTimur", () => Geo.plane(32, 58, 3, 3)), MT.tanah,
    trs(30, 0.006, -84), null, { castShadow: false }));
  lingkungan.add(part("Jalur Paving", mesh("jalurPaving", () => Geo.plane(2.2, 32.5, 1.2, 1.2)), MT.paving,
    trs(4.6, 0.015, -16.25), null, { castShadow: false, info: "jalan setapak menyambung ke jalan parkir" }));

  // ==================================================================
  //  2. SELASAR (koridor beratap) — objek utama
  // ==================================================================
  const N_SEG = 18, S = 3.0, L = N_SEG * S;           // 18 bentang x 3 m = 54 m (lantai 56 m, sesuai citra)
  const LANTAI_Y = 0.41;                               // tinggi permukaan keramik
  const X_KOLOM = 1.775;                               // posisi kolom kiri/kanan
  const X_TRITIS = 2.15;                               // ujung atap (overstek)
  const MIRING = 10 * DEG, TAN = Math.tan(MIRING);     // kemiringan atap pelana
  const BALOK_Y = 3.02;                                // balok tepi di atas kolom
  const BUBUNGAN_Y = BALOK_Y + 0.13 + X_KOLOM * TAN;   // sumbu kasau di tengah (titik tertinggi)
  const PANJANG = L + 2;                               // lantai sedikit lebih panjang

  const selasar = root.add(grp("Selasar", null, { info: "koridor beratap penghubung gedung" }));

  // --- Lantai ---
  const lantai = selasar.add(grp("Lantai", trs(0, 0, -L / 2)));
  lantai.add(part("Pelat Beton", mesh("pelatSelasar", () => Geo.box(3.8, 0.4, PANJANG, 1.5, 1.5)), MT.beton,
    trs(0, 0.2, 0)));
  lantai.add(part("Keramik", mesh("keramik", () => Geo.box(3.3, 0.02, PANJANG, 1.7, 1.7)), MT.lantai,
    trs(0, 0.40, 0), null, { info: "tekstur keramik diagonal" }));
  for (const [nm, sx] of [["List Tepi Kiri", -1], ["List Tepi Kanan", 1]])
    lantai.add(part(nm, mesh("listTepi", () => Geo.box(0.25, 0.12, PANJANG, 1, 1)), MT.tepi,
      trs(sx * X_KOLOM, 0.46, 0)));

  // Kasau = batang melintang berbentuk pelana (dua sisi miring). Dipakai di setiap kolom
  // (kuda-kuda utama, lebih tebal) dan di antara kolom (kasau kecil, tiap 0,75 m).
  const panjangKasau = X_TRITIS / Math.cos(MIRING);
  function kasau(nama, tinggi, tebal, o = {}) {
    const k = grp(nama, o.local, { group: o.group });
    for (const [sisi, sx] of [["Kiri", -1], ["Kanan", 1]])
      k.add(part(`${nama} ${sisi}`, MS.box, MT.kuning,
        trs(sx * X_TRITIS / 2, BUBUNGAN_Y - X_TRITIS / 2 * TAN, 0, 0, 0, -sx * MIRING),
        M4.scaling(panjangKasau, tinggi, tebal), { group: "Batang Miring" }));
    return k;
  }

  // --- Segmen berulang: kolom + kuda-kuda + kasau (+ lampu) ---
  const tinggiKolom = BALOK_Y + 0.08 - 0.52;
  for (let i = 0; i <= N_SEG; i++) {
    const seg = selasar.add(grp(`Segmen ${i + 1}`, trs(0, 0, -i * S), { group: "Segmen" }));
    for (const [sisi, sx] of [["Kiri", -1], ["Kanan", 1]]) {
      const kolom = seg.add(part(`Kolom ${sisi}`, MS.box, MT.kuning,
        trs(sx * X_KOLOM, 0.52 + tinggiKolom / 2, 0), M4.scaling(0.14, tinggiKolom, 0.14)));
      kolom.add(part("Pelat Dasar", MS.box, MT.kuning, trs(0, -tinggiKolom / 2 + 0.015, 0),
        M4.scaling(0.26, 0.03, 0.26)));
    }
    seg.add(kasau("Kuda-kuda", 0.16, 0.09));
    seg.add(part("Balok Ikat", MS.box, MT.kuning, trs(0, BALOK_Y - 0.06, 0), M4.scaling(X_KOLOM * 2, 0.1, 0.07)));
    if (i < N_SEG) for (let k = 1; k <= 3; k++)
      seg.add(kasau("Kasau", 0.08, 0.05, { local: trs(0, 0, -k * S / 4), group: "Kasau" }));
    if (i % 2 === 0 && i < N_SEG) {
      seg.add(part("Lampu Neon", MS.box, MT.neon, trs(0, BUBUNGAN_Y - 0.33, -S / 2),
        M4.scaling(1.0, 0.06, 0.14), { light: { color: [0.85, 0.92, 1.0], power: 2.2, offset: [0, -0.12, 0] },
          info: "point light (malam)", castShadow: false }));
    }
  }

  // --- Rangka memanjang: balok tepi, bubungan, gording ---
  const rangka = selasar.add(grp("Rangka Memanjang", trs(0, 0, -L / 2)));
  const balokPanjang = M4.scaling(0.12, 0.16, L + 0.3);
  rangka.add(part("Balok Tepi Kiri", MS.box, MT.kuning, trs(-X_KOLOM, BALOK_Y, 0), balokPanjang));
  rangka.add(part("Balok Tepi Kanan", MS.box, MT.kuning, trs(X_KOLOM, BALOK_Y, 0), balokPanjang));
  rangka.add(part("Balok Bubungan", MS.box, MT.kuning, trs(0, BUBUNGAN_Y - 0.14, 0), balokPanjang));
  for (const sx of [-1, 1])
    rangka.add(part("Gording", MS.box, MT.kuning, trs(sx * 0.95, BUBUNGAN_Y - 0.95 * TAN - 0.1, 0, 0, 0, -sx * MIRING),
      M4.scaling(0.06, 0.1, L + 0.3), { group: "Gording" }));

  // --- Atap spandek bergelombang (dua lapis: sisi bawah terang, sisi atas gelap) ---
  const atap = selasar.add(grp("Atap", trs(0, 0, -L / 2)));
  const lebarAtap = (X_TRITIS + 0.1) / Math.cos(MIRING);
  const xAtap = (X_TRITIS + 0.1) / 2;
  const meshAtap = mesh("spandek", () => Geo.corrugated(lebarAtap, L + 0.8, 0.2, 0.018, 1.0));
  for (const [sisi, sx] of [["Kiri", -1], ["Kanan", 1]]) {
    const a = atap.add(grp(`Atap ${sisi}`, trs(sx * xAtap, BUBUNGAN_Y + 0.07 - xAtap * TAN, 0, 0, 0, -sx * MIRING)));
    a.add(part("Spandek Bawah", meshAtap, MT.atapBawah, null, null, { info: "geometri gelombang sinus" }));
    a.add(part("Spandek Atas", meshAtap, MT.atapAtas, trs(0, 0.012, 0)));
  }
  atap.add(part("Nok (tutup bubungan)", MS.box, MT.atapAtas, trs(0, BUBUNGAN_Y + 0.1, 0), M4.scaling(0.42, 0.04, L + 0.8)));

  // ==================================================================
  //  3. MOTOR (dipakai untuk motor parkir & motor yang melaju)
  // ==================================================================
  function buatMotor(nama, bodi, o = {}) {
    const motor = grp(nama, o.local, { group: o.group });
    const rangkaM = motor.add(grp("Rangka Motor"));
    const roda = (nm, z) => {
      const r = grp(nm, trs(0, 0.255, z));
      r.add(part("Ban", MS.ban, MT.ban));
      r.add(part("Velg", MS.cyl, MT.krom, null, shapeM(0.3, 0.09, 0.3, 0, 0, 0, 0, 0, 90 * DEG)));
      return r;
    };
    const rodaBelakang = rangkaM.add(roda("Roda Belakang", -0.62));
    rangkaM.add(part("Bodi Belakang", MS.box, bodi, trs(0, 0.58, -0.38), M4.scaling(0.34, 0.36, 0.78)));
    rangkaM.add(part("Jok", MS.box, MT.hitam, trs(0, 0.8, -0.32), M4.scaling(0.3, 0.1, 0.66)));
    rangkaM.add(part("Lampu Rem", MS.box, MT.lampuRem, trs(0, 0.68, -0.78), M4.scaling(0.2, 0.06, 0.04)));
    rangkaM.add(part("Dek Kaki", MS.box, MT.hitam, trs(0, 0.33, 0.08), M4.scaling(0.3, 0.08, 0.5)));
    rangkaM.add(part("Tameng Depan", MS.box, bodi, trs(0, 0.6, 0.4, -0.25), M4.scaling(0.36, 0.6, 0.1)));
    // Kemudi: titik putar setang. Semua anaknya ikut berbelok.
    const kemudi = rangkaM.add(grp("Kemudi", trs(0, 0, 0.5)));
    kemudi.add(part("Garpu Depan", MS.cyl8, MT.krom, null, shapeM(0.07, 0.718, 0.07, 0, 0.6025, 0.05, -0.2526)));
    kemudi.add(part("Batok Lampu", MS.box, bodi, trs(0, 0.98, -0.02), M4.scaling(0.3, 0.14, 0.16)));
    kemudi.add(part("Setang", MS.box, MT.hitam, trs(0, 1.02, -0.07), M4.scaling(0.66, 0.05, 0.05)));
    const lampu = kemudi.add(part("Lampu Depan", MS.box, MT.lampuMotor, trs(0, 0.97, 0.07), M4.scaling(0.16, 0.07, 0.03)));
    for (const sx of [-1, 1])
      kemudi.add(part("Spion", MS.cyl8, MT.krom, trs(sx * 0.2, 1.13, -0.08), M4.scaling(0.02, 0.2, 0.02), { group: "Spion" }));
    const rodaDepan = kemudi.add(roda("Roda Depan", 0.14));
    return { motor, rangkaM, kemudi, rodaDepan, rodaBelakang, lampu };
  }

  // ==================================================================
  //  4. AREA PARKIR: pagar pipa kuning + deretan motor
  // ==================================================================
  // Parkir mengisi SUDUT antara selasar dan Gedung ITS ROBOCON (gedung di depan / ujung selasar):
  //  - pagar utara menempel di sisi selatan selasar (sejajar selasar, x = X_SELASAR)
  //  - pagar timur menempel di tepi teras gedung (mengikuti fasad gedung yang sedikit miring)
  // Jalan berbentuk L (tidak melingkar) di sisi barat & selatan parkir: berawal dari selasar
  // (ujung jalan setapak paving) dan berakhir di depan gedung.
  const rb = rangkaPiksel(PX_ROBOCON);
  const fasad = [Math.sin(rb.yaw), Math.cos(rb.yaw)];                 // arah sepanjang fasad barat
  const keluar = [-Math.cos(rb.yaw), Math.sin(rb.yaw)];               // normal fasad barat (menjauhi gedung)
  const tengahFasad = [rb.cx + keluar[0] * rb.w / 2, rb.cz + keluar[1] * rb.w / 2];
  const JARAK_TERAS = 2.9;                                             // teras lantai 1 menjorok 2,6 m (+ kanopi)
  function zGedung(x) {                                                // z garis tepi teras pada posisi x
    const o = [tengahFasad[0] + keluar[0] * JARAK_TERAS, tengahFasad[1] + keluar[1] * JARAK_TERAS];
    return o[1] + (x - o[0]) / fasad[0] * fasad[1];
  }
  const X_SELASAR = 2.4, X_SELATAN = X_SELASAR + 13;                  // lebar parkir 13 m (tegak lurus selasar)
  const Z_BARAT = zGedung(X_SELASAR) + 18;                             // panjang parkir 18 m (searah selasar)
  const parkir = root.add(grp("Area Parkir", null, { info: "di sudut antara selasar & Gedung ITS ROBOCON" }));

  // Lahan parkir: segi empat dengan satu sisi miring (mengikuti fasad gedung)
  const sudutLahan = [[X_SELASAR, zGedung(X_SELASAR)], [X_SELATAN, zGedung(X_SELATAN)], [X_SELATAN, Z_BARAT], [X_SELASAR, Z_BARAT]];
  parkir.add(part("Lahan Parkir", mesh("lahanParkir", () => ({
    P: sudutLahan.flatMap(([x, z]) => [x, 0, z]), N: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    U: sudutLahan.flatMap(([x, z]) => [x / 3, z / 3]), I: [0, 2, 1, 0, 3, 2],   // urutan CCW dilihat dari atas
  })), MT.paving, trs(0, 0.012, 0), null, { castShadow: false }));

  // Jalan L: garis tengah 2 m di luar pagar barat, lalu belok (sudut dibulatkan) ke arah gedung
  const JALAN = { lebar: 3.0, rs: 3.0 };
  const zJalan = Z_BARAT + 2.0, xJalan = X_SELATAN + 2.0;
  const titikJalur = [];
  for (let x = X_SELASAR + 1.0; x < xJalan - JALAN.rs; x += 1.0) titikJalur.push([x, zJalan]);
  for (let k = 0; k <= 8; k++) {                                       // busur seperempat lingkaran
    const a = Math.PI / 2 - k / 8 * Math.PI / 2;
    titikJalur.push([xJalan - JALAN.rs + JALAN.rs * Math.cos(a), zJalan - JALAN.rs + JALAN.rs * Math.sin(a)]);
  }
  const zUjung = zGedung(xJalan + JALAN.lebar / 2) + 0.4;
  for (let z = zJalan - JALAN.rs - 1.0; z > zUjung; z -= 1.0) titikJalur.push([xJalan, z]);
  titikJalur.push([xJalan, zUjung]);
  const jarakKumulatif = [0];
  for (let i = 1; i < titikJalur.length; i++)
    jarakKumulatif.push(jarakKumulatif[i - 1] + Math.hypot(titikJalur[i][0] - titikJalur[i - 1][0], titikJalur[i][1] - titikJalur[i - 1][1]));
  const panjangJalur = jarakKumulatif[jarakKumulatif.length - 1];
  function posisiJalur(s) {                                            // posisi di jalan, s = 0..panjangJalur
    s = clamp(s, 0, panjangJalur);
    let i = 0;
    while (i < titikJalur.length - 2 && jarakKumulatif[i + 1] < s) i++;
    const a = titikJalur[i], b = titikJalur[i + 1];
    const f = (s - jarakKumulatif[i]) / (jarakKumulatif[i + 1] - jarakKumulatif[i]);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  parkir.add(part("Jalan Paving Motor", mesh("jalanMotor", () => Geo.pathStrip(titikJalur, JALAN.lebar, 1.2, false)),
    MT.paving, trs(0, 0.02, 0), null, { castShadow: false, info: "jalan berbentuk L, dari selasar ke gedung" }));

  function buatPagar(nama, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    const p = grp(nama, trs(x1, 0, z1, 0, Math.atan2(-dz, dx), 0), { group: "Pagar" });
    const n = Math.round(len / 2);
    for (let k = 0; k <= n; k++)
      p.add(part(`Tiang Pagar ${k + 1}`, MS.cyl8, MT.kuning, trs(len * k / n, 0.5, 0), M4.scaling(0.06, 1.0, 0.06), { group: "Tiang Pagar" }));
    for (const [nm, y] of [["Pipa Atas", 0.97], ["Pipa Tengah", 0.5]])
      p.add(part(nm, MS.cyl8, MT.kuning, trs(len / 2, y, 0, 0, 0, 90 * DEG), M4.scaling(0.05, len, 0.05)));
    return p;
  }
  // Pagar: sisi selasar, sisi gedung, sisi selatan, dan sisi barat.
  // Jalan masuk (celah pagar barat) mepet ke selasar, di sudut barat-laut — sesuai video 2.
  const MASUK = [X_SELASAR, X_SELASAR + 3.0];
  parkir.add(buatPagar("Pagar Selasar", X_SELASAR, zGedung(X_SELASAR), X_SELASAR, Z_BARAT));
  parkir.add(buatPagar("Pagar Gedung", X_SELASAR, zGedung(X_SELASAR), X_SELATAN, zGedung(X_SELATAN)));
  parkir.add(buatPagar("Pagar Selatan", X_SELATAN, zGedung(X_SELATAN), X_SELATAN, Z_BARAT));
  parkir.add(buatPagar("Pagar Barat", MASUK[1], Z_BARAT, X_SELATAN, Z_BARAT));

  // Motor diparkir dalam baris-baris sejajar fasad Gedung ITS ROBOCON / Barunastra (bukan menghadap selasar).
  // Susunan dari gedung ke arah pagar barat (→ = menghadap gedung, ← = membelakangi gedung):
  //     gedung | →  ‹lorong›  ← →  ‹lorong›  ← →  ‹lorong›  ←  | pagar barat
  // Dua baris di antara lorong saling berhadapan (moncong ketemu moncong), jadi bagian belakang setiap
  // motor menempel ke lorong: motor bisa mundur keluar ke lorong, lalu lewat lajur kosong (±2,5 m) di sisi
  // selasar menuju pintu masuk.
  const rng = makeRng(2026);
  const hadapGedung = Math.atan2(-keluar[0], -keluar[1]);            // yaw agar +z lokal motor menghadap fasad
  const DEPAN = 0.75, BELAKANG = 0.85;                               // ujung motor dari titik asal (buatMotor)
  const LORONG = 1.9, CELAH = 0.2;                                   // lebar lorong, jarak antar moncong
  const barisParkir = [];                                            // [jarak dari tepi teras, menghadap gedung?]
  let tepi = 0.3;                                                    // jarak bebas dari tepi teras
  for (let k = 0; k < 3; k++) {
    barisParkir.push([tepi + DEPAN, true]);                          // → menghadap gedung
    tepi += DEPAN + BELAKANG + LORONG;                               // belakangnya: lorong
    barisParkir.push([tepi + BELAKANG, false]);                      // ← membelakangi gedung (belakang ke lorong)
    tepi += BELAKANG + DEPAN + CELAH;                                // moncongnya bertemu baris berikutnya
  }
  let nomor = 0;
  for (const [d, keGedung] of barisParkir) {
    for (let x = MASUK[1] - 0.1; x < X_SELATAN - 0.4; x += 0.95) {
      const z = zGedung(x) + d;
      if (z + BELAKANG > Z_BARAT - 0.3) continue;                    // tidak menabrak pagar barat
      if (rng() < 0.15) continue;                                    // slot kosong
      const yaw = hadapGedung + (keGedung ? 0 : Math.PI) + (rng() - 0.5) * 0.2;
      const pilihan = [0, 0, 0, 0, 0, 0, 1, 2, 3, 4];                // kebanyakan motor hitam, seperti aslinya
      const m = buatMotor(`Motor Parkir ${++nomor}`, warnaMotor[pilihan[Math.floor(rng() * pilihan.length)]], {
        local: trs(x + (rng() - 0.5) * 0.15, 0.012, z + (rng() - 0.5) * 0.08, 0, yaw, 0), group: "Motor Parkir",
      });
      m.rangkaM.local = trs(0, 0, 0, 0, 0, -0.08);                  // miring di standar samping
      m.kemudi.local = trs(0, 0, 0.5, 0, (rng() - 0.5) * 0.7, 0);    // setang dibelokkan acak
      parkir.add(m.motor);
    }
  }

  // ==================================================================
  //  5. MOTOR YANG MELAJU (animasi hierarkis) + PENGENDARA
  // ==================================================================
  const mm = buatMotor("Motor Melaju", warnaMotor[3]);
  mm.motor.info = "animasi: jalan, roda berputar, belok, miring";
  mm.lampu.mat = mat("Lampu motor menyala", [1.0, 1.0, 0.92], { spec: 0.6, glow: [1.0, 1.0, 0.85] });
  mm.lampu.mat.minGlow = 0.6;          // lampu motor selalu menyala (siang pun)
  mm.lampu.info = "spotlight lampu depan";
  parkir.add(mm.motor);                // anak Area Parkir
  // Pengendara duduk di jok, anak dari Rangka Motor -> ikut miring saat menikung
  const pengendara = mm.rangkaM.add(grp("Pengendara", trs(0, 0.86, -0.3)));
  const badanP = pengendara.add(part("Badan", MS.box, MT.bajuBiru, trs(0, 0, 0, 0.22), shapeM(0.36, 0.55, 0.22, 0, 0.28, 0)));
  badanP.add(part("Helm", MS.sph, MT.helm, trs(0, 0.7, 0.02), M4.scaling(0.29, 0.29, 0.29)));
  for (const sx of [-1, 1]) {
    badanP.add(part("Lengan", MS.box, MT.bajuBiru, trs(sx * 0.21, 0.5, 0, -1.3, 0, sx * 0.08), shapeM(0.09, 0.68, 0.09, 0, -0.34, 0), { group: "Lengan" }));
    const paha = pengendara.add(part("Paha", MS.box, MT.celana, trs(sx * 0.1, 0, 0, -1.4), shapeM(0.14, 0.42, 0.14, 0, -0.21, 0), { group: "Kaki" }));
    paha.add(part("Betis", MS.box, MT.celana, trs(0, -0.42, 0, 1.4), shapeM(0.11, 0.4, 0.11, 0, -0.2, 0)));
  }
  // Jalan tidak melingkar -> motor bolak-balik: melaju sampai ujung jalan, berputar balik (U-turn), lalu kembali.
  let jarakMotor = 1.0, arahMaju = 1, v = 0, putarBalik = 0, yawMotor = 0, yawSebelum = null, jarakRoda = 0;
  const arahDi = (s, arah) => {
    const a = posisiJalur(s), b = posisiJalur(s + 0.6 * arah);
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  };
  mm.motor.update = (t, dt) => {
    let miring = 0, setir = 0;
    const p = posisiJalur(jarakMotor);
    if (putarBalik > 0) {
      // berputar balik di tempat: arah berubah 180° dalam 1,6 detik, setang dibelokkan penuh
      putarBalik = Math.max(0, putarBalik - dt);
      const f = smoothstep(0, 1, 1 - putarBalik / 1.6);
      yawMotor = yawSebelum + Math.PI * f;
      setir = 0.5; miring = 0.12; v = 0.8;
      if (putarBalik === 0) { arahMaju = -arahMaju; yawSebelum = null; v = 0.5; }
    } else {
      // melambat menjelang tikungan atau ujung jalan, ngebut di jalan lurus
      const sisa = arahMaju > 0 ? panjangJalur - jarakMotor : jarakMotor;
      let beda = arahDi(jarakMotor + 4 * arahMaju, arahMaju) - arahDi(jarakMotor, arahMaju);
      beda = Math.atan2(Math.sin(beda), Math.cos(beda));
      const vTarget = sisa < 5 ? 1.5 : Math.abs(beda) > 0.3 ? 2.8 : 5.5;
      v += (vTarget - v) * Math.min(1, dt * 1.8);
      jarakMotor = clamp(jarakMotor + v * dt * arahMaju, 0.3, panjangJalur - 0.3);
      const yaw = arahDi(jarakMotor, arahMaju);
      if (yawSebelum !== null && dt > 0) {
        let dyaw = yaw - yawSebelum; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        const belok = dyaw / Math.max(v * dt, 1e-4);                   // kelengkungan lintasan (1/m)
        miring = clamp(-belok * v * 0.35, -0.4, 0.4); setir = clamp(belok * 1.4, -0.5, 0.5);
      }
      yawMotor = yaw; yawSebelum = yaw;
      if (sisa <= 0.35) { putarBalik = 1.6; yawSebelum = yaw; }       // sampai di ujung jalan
    }
    jarakRoda += v * dt;
    mm.motor.local = trs(p[0], 0.02, p[1], 0, yawMotor, 0);
    mm.rangkaM.local = M4.rotationZ(miring);           // miring ke dalam tikungan
    mm.kemudi.local = trs(0, 0, 0.5, 0, setir, 0);
    const putar = jarakRoda / 0.255;                  // sudut roda = jarak / jari-jari
    mm.rodaDepan.local = M4.multiply(trs(0, 0.255, 0.14), M4.rotationX(putar));
    mm.rodaBelakang.local = M4.multiply(trs(0, 0.255, -0.62), M4.rotationX(putar));
  };

  // ==================================================================
  //  6. PEJALAN KAKI (animasi berjalan: paha, betis, lengan berayun)
  // ==================================================================
  const pejalanGrp = root.add(grp("Pejalan Kaki"));
  function buatPejalan(nama, baju, x, mulai, arah) {
    const orang = pejalanGrp.add(grp(nama, null, { group: "Pejalan", info: "animasi: berjalan" }));
    const pinggul = orang.add(grp("Pinggul", trs(0, 0.95, 0)));
    const badan = pinggul.add(part("Badan", MS.box, baju, null, shapeM(0.36, 0.56, 0.2, 0, 0.3, 0)));
    const kepala = badan.add(part("Kepala", MS.sph, MT.kulitOrang, trs(0, 0.73, 0), M4.scaling(0.22, 0.25, 0.23)));
    kepala.add(part("Rambut", MS.sph, MT.rambut, trs(0, 0.03, -0.015), M4.scaling(0.235, 0.22, 0.24)));
    const lengan = [], paha = [], betis = [];
    for (const sx of [-1, 1]) {
      const la = badan.add(part("Lengan Atas", MS.box, baju, trs(sx * 0.23, 0.55, 0), shapeM(0.09, 0.3, 0.09, 0, -0.15, 0), { group: "Lengan" }));
      const lb = la.add(part("Lengan Bawah", MS.box, MT.kulitOrang, trs(0, -0.3, 0), shapeM(0.075, 0.28, 0.075, 0, -0.14, 0)));
      const ph = pinggul.add(part("Paha", MS.box, MT.celana, trs(sx * 0.1, 0, 0), shapeM(0.14, 0.45, 0.14, 0, -0.225, 0), { group: "Kaki" }));
      const bt = ph.add(part("Betis", MS.box, MT.celana, trs(0, -0.45, 0), shapeM(0.12, 0.42, 0.12, 0, -0.21, 0)));
      bt.add(part("Sepatu", MS.box, MT.hitam, trs(0, -0.45, 0.05), M4.scaling(0.12, 0.07, 0.25)));
      lengan.push([la, lb]); paha.push(ph); betis.push(bt);
    }
    const zA = -3, zB = -(L - 3), panjang = zA - zB;
    let s = mulai, yawNow = arah > 0 ? Math.PI : 0;
    orang.update = (t, dt) => {
      s += 1.25 * dt;
      const u = ((s % (2 * panjang)) + 2 * panjang) % (2 * panjang);
      const maju = u < panjang;                          // maju = berjalan ke arah -z
      const z = maju ? zA - u : zB + (u - panjang);
      const target = maju ? Math.PI : 0;
      let d = target - yawNow; d = Math.atan2(Math.sin(d), Math.cos(d));
      yawNow += d * Math.min(1, dt * 5);                // berbalik dengan halus
      orang.local = trs(x, LANTAI_Y, z, 0, yawNow, 0);
      const f = s / 0.36;                                // fase langkah
      pinggul.local = trs(0, 0.95 + 0.025 * Math.cos(2 * f), 0);
      for (let k = 0; k < 2; k++) {
        const ph = f + k * Math.PI;
        paha[k].local = trs(k ? 0.1 : -0.1, 0, 0, 0.45 * Math.sin(ph));
        betis[k].local = trs(0, -0.45, 0, 0.75 * Math.max(0, -Math.cos(ph)));
        lengan[k][0].local = trs(k ? 0.23 : -0.23, 0.55, 0, -0.4 * Math.sin(ph));
        lengan[k][1].local = trs(0, -0.3, 0, -0.3);
      }
    };
    return orang;
  }
  buatPejalan("Pejalan 1", MT.bajuBiru, -0.6, 8, 1);
  buatPejalan("Pejalan 2", MT.bajuPutih, 0.6, 75, 1);

  // ==================================================================
  //  7. GEDUNG-GEDUNG — posisi, ukuran & arah diambil dari citra satelit
  // ==================================================================
  const gedungGrp = root.add(grp("Gedung"));
  const MIRING_ATAP = 6 * DEG;                                    // atap pelana gedung bengkel
  function buatGedung(nama, cx, cz, w, d, lantaiN, o = {}) {
    const h = o.tinggi || lantaiN * 3.6, yaw = o.yaw || 0;
    const g = gedungGrp.add(grp(nama, trs(cx, 0, cz, 0, yaw, 0), { group: o.group, info: o.info }));
    g.add(part("Badan Gedung", mesh(`gedung_${w.toFixed(1)}_${d.toFixed(1)}_${h}`, () => Geo.box(w, h, d, 4, 3.6)), o.mat || MT.fasad,
      trs(0, h / 2, 0), null, { info: "tekstur fasad jendela" }));
    if (o.pelat) for (let f = 1; f < lantaiN; f++)
      g.add(part(`Pelat Lantai ${f + 1}`, MS.box, MT.pelat, trs(0, f * 3.6 - 0.1, 0), M4.scaling(w + 1.2, 0.2, d + 1.2), { group: "Pelat Lantai" }));
    if (o.atap === "pelana") {
      // Atap pelana spandek: bubungan sejajar sisi panjang (sumbu x lokal), dua sisi miring utara & selatan
      const atap = g.add(grp("Atap Pelana", trs(0, h, 0)));
      const D2 = d / 2 + 0.8, naik = D2 * Math.tan(MIRING_ATAP);
      atap.add(part("Pengisi Pelana", MS.prisma, MT.dindingAtas, null, M4.scaling(w, naik + 0.25, d), { info: "prisma segitiga" }));
      const lembar = mesh(`atapGedung_${w.toFixed(1)}_${D2.toFixed(1)}`,
        () => Geo.corrugated(w + 1.6, D2 / Math.cos(MIRING_ATAP), 0.5, 0.035, 2.0));
      for (const [sisi, sz] of [["Utara", -1], ["Selatan", 1]]) {
        const sisiAtap = atap.add(grp(`Atap ${sisi}`, trs(0, 0.25 + naik / 2 + 0.04, sz * D2 / 2, sz * MIRING_ATAP, 0, 0)));
        sisiAtap.add(part("Spandek", lembar, MT.atapGedung, null, null, { group: "Spandek Gedung" }));  // rusuk turun searah kemiringan
      }
      atap.add(part("Nok", MS.box, MT.atapGedung, trs(0, 0.25 + naik + 0.06, 0), M4.scaling(w + 1.6, 0.06, 0.6)));
    } else {
      g.add(part("Atap Dak", MS.box, MT.pelat, trs(0, h + 0.17, 0), M4.scaling(w + (o.pelat ? 1.6 : 0.6), 0.35, d + (o.pelat ? 1.6 : 0.6))));
    }
    // Pintu tepat di titik selasar menempel ke dinding (koordinat dunia -> lokal gedung)
    let pintu = null;
    if (o.pintuKe) {
      const dx = o.pintuKe[0] - cx, dz = o.pintuKe[1] - cz;
      pintu = [dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)];
      g.add(part("Pintu Selasar", MS.box, MT.pintu, trs(Math.sign(pintu[0]) * (w / 2 + 0.03), 1.92, pintu[1]),
        M4.scaling(0.08, 2.96, 3.4), { info: "pintu di ujung selasar" }));
    }
    if (o.balkon) for (const lantai of o.balkon.lantai) buatBalkon(g, o.balkon.sisi, lantai, w, d, pintu);
    return g;
  }

  // Teras lantai 1 (lantai dasar): lantai teras ditinggikan, pagar besi, kolom, dan atap teras (kanopi beton).
  // Bila lantai > 0: balkon menjorok di lantai atas (pelat + pagar + kolom penopang dari bawah).
  // sisi: "x-" | "x+" | "z-" | "z+" (sisi lokal gedung). Grup diputar sehingga sumbu x-nya
  // sepanjang dinding dan +z-nya mengarah keluar gedung.
  function buatBalkon(g, sisi, lantai, w, d, pintu) {
    const keX = sisi[0] === "x", tanda = sisi[1] === "+" ? 1 : -1;
    const panjang = (keX ? d : w) - 1.0, jarak = (keX ? w : d) / 2, y = lantai * 3.6;
    const dasar = lantai === 0, DALAM = dasar ? 2.6 : 2.0;
    const ALAS = dasar ? 0.45 : 0;                         // tinggi lantai teras dari tanah
    const yawB = keX ? tanda * 90 * DEG : (tanda > 0 ? 0 : 180 * DEG);
    const b = g.add(grp(dasar ? "Teras Lantai 1" : `Balkon Lantai ${lantai + 1}`,
      trs(keX ? tanda * jarak : 0, y, keX ? 0 : tanda * jarak, 0, yawB, 0), { group: "Teras", info: "teras berpagar" }));
    // posisi pintu selasar pada sumbu teras -> bagian yang tertabrak selasar dikosongkan
    let uPintu = null;
    if (pintu && keX && Math.sign(pintu[0]) === tanda) uPintu = -tanda * pintu[1];
    const LEBAR_KOSONG = 2.7;
    let potong = [[-panjang / 2, panjang / 2]];
    if (uPintu !== null && y < 5)
      potong = [[-panjang / 2, uPintu - LEBAR_KOSONG], [uPintu + LEBAR_KOSONG, panjang / 2]].filter(([a, c]) => c - a > 1);
    potong.forEach(([a, c], i) => {
      const len = c - a;
      const seg = b.add(grp(`Bagian ${i + 1}`, trs((a + c) / 2, 0, 0), { group: "Bagian Teras" }));
      if (dasar) {
        seg.add(part("Lantai Teras", MS.box, MT.beton, trs(0, ALAS / 2, DALAM / 2), M4.scaling(len, ALAS, DALAM)));
        seg.add(part("Keramik Teras", MS.box, MT.lantai, trs(0, ALAS + 0.01, DALAM / 2 - 0.05), M4.scaling(len - 0.1, 0.02, DALAM - 0.2)));
        seg.add(part("Atap Teras", MS.box, MT.pelat, trs(0, 3.6 + 0.1, DALAM / 2 + 0.1), M4.scaling(len, 0.2, DALAM + 0.2),
          { info: "kanopi beton" }));
      } else {
        seg.add(part("Pelat Balkon", MS.box, MT.pelat, trs(0, -0.1, DALAM / 2), M4.scaling(len, 0.2, DALAM)));
      }
      // pagar besi: dua pipa memanjang, pipa samping, jeruji tegak
      seg.add(part("Pipa Atas", MS.box, MT.pagarBalkon, trs(0, ALAS + 1.0, DALAM - 0.05), M4.scaling(len, 0.06, 0.06)));
      seg.add(part("Pipa Tengah", MS.box, MT.pagarBalkon, trs(0, ALAS + 0.5, DALAM - 0.05), M4.scaling(len, 0.04, 0.04)));
      for (const sx of [-1, 1])
        seg.add(part("Pagar Samping", MS.box, MT.pagarBalkon, trs(sx * (len / 2 - 0.03), ALAS + 1.0, DALAM / 2), M4.scaling(0.06, 0.06, DALAM), { group: "Pagar Samping" }));
      const nJeruji = Math.max(1, Math.round(len / 1.2));
      for (let k = 0; k <= nJeruji; k++)
        seg.add(part("Jeruji", MS.box, MT.pagarBalkon, trs(-len / 2 + 0.03 + (len - 0.06) * k / nJeruji, ALAS + 0.5, DALAM - 0.05),
          M4.scaling(0.04, 1.0, 0.04), { group: "Jeruji" }));
      // kolom: teras dasar -> dari lantai teras ke atap teras; balkon atas -> dari pelat di bawahnya
      const nKolom = Math.max(1, Math.round(len / (dasar ? 4 : 6)));
      const yKolom = dasar ? (ALAS + 3.6) / 2 : -1.9, hKolom = dasar ? 3.6 - ALAS : 3.4;
      for (let k = 0; k <= nKolom; k++) {
        const u = -len / 2 + 0.2 + (len - 0.4) * k / nKolom;
        seg.add(part("Kolom Teras", MS.box, MT.pelat, trs(u, yKolom, DALAM - 0.25), M4.scaling(0.25, hKolom, 0.25), { group: "Kolom Teras" }));
      }
    });
  }
  // Gedung dari tiga sudut atap pada citra: [kiri-atas, kanan-atas, kiri-bawah] (piksel)
  function gedungPiksel(nama, sudut, lantaiN, o = {}) {
    const r = rangkaPiksel(sudut);                                 // sumbu x lokal = sisi atas atap
    return buatGedung(nama, r.cx, r.cz, r.w, r.d, lantaiN, { ...o, yaw: r.yaw });
  }
  gedungPiksel("Gedung Barat", [[-50, 383], [46, 383], [-50, 560]], 2,
    { atap: "pelana", pintuKe: [0, 1], info: "ujung barat selasar" });
  gedungPiksel("Gedung IRIS Robotics", [[18, 204], [429, 160], [36, 375]], 2,
    { atap: "pelana", balkon: { sisi: "z+", lantai: [0] }, info: "IRIS Robotics ITS (kiri selasar), teras lantai 1 menghadap selasar" });
  gedungPiksel("Bangunan Samping IRIS", [[18, 178], [178, 170], [19, 204]], 1, { atap: "dak", tinggi: 3.6 });
  gedungPiksel("Gedung Bayucaraka", [[464, 150], [639, 136], [486, 336]], 2,
    { atap: "pelana", mat: MT.fasad2, info: "Bayucaraka ITS UAV Team" });
  gedungPiksel("Gedung ITS ROBOCON", PX_ROBOCON, 3,
    { atap: "pelana", pintuKe: [0, -L - 1], balkon: { sisi: "x-", lantai: [0] },
      info: "ITS ROBOCON & Barunastra ITS — gedung di depan (ujung timur selasar), teras lantai 1 menghadap selasar" });
  gedungPiksel("Penghubung IRIS–ROBOCON", [[392, 334], [432, 330], [397, 400]], 1, { atap: "dak" });
  gedungPiksel("Bangunan Belakang ROBOCON", [[486, 529], [593, 520], [489, 571]], 1, { atap: "dak", mat: MT.fasad2 });
  gedungPiksel("Gedung Utara", [[32, 72], [256, 60], [40, 158]], 1, { atap: "dak", mat: MT.fasad2 });
  gedungPiksel("Gudang Kecil", [[264, 64], [389, 66], [264, 118]], 1, { atap: "dak", tinggi: 3 });
  // Di luar citra: gedung bertingkat yang terlihat di latar video (seberang parkir)
  buatGedung("Gedung Jauh 1", 62, -40, 54, 16, 3, { yaw: 90 * DEG, group: "Gedung Jauh", pelat: true });
  buatGedung("Gedung Jauh 2", 48, 28, 30, 20, 3, { group: "Gedung Jauh", mat: MT.fasad2, pelat: true });

  // ==================================================================
  //  8. LAMPU TAMAN (bola putih di atas tiang) di rumput antara selasar & Gedung IRIS
  // ==================================================================
  const lampuGrp = root.add(grp("Lampu Taman"));
  [-5, -17, -29, -41, -52].forEach((z, i) => {
    const l = lampuGrp.add(grp(`Lampu Taman ${i + 1}`, trs(-6.5, 0, z), { group: "Lampu Taman" }));
    const alas = l.add(part("Alas Beton", MS.box, MT.beton, trs(0, 0.1, 0), M4.scaling(0.28, 0.2, 0.28)));
    const tiang = alas.add(part("Tiang", MS.cyl8, MT.tiang, trs(0, 1.45, 0), M4.scaling(0.07, 2.7, 0.07)));
    tiang.add(part("Bola Lampu", MS.sph, MT.bolaLampu, trs(0, 1.52, 0), M4.scaling(0.36, 0.36, 0.36),
      { light: { color: [1.0, 0.82, 0.55], power: 4.0, offset: [0, 0, 0] }, castShadow: false, info: "point light (malam)" }));
  });

  // ==================================================================
  //  9. POHON (batang -> cabang -> tajuk), bergoyang tertiup angin
  //     Sebagian dari rumpun pohon pada citra, sisanya acak di luar citra.
  // ==================================================================
  const pohonGrp = root.add(grp("Pepohonan"));
  const pohonCitra = [[250, 20], [292, 42], [330, 12], [440, 25], [492, 10], [545, 45], [600, 18], [652, 58], [700, 28],
    [612, 96], [692, 102], [705, 255], [22, 602], [78, 586], [132, 612], [188, 626]];
  const titikPohon = pohonCitra.map(([u, v]) => peta(u, v));
  const rngP = makeRng(7);
  while (titikPohon.length < 30) {
    const x = -120 + rngP() * 210, z = -170 + rngP() * 230;
    const [u, v] = piksel(x, z);
    if (u > -30 && u < 744 && v > -30 && v < 660) continue;                 // area citra sudah diisi
    if (Math.abs(x - 62) < 14 && z > -72 && z < -8) continue;              // Gedung Jauh 1
    if (Math.abs(x - 48) < 21 && Math.abs(z - 28) < 16) continue;          // Gedung Jauh 2
    titikPohon.push([x, z]);
  }
  titikPohon.forEach(([x, z], i) => {
    const s = 0.8 + rngP() * 0.5, fase = rngP() * 6;
    const pohon = pohonGrp.add(grp(`Pohon ${i + 1}`, trs(x, 0, z, 0, rngP() * 6, 0), { group: "Pohon" }));
    const batang = pohon.add(part("Batang", MS.cyl, MT.kulit, null, shapeM(0.55 * s, 3.4 * s, 0.55 * s, 0, 1.7 * s, 0)));
    for (let k = 0; k < 3; k++) {
      const cabang = batang.add(part("Cabang", MS.cyl8, MT.kulit, trs(0, 2.8 * s, 0, 0, k * 2.1, 0.65),
        shapeM(0.25 * s, 2.6 * s, 0.25 * s, 0, 1.3 * s, 0), { group: "Cabang" }));
      cabang.add(part("Tajuk", MS.sphLo, MT.daun, trs(0, 2.5 * s, 0, 0, 0, -0.65), M4.scaling(5 * s, 2.3 * s, 5 * s)));
    }
    batang.add(part("Tajuk Atas", MS.sphLo, MT.daun, trs(0, 4.6 * s, 0), M4.scaling(6 * s, 2.6 * s, 6 * s)));
    batang.update = (t) => {
      batang.local = trs(0, 0, 0, Math.sin(t * 0.7 + fase) * 0.012, 0, Math.sin(t * 0.9 + fase) * 0.018);
    };
  });

  return {
    root, materials: [...Object.values(MT), ...warnaMotor, mm.lampu.mat],
    selasar: { L, LANTAI_Y, N_SEG, S }, peta,
    motorMelaju: mm, posisiJalur,
  };
}

// #####################################################################
//  BAGIAN: 4. RENDER LOOP, KAMERA & UI
// #####################################################################
// =====================================================================
//  Render loop, bayangan, siklus siang-malam, kamera, UI halaman
// =====================================================================

const kanvas = document.getElementById("kanvas");
const gl = kanvas.getContext("webgl", { antialias: true });
if (!gl) {
  kanvas.replaceWith(Object.assign(document.createElement("p"), { textContent: "Browser ini tidak mendukung WebGL." }));
  throw new Error("WebGL tidak tersedia");
}

const T = createTextures(gl);
const progMain = compileProgram(gl, SHADER.mainVS, SHADER.mainFS);
const progDepth = compileProgram(gl, SHADER.depthVS, SHADER.depthFS);
const progSky = compileProgram(gl, SHADER.skyVS, SHADER.skyFS);
const scene = buildScene(gl, T);
const meshLangit = uploadMesh(gl, Geo.sphere(16, 24));
const IDENT = M4.identity();

// Pengaturan yang bisa diubah dari UI
const state = {
  jam: 11.0, siklus: false, animasi: true, bayangan: true, tekstur: true, lampuPaksa: false,
  waktu: 0,            // waktu animasi (detik), berhenti saat animasi dijeda
};

// =====================================================================
//  SHADOW MAP: render kedalaman scene dari sudut pandang matahari
// =====================================================================
const SM = 2048;
const smTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, smTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SM, SM, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
  [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
const smDepth = gl.createRenderbuffer();
gl.bindRenderbuffer(gl.RENDERBUFFER, smDepth);
gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SM, SM);
const smFbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, smFbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, smTex, 0);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, smDepth);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

// Area yang dicakup shadow map (selasar + parkir + sisi gedung di sekitarnya)
const AREA_BAYANGAN = { min: [-20, 0, -62], max: [28, 10, 10] };

function hitungLightVP(dir) {
  const c = V3.scale(V3.add(AREA_BAYANGAN.min, AREA_BAYANGAN.max), 0.5);
  const up = Math.abs(dir[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
  const view = M4.lookAt(V3.add(c, V3.scale(dir, 100)), c, up);
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < 8; i++) {
    const p = M4.transformPoint(view, [
      i & 1 ? AREA_BAYANGAN.max[0] : AREA_BAYANGAN.min[0],
      i & 2 ? AREA_BAYANGAN.max[1] : AREA_BAYANGAN.min[1],
      i & 4 ? AREA_BAYANGAN.max[2] : AREA_BAYANGAN.min[2]]);
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  }
  const near = -mx[2] - 30, far = -mn[2] + 1;
  return { vp: M4.multiply(M4.ortho(mn[0], mx[0], mn[1], mx[1], near, far), view), range: far - near };
}

// =====================================================================
//  UPDATE SCENE GRAPH: jalankan animasi lalu hitung matriks world
// =====================================================================
const frame = { dinamis: [], lampu: [] };
function updateDunia(dt) {
  frame.dinamis.length = 0; frame.lampu.length = 0;
  (function telusur(node, worldInduk, dinamis) {
    if (node.update && state.animasi) node.update(state.waktu, dt);
    const d = dinamis || !!node.update;              // node beranimasi -> seluruh subtree dinamis
    M4.multiply(worldInduk, node.local, node.world); // world = world_induk * local
    if (node.mesh) {
      if (node.shape) M4.multiply(node.world, node.shape, node.model); else node.model.set(node.world);
      node.dinamis = d;
      if (d) frame.dinamis.push(node);
    }
    if (node.light) frame.lampu.push(node);
    for (const c of node.children) telusur(c, node.world, d);
  })(scene.root, IDENT, false);
}

// =====================================================================
//  OPTIMASI: semua part statis (tidak beranimasi) digabung per material
//  menjadi beberapa mesh besar -> ±1.670 part menjadi ±320 draw call.
//  Struktur hierarki tetap utuh (dipakai untuk animasi hierarkis).
// =====================================================================
function gabungStatis() {
  const kelompok = new Map();
  scene.root.walk((n) => {
    if (!n.mesh || n.dinamis) return;
    const k = n.mat.id + (n.castShadow ? "s" : "n");
    if (!kelompok.has(k)) kelompok.set(k, []);
    kelompok.get(k).push(n);
  });
  const hasil = [];
  for (const nodes of kelompok.values()) {
    let P = [], N = [], U = [], I = [];
    const simpan = () => {
      if (!I.length) return;
      hasil.push({ mesh: uploadMesh(gl, { P, N, U, I }), mat: nodes[0].mat, castShadow: nodes[0].castShadow });
      P = []; N = []; U = []; I = [];
    };
    for (const n of nodes) {
      const d = n.mesh.data, nv = d.P.length / 3;
      if (P.length / 3 + nv > 65000) simpan();
      const base = P.length / 3, nm = M4.normalMatrix(n.model);
      for (let i = 0; i < nv; i++) {
        const p = M4.transformPoint(n.model, [d.P[i * 3], d.P[i * 3 + 1], d.P[i * 3 + 2]]);
        const q = V3.normalize(M4.transformDir(nm, [d.N[i * 3], d.N[i * 3 + 1], d.N[i * 3 + 2]]));
        P.push(p[0], p[1], p[2]); N.push(q[0], q[1], q[2]);
        U.push(d.U[i * 2], d.U[i * 2 + 1]);
      }
      for (let j = 0; j < d.I.length; j++) I.push(base + d.I[j]);
    }
    simpan();
  }
  return hasil;
}

updateDunia(0);
const batchStatis = gabungStatis();
let jumlahPart = 0; scene.root.walk((n) => { if (n.mesh) jumlahPart++; });

// =====================================================================
//  SIKLUS SIANG–MALAM: arah & warna matahari, warna langit, ambient
// =====================================================================
function suasana(jam) {
  const a = (jam - 6) / 12 * Math.PI;                 // 06.00 terbit, 18.00 terbenam
  // timur = -z dunia (arah selasar menuju Gedung ROBOCON), sedikit condong ke selatan (+x)
  const sun = V3.normalize([0.3, Math.sin(a), -Math.cos(a)]);
  const e = sun[1];                                    // ketinggian matahari
  const siang = smoothstep(0.0, 0.3, e);
  const malam = 1 - smoothstep(-0.18, 0.02, e);
  const zenith = V3.lerp(V3.lerp([0.22, 0.3, 0.52], [0.3, 0.53, 0.86], siang), [0.012, 0.018, 0.045], malam);
  const horizon = V3.lerp(V3.lerp([0.98, 0.6, 0.36], [0.72, 0.83, 0.95], siang), [0.04, 0.06, 0.11], malam);
  const warnaMatahari = V3.scale(V3.lerp([1.0, 0.5, 0.25], [1.0, 0.95, 0.86], smoothstep(0.02, 0.35, e)), smoothstep(-0.02, 0.1, e) * 0.95);
  const moon = V3.normalize([-0.2, -sun[1], -sun[2]]);
  const kekuatanBulan = smoothstep(0.0, 0.25, -e) * 0.22;
  const pakaiMatahari = e > -0.02;
  const lampu = state.lampuPaksa ? 1 : smoothstep(0.12, -0.04, e);
  return {
    sun, moon, e, malam, zenith, horizon, lampu,
    keyDir: pakaiMatahari ? sun : moon,
    keyColor: pakaiMatahari ? warnaMatahari : V3.scale([0.6, 0.7, 1.0], kekuatanBulan),
    skyAmb: V3.add(V3.add(V3.scale([0.5, 0.53, 0.57], siang * 0.85 + (1 - malam) * 0.15), V3.scale(zenith, 0.2)), [0.045, 0.055, 0.09]),
    groundAmb: V3.add(V3.scale([0.62, 0.58, 0.5], siang * 0.75 + (1 - malam) * 0.12), [0.015, 0.015, 0.02]),
  };
}

// =====================================================================
//  KAMERA: jalan di selasar / orbit / bebas (WASD)
// =====================================================================
const LANTAI = scene.selasar.LANTAI_Y, PANJANG_SELASAR = scene.selasar.L;
const kamera = {
  mode: "orbit", pos: [0, 1.86, -2], yaw: 0, pitch: 0,
  orbit: { target: [2, 1.5, -30], jarak: 72, yaw: 0.75, pitch: 0.5 },
  jalanZ: -2, lihatYaw: 0, lihatPitch: 0,
};
const arahDari = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

// ---------------------------------------------------------------------
//  MODE VIDEO: kanvas WebGL (kiri) & video asli (kanan) berdampingan.
//  Kamera WebGL mengikuti waktu video. Pose kamera diperkirakan dari frame
//  video (titik hilang selasar, posisi kolom / lampu / pagar), lalu
//  diinterpolasi linear di antara keyframe. Ubah angka di sini untuk kalibrasi.
//  Keyframe: [detik, x, y, z, yaw, pitch]
//    yaw 0 = menghadap -z (sepanjang selasar menuju Gedung ITS ROBOCON),
//    yaw + = menoleh ke kanan (+x, selatan / parkir); pitch + = mendongak.
// ---------------------------------------------------------------------
const FOLDER_VIDEO = "footage/WhatsApp%20Unknown%202026-11-05%20at%2003.18.08/";
const MATA = LANTAI + 1.5;                       // tinggi mata saat berdiri di lantai selasar
const Z_PAGAR_BARAT = -34.3;                     // pagar barat parkir (lihat Area Parkir di buildScene)
const VIDEO_REF = [
  {
    nama: "Video 1 — menyusuri selasar",
    src: FOLDER_VIDEO + "WhatsApp%20Video%202026-11-04%20at%2020.16.16.mp4",
    // berjalan ±1,25 m/detik dari pintu gedung barat sambil menoleh kiri-kanan
    kunci: [
      [0, 0.15, MATA, 0.9, 0.05, 0], [1, 0.15, MATA, -0.37, 0.02, -0.04], [2, 0.15, MATA, -1.64, -0.1, -0.06],
      [3, 0.15, MATA, -2.91, 0.02, -0.08], [4, 0.15, MATA, -4.18, 0.13, -0.12], [5, 0.15, MATA, -5.45, -0.14, -0.12],
      [6, 0.15, MATA, -6.72, -0.05, -0.12], [7, 0.15, MATA, -7.99, 0.19, -0.15], [8, 0.15, MATA, -9.26, 0.09, -0.15],
      [9, 0.15, MATA, -10.53, -0.05, -0.14], [10, 0.15, MATA, -11.8, 0.08, -0.14], [11, 0.15, MATA, -13.07, 0.04, -0.12],
      [12, 0.15, MATA, -14.34, -0.11, -0.12], [13, 0.15, MATA, -15.61, -0.12, -0.12], [14, 0.15, MATA, -16.88, -0.09, -0.12],
      [15, 0.15, MATA, -18.15, 0.18, -0.12], [16, 0.15, MATA, -19.42, 0.15, -0.12], [17, 0.15, MATA, -20.69, -0.13, -0.12],
      [18, 0.15, MATA, -21.96, 0, -0.12], [19, 0.15, MATA, -23.23, 0.1, -0.12], [20, 0.15, MATA, -24.5, 0.06, -0.12],
      [21.2, 0.15, MATA, -26.0, 0.06, -0.12],
    ],
  },
  {
    nama: "Video 2 — area parkir",
    src: FOLDER_VIDEO + "WhatsApp%20Video%202026-11-04%20at%2020.16.18.mp4",
    // di jalur paving sisi barat parkir, menoleh ke gedung, lalu naik ke selasar & melihat ke parkir
    kunci: [
      [0, 4.6, 1.55, Z_PAGAR_BARAT + 2.0, 1.33, -0.12], [0.4, 4.3, 1.55, Z_PAGAR_BARAT + 2.1, 1.2, -0.12],
      [0.8, 3.8, 1.55, Z_PAGAR_BARAT + 2.3, 0.85, -0.1], [1.2, 3.0, 1.55, Z_PAGAR_BARAT + 2.7, 0.4, -0.12],
      [1.6, 2.4, 1.55, Z_PAGAR_BARAT + 3.1, 0.15, -0.15], [2.0, 1.8, 1.75, Z_PAGAR_BARAT + 2.7, 0.45, -0.3],
      [2.4, 1.2, MATA, Z_PAGAR_BARAT + 2.1, 0.85, -0.35], [2.8, 1.1, MATA, Z_PAGAR_BARAT + 1.7, 0.95, -0.33],
      [3.4, 1.0, MATA, Z_PAGAR_BARAT + 1.3, 0.95, -0.3],
    ],
  },
  {
    nama: "Video 3 — taman & lampu",
    src: FOLDER_VIDEO + "WhatsApp%20Video%202026-11-04%20at%2020.16.19.mp4",
    // di rumput utara selasar dekat teras gedung timur, menghadap barat daya sambil berjalan pelan
    kunci: [
      [0, -8.0, 1.6, -47.5, 2.5, 0.05], [1.4, -8.0, 1.6, -46.5, 2.62, 0.05], [2.9, -8.0, 1.6, -45.5, 2.72, 0.05],
    ],
  },
];
const elVideo = document.getElementById("videoBanding");
const elPanelVideo = document.getElementById("panelVideo");
const elBarisVideo = document.getElementById("barisVideo");
let videoAktif = 0;
function pilihVideo(i) {
  videoAktif = clamp(i | 0, 0, VIDEO_REF.length - 1);
  const v = VIDEO_REF[videoAktif];
  if (!elVideo.src.endsWith(v.src)) { elVideo.src = v.src; elVideo.title = v.nama; }
  elVideo.currentTime = 0;
  elVideo.play().catch(() => {});
  document.querySelectorAll("[data-video]").forEach((b) => b.classList.toggle("aktif", +b.dataset.video === videoAktif));
}
// Pose kamera pada detik t: interpolasi linear antara dua keyframe terdekat
function poseVideo(kunci, t) {
  let i = 0;
  while (i < kunci.length - 2 && kunci[i + 1][0] <= t) i++;
  const a = kunci[i], b = kunci[Math.min(i + 1, kunci.length - 1)];
  const f = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
  const lerp = (k) => a[k] + (b[k] - a[k]) * f;
  return { pos: [lerp(1), lerp(2), lerp(3)], yaw: lerp(4), pitch: lerp(5) };
}

// Mode kamera: "orbit" (mengelilingi scene), "jalan" (menyusuri selasar), "bebas" (terbang WASD),
// "video" (berdampingan dengan video asli)
function setModeKamera(mode) {
  if (mode === "jalan") { kamera.lihatYaw = 0; kamera.lihatPitch = 0; }
  const banding = mode === "video";
  if (banding && kamera.mode !== "video") pilihVideo(videoAktif);
  if (!banding) elVideo.pause();
  kamera.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("aktif", b.dataset.mode === mode));
  elViewer.classList.toggle("banding", banding);
  elPanelVideo.hidden = elBarisVideo.hidden = !banding;
}

const tombol = new Set();
let seret = null;
function updateKamera(dt) {
  const k = kamera;
  if (k.mode === "jalan") {
    k.jalanZ -= 1.3 * dt;                                       // kecepatan jalan kaki
    if (k.jalanZ < -(PANJANG_SELASAR - 1)) k.jalanZ = -2;
    const bob = Math.sin(k.jalanZ * Math.PI / 0.7) * 0.02;
    k.pos = [0.1 * Math.sin(k.jalanZ * 0.15), LANTAI + 1.45 + bob, k.jalanZ];
    k.yaw = k.lihatYaw; k.pitch = k.lihatPitch - 0.03;
  } else if (k.mode === "orbit") {
    const o = k.orbit;
    if (!seret) o.yaw += 0.05 * dt;
    k.pos = V3.add(o.target, V3.scale([Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch)], o.jarak));
    const d = V3.normalize(V3.sub(o.target, k.pos));
    k.yaw = Math.atan2(d[0], -d[2]); k.pitch = Math.asin(d[1]);
  } else if (k.mode === "bebas") {
    const cepat = tombol.has("ShiftLeft") || tombol.has("ShiftRight") ? 14 : 5;
    const f = [Math.sin(k.yaw), 0, -Math.cos(k.yaw)], r = [Math.cos(k.yaw), 0, Math.sin(k.yaw)];
    let gerak = [0, 0, 0];
    if (tombol.has("KeyW") || tombol.has("ArrowUp")) gerak = V3.add(gerak, f);
    if (tombol.has("KeyS") || tombol.has("ArrowDown")) gerak = V3.sub(gerak, f);
    if (tombol.has("KeyD") || tombol.has("ArrowRight")) gerak = V3.add(gerak, r);
    if (tombol.has("KeyA") || tombol.has("ArrowLeft")) gerak = V3.sub(gerak, r);
    if (tombol.has("Space")) gerak[1] += 1;                                     // naik
    if (tombol.has("ControlLeft") || tombol.has("ControlRight")) gerak[1] -= 1; // turun
    k.pos = V3.add(k.pos, V3.scale(gerak, cepat * dt));
    k.pos[1] = Math.max(0.3, k.pos[1]);
  } else if (k.mode === "video") {
    const p = poseVideo(VIDEO_REF[videoAktif].kunci, elVideo.currentTime || 0);
    k.pos = p.pos; k.yaw = p.yaw; k.pitch = p.pitch;
  }
}

// Input mouse / sentuh: seret untuk melihat sekeliling, scroll untuk zoom
kanvas.addEventListener("pointerdown", (e) => {
  seret = { x: e.clientX, y: e.clientY };
  kanvas.setPointerCapture(e.pointerId);
  kanvas.focus();
});
kanvas.addEventListener("pointerup", () => { seret = null; });
kanvas.addEventListener("pointercancel", () => { seret = null; });
kanvas.addEventListener("pointermove", (e) => {
  if (!seret || kamera.mode === "video") return;           // mode video: kamera dikendalikan video
  const dx = e.clientX - seret.x, dy = e.clientY - seret.y;
  seret = { x: e.clientX, y: e.clientY };
  const k = kamera;
  if (k.mode === "orbit") {
    k.orbit.yaw -= dx * 0.006;
    k.orbit.pitch = clamp(k.orbit.pitch + dy * 0.004, 0.03, 1.45);
  } else if (k.mode === "jalan") {
    k.lihatYaw += dx * 0.004; k.lihatPitch = clamp(k.lihatPitch - dy * 0.004, -1.2, 1.2);
  } else {
    k.yaw += dx * 0.004; k.pitch = clamp(k.pitch - dy * 0.004, -1.4, 1.4);
  }
});
kanvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (kamera.mode === "video") return;
  if (kamera.mode === "orbit") kamera.orbit.jarak = clamp(kamera.orbit.jarak * Math.exp(e.deltaY * 0.001), 6, 160);
  else {
    if (kamera.mode !== "bebas") setModeKamera("bebas");
    kamera.pos = V3.add(kamera.pos, V3.scale(arahDari(kamera.yaw, kamera.pitch), -e.deltaY * 0.01));
  }
}, { passive: false });
// Keyboard hanya menggerakkan kamera saat area 3D aktif (fokus di dalamnya atau layar penuh),
// supaya Spasi / panah tetap bisa menggulir halaman saat membaca bagian lain.
const elViewer = document.getElementById("viewer");
const MODE_ANGKA = { Digit1: "orbit", Digit2: "jalan", Digit3: "bebas", Digit4: "video" };
const viewerAktif = () => elViewer.contains(document.activeElement) || layarPenuhAktif();
window.addEventListener("keydown", (e) => {
  if (!viewerAktif()) return;
  if (e.target.tagName === "INPUT" && e.target.type === "range") return;
  if (e.target === elVideo) return;                       // tombol video bawaan (spasi, panah) ditangani browser
  if (e.code === "KeyF") { toggleLayarPenuh(); return; }
  if (MODE_ANGKA[e.code]) { setModeKamera(MODE_ANGKA[e.code]); return; }
  if (e.code === "KeyH") { togglePanel(); return; }
  if (kamera.mode === "video" && e.code === "Space") {    // mode video: spasi = putar / jeda
    e.preventDefault();
    if (elVideo.paused) elVideo.play().catch(() => {}); else elVideo.pause();
    return;
  }
  tombol.add(e.code);
  // Spasi = naik, Ctrl = turun. preventDefault juga mencegah Spasi menggulir halaman / menekan tombol,
  // dan pintasan Ctrl+S/A/D. (Ctrl+W tidak bisa dicegah browser -> pakai panah saat menahan Ctrl.)
  if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ControlLeft", "ControlRight",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
    e.preventDefault();
    if (kamera.mode !== "bebas") setModeKamera("bebas");
  }
});
window.addEventListener("keyup", (e) => tombol.delete(e.code));
window.addEventListener("blur", () => tombol.clear());

// =====================================================================
//  GAMBAR
// =====================================================================
function aktifkanProgram(p) {
  gl.useProgram(p);
  for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
  for (const loc of Object.values(p.a)) gl.enableVertexAttribArray(loc);
}
function ikatMesh(p, m) {
  gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 0, 0);
  if (p.a.aNormal !== undefined) { gl.bindBuffer(gl.ARRAY_BUFFER, m.nor); gl.vertexAttribPointer(p.a.aNormal, 3, gl.FLOAT, false, 0, 0); }
  if (p.a.aUV !== undefined) { gl.bindBuffer(gl.ARRAY_BUFFER, m.uv); gl.vertexAttribPointer(p.a.aUV, 2, gl.FLOAT, false, 0, 0); }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
}
function pasangMaterial(m) {
  const u = progMain.u, pakaiTex = state.tekstur && m.tex;
  // jika tekstur dimatikan, pakai warna rata-rata tekstur supaya tetap mirip
  gl.uniform3fv(u.uColor, !pakaiTex && m.tex ? m.color.map((c, i) => c * m.tex.avg[i]) : m.color);
  gl.uniform1i(u.uUseTex, pakaiTex ? 1 : 0);
  if (pakaiTex) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.tex);
    gl.uniform3fv(u.uTexAvg, m.tex.avg);
  }
  gl.uniform1f(u.uDetail, pakaiTex ? m.detail || 0 : 0);
  gl.uniform2fv(u.uUVScale, m.uv);
  gl.uniform1f(u.uShininess, m.shin);
  gl.uniform1f(u.uSpecular, m.spec);
  gl.uniform3fv(u.uEmissive, m.emissive);
  gl.uniform1f(u.uReflect, m.refl);
}
const tmpNormal = new Float32Array(16);
function gambarPart(n) {
  gl.uniformMatrix4fv(progMain.u.uModel, false, n.model);
  gl.uniformMatrix4fv(progMain.u.uNormalMat, false, M4.normalMatrix(n.model, tmpNormal));
  ikatMesh(progMain, n.mesh);
  gl.drawElements(gl.TRIANGLES, n.mesh.count, gl.UNSIGNED_SHORT, 0);
}

function render(dt) {
  // --- ukuran kanvas mengikuti ukuran tampilan ---
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(kanvas.clientWidth * dpr), h = Math.round(kanvas.clientHeight * dpr);
  if (kanvas.width !== w || kanvas.height !== h) { kanvas.width = w; kanvas.height = h; }

  const sx = suasana(state.jam);
  // pijar lampu (emissive) mengikuti waktu
  for (const m of scene.materials) if (m.glow) m.emissive = V3.scale(m.glow, Math.max(sx.lampu, m.minGlow || 0));

  // --- 1) SHADOW PASS ---
  const bayanganAktif = state.bayangan && sx.keyColor[0] + sx.keyColor[1] > 0.02;
  const light = hitungLightVP(sx.keyDir);
  if (bayanganAktif) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, smFbo);
    gl.viewport(0, 0, SM, SM);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    aktifkanProgram(progDepth);
    gl.uniformMatrix4fv(progDepth.u.uLightVP, false, light.vp);
    gl.uniformMatrix4fv(progDepth.u.uModel, false, IDENT);
    for (const b of batchStatis) if (b.castShadow) { ikatMesh(progDepth, b.mesh); gl.drawElements(gl.TRIANGLES, b.mesh.count, gl.UNSIGNED_SHORT, 0); }
    for (const n of frame.dinamis) if (n.castShadow) {
      gl.uniformMatrix4fv(progDepth.u.uModel, false, n.model);
      ikatMesh(progDepth, n.mesh); gl.drawElements(gl.TRIANGLES, n.mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // --- kamera ---
  gl.viewport(0, 0, w, h);
  const aspect = w / h;
  const proj = M4.perspective((aspect < 1 ? 66 : 50) * DEG, aspect, 0.1, 1200);
  const fwd = arahDari(kamera.yaw, kamera.pitch);
  const view = M4.lookAt(kamera.pos, V3.add(kamera.pos, fwd), [0, 1, 0]);

  // --- 2) LANGIT ---
  gl.clearColor(...sx.horizon, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  aktifkanProgram(progSky);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  const viewRot = Float32Array.from(view); viewRot[12] = viewRot[13] = viewRot[14] = 0;
  const su = progSky.u;
  gl.uniformMatrix4fv(su.uViewRot, false, viewRot);
  gl.uniformMatrix4fv(su.uProj, false, proj);
  gl.uniform3fv(su.uZenith, sx.zenith); gl.uniform3fv(su.uHorizon, sx.horizon);
  gl.uniform3fv(su.uSunDir, sx.sun); gl.uniform3fv(su.uMoonDir, sx.moon);
  gl.uniform3fv(su.uSunColor, V3.scale([1, 0.9, 0.7], smoothstep(-0.05, 0.05, sx.e)));
  gl.uniform1f(su.uNight, sx.malam);
  ikatMesh(progSky, meshLangit);
  gl.drawElements(gl.TRIANGLES, meshLangit.count, gl.UNSIGNED_SHORT, 0);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);

  // --- 3) SCENE ---
  aktifkanProgram(progMain);
  const u = progMain.u;
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uLightVP, false, light.vp);
  gl.uniform3fv(u.uCamPos, kamera.pos);
  gl.uniform3fv(u.uKeyDir, sx.keyDir); gl.uniform3fv(u.uKeyColor, sx.keyColor);
  gl.uniform3fv(u.uSkyAmb, sx.skyAmb); gl.uniform3fv(u.uGroundAmb, sx.groundAmb);
  gl.uniform3fv(u.uFogColor, sx.horizon); gl.uniform1f(u.uFogDensity, 0.0042);
  gl.uniform3fv(u.uEnvTop, sx.zenith); gl.uniform3fv(u.uEnvBottom, sx.horizon);
  // point light
  const pos = [], col = [];
  if (sx.lampu > 0.01) for (const n of frame.lampu.slice(0, MAX_LAMPU)) {
    pos.push(...M4.transformPoint(n.world, n.light.offset));
    col.push(...V3.scale(n.light.color, n.light.power * sx.lampu));
  }
  gl.uniform1i(u.uPLCount, pos.length / 3);
  if (pos.length) { gl.uniform3fv(u.uPLPos, pos); gl.uniform3fv(u.uPLColor, col); }
  // spotlight lampu motor
  const lm = scene.motorMelaju.lampu.world;
  gl.uniform3fv(u.uSpotPos, M4.transformPoint(lm, [0, 0, 0.05]));
  gl.uniform3fv(u.uSpotDir, V3.normalize(M4.transformDir(lm, [0, -0.12, 1])));
  gl.uniform3fv(u.uSpotColor, V3.scale([1, 0.97, 0.85], 2.2 * Math.max(sx.lampu, 0.05)));
  gl.uniform1f(u.uSpotCos, Math.cos(22 * DEG));
  // bayangan
  gl.uniform1i(u.uShadowOn, bayanganAktif ? 1 : 0);
  gl.uniform1f(u.uShadowTexel, 1 / SM);
  gl.uniform1f(u.uShadowBias, 0.06 / light.range);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, smTex);
  gl.uniform1i(u.uShadowMap, 1); gl.uniform1i(u.uTex, 0);

  gl.uniformMatrix4fv(u.uModel, false, IDENT);
  gl.uniformMatrix4fv(u.uNormalMat, false, IDENT);
  for (const b of batchStatis) {
    pasangMaterial(b.mat); ikatMesh(progMain, b.mesh);
    gl.drawElements(gl.TRIANGLES, b.mesh.count, gl.UNSIGNED_SHORT, 0);
  }
  for (const n of frame.dinamis) { pasangMaterial(n.mat); gambarPart(n); }
  return batchStatis.length + frame.dinamis.length;
}

// =====================================================================
//  LOOP UTAMA
// =====================================================================
const elFps = document.getElementById("fps");
const elJam = document.getElementById("jam"), elJamLabel = document.getElementById("jamLabel");
let waktuSebelum = performance.now(), fpsHalus = 60, hitungFrame = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - waktuSebelum) / 1000);
  waktuSebelum = now;
  if (state.animasi) state.waktu += dt;
  if (state.siklus) {
    state.jam = (state.jam + dt * 0.4) % 24;          // 1 jam simulasi = 2,5 detik
    elJam.value = state.jam;
  }
  elJamLabel.textContent = formatJam(state.jam);
  updateDunia(dt);
  updateKamera(dt);
  const drawCall = render(dt);
  fpsHalus = fpsHalus * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
  if (++hitungFrame % 15 === 1)
    elFps.textContent = `${fpsHalus.toFixed(0)} fps · ${drawCall} draw call · ${jumlahPart} part`;
  requestAnimationFrame(loop);
}
const formatJam = (j) => `${String(Math.floor(j)).padStart(2, "0")}.${String(Math.floor((j % 1) * 60)).padStart(2, "0")}`;

// =====================================================================
//  PANEL KONTROL
// =====================================================================
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setModeKamera(b.dataset.mode)));
document.querySelectorAll("[data-video]").forEach((b) => b.addEventListener("click", () => pilihVideo(+b.dataset.video)));
elJam.addEventListener("input", () => { state.jam = +elJam.value; });
const ikatCek = (id, key) => {
  const el = document.getElementById(id);
  el.checked = state[key];
  el.addEventListener("change", () => { state[key] = el.checked; });
};
ikatCek("cbSiklus", "siklus"); ikatCek("cbAnimasi", "animasi"); ikatCek("cbBayangan", "bayangan");
ikatCek("cbTekstur", "tekstur"); ikatCek("cbLampu", "lampuPaksa");
document.querySelectorAll("[data-jam]").forEach((b) => b.addEventListener("click", () => {
  state.jam = +b.dataset.jam; elJam.value = state.jam;
}));
const elIsiPanel = document.getElementById("isiPanel"), elBtnPanel = document.getElementById("btnPanel");
function togglePanel() {
  elIsiPanel.hidden = !elIsiPanel.hidden;
  elBtnPanel.textContent = elIsiPanel.hidden ? "+" : "–";
}
elBtnPanel.addEventListener("click", togglePanel);
// setelah tombol panel diklik, fokus kembali ke kanvas agar keyboard langsung menggerakkan kamera
document.querySelectorAll("#viewer button").forEach((b) => b.addEventListener("mouseup", () => kanvas.focus({ preventScroll: true })));

// Parameter URL opsional, mis. index.html?jam=21&mode=jalan  atau  index.html?mode=video&video=2
const q = new URLSearchParams(location.search);
if (q.has("jam")) { state.jam = +q.get("jam"); elJam.value = state.jam; }
if (q.has("video")) videoAktif = clamp(+q.get("video") - 1, 0, VIDEO_REF.length - 1) || 0;
setModeKamera(q.get("mode") || "orbit");
requestAnimationFrame(loop);

// #####################################################################
//  BAGIAN: 5. HALAMAN — LAYAR PENUH / PERKECIL
// #####################################################################

// ---------------------------------------------------------------------
//  Layar penuh / perkecil. Memakai Fullscreen API; bila tidak didukung
//  (mis. Safari iPhone), area 3D dibesarkan memenuhi jendela dengan CSS.
// ---------------------------------------------------------------------
const elBtnLayar = document.getElementById("btnLayar");
function layarPenuhAktif() {
  return document.fullscreenElement === elViewer || elViewer.classList.contains("penuh");
}
function perbaruiTombolLayar() {
  const penuh = layarPenuhAktif();
  elBtnLayar.textContent = penuh ? "Perkecil" : "Layar penuh";
  elBtnLayar.title = (penuh ? "Kembali ke ukuran halaman" : "Tampilkan 3D memenuhi layar") + " (F)";
  document.body.classList.toggle("tanpa-gulir", elViewer.classList.contains("penuh"));
}
function toggleLayarPenuh() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (elViewer.classList.contains("penuh")) elViewer.classList.remove("penuh");
  else if (elViewer.requestFullscreen) elViewer.requestFullscreen().catch(() => elViewer.classList.add("penuh"));
  else elViewer.classList.add("penuh");
  perbaruiTombolLayar();
  kanvas.focus({ preventScroll: true });
}
elBtnLayar.addEventListener("click", toggleLayarPenuh);
document.addEventListener("fullscreenchange", perbaruiTombolLayar);
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && elViewer.classList.contains("penuh")) { elViewer.classList.remove("penuh"); perbaruiTombolLayar(); }
});
perbaruiTombolLayar();
