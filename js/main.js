"use strict";
// =====================================================================
//  main.js — render loop, bayangan, siklus siang-malam, kamera, UI halaman
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
// Mode kamera: "orbit" (mengelilingi scene), "jalan" (menyusuri selasar), "bebas" (terbang WASD)
function setModeKamera(mode) {
  if (mode === "jalan") { kamera.lihatYaw = 0; kamera.lihatPitch = 0; }
  kamera.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("aktif", b.dataset.mode === mode));
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
  if (!seret) return;
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
  if (kamera.mode === "orbit") kamera.orbit.jarak = clamp(kamera.orbit.jarak * Math.exp(e.deltaY * 0.001), 6, 160);
  else {
    if (kamera.mode !== "bebas") setModeKamera("bebas");
    kamera.pos = V3.add(kamera.pos, V3.scale(arahDari(kamera.yaw, kamera.pitch), -e.deltaY * 0.01));
  }
}, { passive: false });
// Keyboard dipasang di window agar tetap jalan walau fokus ada di panel
const MODE_ANGKA = { Digit1: "orbit", Digit2: "jalan", Digit3: "bebas" };
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" && e.target.type === "range") return;
  if (MODE_ANGKA[e.code]) { setModeKamera(MODE_ANGKA[e.code]); return; }
  if (e.code === "KeyH") { togglePanel(); return; }
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
// tombol tidak menahan fokus, agar keyboard langsung menggerakkan kamera
document.querySelectorAll("#panel button").forEach((b) => b.addEventListener("mouseup", () => b.blur()));

// Parameter URL opsional, mis. index.html?jam=21&mode=jalan
const q = new URLSearchParams(location.search);
if (q.has("jam")) { state.jam = +q.get("jam"); elJam.value = state.jam; }
setModeKamera(q.get("mode") || "orbit");
requestAnimationFrame(loop);
