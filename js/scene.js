"use strict";
// =====================================================================
//  scene.js — HIERARCHICAL MODELLING (scene graph)
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
  //  1. LINGKUNGAN: rumput, paving, area parkir, jalan motor
  // ==================================================================
  const lingkungan = root.add(grp("Lingkungan"));
  lingkungan.add(part("Rumput", mesh("rumput", () => Geo.plane(700, 700, 13, 13)), MT.rumput, null, null,
    { castShadow: false, info: "tekstur rumput prosedural" }));
  lingkungan.add(part("Jalur Paving", mesh("jalurPaving", () => Geo.plane(2.2, 80, 1.2, 1.2)), MT.paving,
    trs(4.6, 0.015, -33), null, { castShadow: false }));
  lingkungan.add(part("Lahan Parkir", mesh("lahanParkir", () => Geo.plane(13, 34, 3, 3)), MT.tanah,
    trs(16, 0.012, -32), null, { castShadow: false }));

  // Lintasan motor: bentuk stadion mengelilingi area parkir
  const JALUR = { cx: 16, zN: -14, zS: -50, r: 8 };
  const panjangLurus = JALUR.zN - JALUR.zS;
  const panjangJalur = 2 * panjangLurus + 2 * Math.PI * JALUR.r;
  function posisiJalur(s) {
    s = ((s % panjangJalur) + panjangJalur) % panjangJalur;
    const { cx, zN, zS, r } = JALUR, busur = Math.PI * r;
    if (s < panjangLurus) return [cx - r, zN - s];                       // sisi barat, ke arah -z
    s -= panjangLurus;
    if (s < busur) { const a = Math.PI + s / r; return [cx + r * Math.cos(a), zS + r * Math.sin(a)]; }
    s -= busur;
    if (s < panjangLurus) return [cx + r, zS + s];                       // sisi timur, ke arah +z
    s -= panjangLurus;
    const a = s / r; return [cx + r * Math.cos(a), zN + r * Math.sin(a)];
  }
  const titikJalur = [];
  for (let s = 0; s < panjangJalur; s += 0.5) titikJalur.push(posisiJalur(s));
  lingkungan.add(part("Jalan Paving Motor", mesh("jalanMotor", () => Geo.pathStrip(titikJalur, 3.0, 1.2)),
    MT.paving, trs(0, 0.02, 0), null, { castShadow: false }));

  // ==================================================================
  //  2. SELASAR (koridor beratap) — objek utama
  // ==================================================================
  const N_SEG = 22, S = 3.0, L = N_SEG * S;           // 22 bentang x 3 m = 66 m
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

  // ------------------------------------------------------------------
  //  2b. SELASAR KANTILEVER — cabang menuju Gedung Aula.
  //  Tiang tinggi hanya di sisi taman, balok atas menjorok di atas atap,
  //  atap miring satu arah, dan kabel baja penggantung.
  //  Dibangun dalam koordinat lokal (memanjang ke -z), lalu seluruh
  //  cabang diputar 90° -> memanjang ke arah -x dunia.
  // ------------------------------------------------------------------
  const CAB = { panjang: 30, lantai: 0.6, n: 8 };
  const jarakTiang = CAB.panjang / CAB.n;
  const cabang = root.add(grp("Selasar Kantilever", trs(-2.45, 0, -33, 0, Math.PI / 2, 0),
    { info: "cabang ke Gedung Aula" }));
  const lantaiC = cabang.add(grp("Lantai", trs(0, 0, -CAB.panjang / 2)));
  lantaiC.add(part("Dinding Beton", mesh("pelatCabang", () => Geo.box(3.4, CAB.lantai, CAB.panjang, 1.5, 1.5)), MT.beton,
    trs(0, CAB.lantai / 2 - 0.01, 0)));
  lantaiC.add(part("Keramik", mesh("keramikCabang", () => Geo.box(3.0, 0.02, CAB.panjang, 1.7, 1.7)), MT.lantai,
    trs(0, CAB.lantai, 0)));
  const sambungan = cabang.add(part("Sambungan", MS.box, MT.beton, trs(0, CAB.lantai / 2 - 0.01, 0.3), M4.scaling(3.0, CAB.lantai, 0.6),
    { info: "penghubung ke selasar utama" }));
  sambungan.add(part("Keramik Sambungan", MS.box, MT.lantai, trs(0, CAB.lantai / 2, 0), M4.scaling(2.6, 0.02, 0.6)));
  for (const sx of [-1, 1])
    lantaiC.add(part("List Tepi", mesh("listCabang", () => Geo.box(0.2, 0.06, CAB.panjang, 1, 1)), MT.tepi,
      trs(sx * 1.6, CAB.lantai + 0.03, 0), null, { group: "List Tepi" }));

  // batang lurus di antara dua titik (dipakai untuk kabel baja)
  function batang(nama, a, b, tebal, material, o = {}) {
    const d = V3.sub(b, a), len = V3.length(d), u = V3.scale(d, 1 / len);
    const c = V3.scale(V3.add(a, b), 0.5);
    return part(nama, MS.cyl8, material, trs(c[0], c[1], c[2], Math.acos(clamp(u[1], -1, 1)), Math.atan2(u[0], u[2]), 0),
      M4.scaling(tebal, len, tebal), o);
  }
  const yAtapJauh = CAB.lantai + 3.0, yAtapDekat = CAB.lantai + 1.95;     // atap miring satu arah
  const yAtap = (x) => yAtapJauh + (x + 1.85) / 3.8 * (yAtapDekat - yAtapJauh);
  const tinggiTiang = 3.5, yPuncak = CAB.lantai + tinggiTiang;
  for (let k = 0; k <= CAB.n; k++) {
    const z = -k * jarakTiang;
    const rg = cabang.add(grp(`Portal ${k + 1}`, trs(0, 0, z), { group: "Portal" }));
    const tiang = rg.add(part("Tiang Tinggi", MS.box, MT.kuning, trs(1.75, CAB.lantai + tinggiTiang / 2, 0),
      M4.scaling(0.16, tinggiTiang, 0.16)));
    tiang.add(part("Balok Atas (kantilever)", MS.box, MT.kuning, trs(-1.825, tinggiTiang / 2 - 0.08, 0),
      M4.scaling(3.81, 0.16, 0.12)));
    const hPendek = yAtap(-1.75) - 0.08 - CAB.lantai;
    rg.add(part("Tiang Pendek", MS.box, MT.kuning, trs(-1.75, CAB.lantai + hPendek / 2, 0), M4.scaling(0.12, hPendek, 0.12)));
    rg.add(part("Balok Atap", MS.box, MT.kuning, trs(0.05, yAtap(0.05) - 0.08, 0, 0, 0, Math.atan2(yAtapDekat - yAtapJauh, 3.8)),
      M4.scaling(3.85, 0.1, 0.08)));
    if (k < CAB.n) for (const dz of [-1, 1]) {
      if (k === 0 && dz > 0) continue;
      rg.add(batang("Kabel Baja", [1.75, yPuncak - 0.1, 0], [1.9, yAtap(1.9), dz * jarakTiang / 2], 0.018, MT.krom,
        { group: "Kabel Baja", castShadow: false }));
    }
    if (k === CAB.n) rg.add(batang("Kabel Baja", [1.75, yPuncak - 0.1, 0], [1.9, yAtap(1.9), jarakTiang / 2], 0.018, MT.krom,
      { group: "Kabel Baja", castShadow: false }));
  }
  const rangkaC = cabang.add(grp("Rangka Memanjang", trs(0, 0, -CAB.panjang / 2)));
  for (const x of [-1.75, 1.75])
    rangkaC.add(part("Balok Tepi", MS.box, MT.kuning, trs(x, yAtap(x) - 0.17, 0), M4.scaling(0.1, 0.12, CAB.panjang + 0.2), { group: "Balok Tepi" }));
  rangkaC.add(part("Atap Miring", mesh("spandekCabang", () => Geo.corrugated(3.82, CAB.panjang + 0.6, 0.12, 0.012, 1.0)), MT.atapCoklat,
    trs(0.05, (yAtapJauh + yAtapDekat) / 2, 0, 0, 0, Math.atan2(yAtapDekat - yAtapJauh, 3.8)), null, { info: "atap miring satu arah" }));

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
  const parkir = root.add(grp("Area Parkir"));
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
  parkir.add(buatPagar("Pagar Barat Utara", 9.8, -15, 9.8, -29.5));
  parkir.add(buatPagar("Pagar Barat Selatan", 9.8, -33.5, 9.8, -49));
  parkir.add(buatPagar("Pagar Timur", 22.2, -15, 22.2, -49));
  parkir.add(buatPagar("Pagar Utara", 9.8, -15, 22.2, -15));

  const rng = makeRng(2026);
  const baris = [[11.2, -1], [13.3, 1], [18.7, -1], [20.8, 1]];   // [x, arah hadap]
  let nomor = 0;
  for (const [x, arah] of baris) {
    for (let z = -16.3; z > -48.5; z -= 0.95) {
      if (rng() < 0.22) continue;                                    // slot kosong
      if (x < 12 && z < -29.3 && z > -33.7) continue;                 // jalan masuk
      const yaw = arah * 90 * DEG + (rng() - 0.5) * 0.25;
      const pilihan = [0, 0, 0, 0, 0, 0, 1, 2, 3, 4];                // kebanyakan motor hitam, seperti aslinya
      const m = buatMotor(`Motor Parkir ${++nomor}`, warnaMotor[pilihan[Math.floor(rng() * pilihan.length)]], {
        local: trs(x + (rng() - 0.5) * 0.3, 0.012, z, 0, yaw, 0), group: "Motor Parkir",
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
  root.add(mm.motor);
  // Pengendara duduk di jok, anak dari Rangka Motor -> ikut miring saat menikung
  const pengendara = mm.rangkaM.add(grp("Pengendara", trs(0, 0.86, -0.3)));
  const badanP = pengendara.add(part("Badan", MS.box, MT.bajuBiru, trs(0, 0, 0, 0.22), shapeM(0.36, 0.55, 0.22, 0, 0.28, 0)));
  badanP.add(part("Helm", MS.sph, MT.helm, trs(0, 0.7, 0.02), M4.scaling(0.29, 0.29, 0.29)));
  for (const sx of [-1, 1]) {
    badanP.add(part("Lengan", MS.box, MT.bajuBiru, trs(sx * 0.21, 0.5, 0, -1.3, 0, sx * 0.08), shapeM(0.09, 0.68, 0.09, 0, -0.34, 0), { group: "Lengan" }));
    const paha = pengendara.add(part("Paha", MS.box, MT.celana, trs(sx * 0.1, 0, 0, -1.4), shapeM(0.14, 0.42, 0.14, 0, -0.21, 0), { group: "Kaki" }));
    paha.add(part("Betis", MS.box, MT.celana, trs(0, -0.42, 0, 1.4), shapeM(0.11, 0.4, 0.11, 0, -0.2, 0)));
  }
  let jarakMotor = 0, yawSebelum = 0;
  mm.motor.update = (t, dt) => {
    const v = 6.0;                                    // ~21 km/jam
    jarakMotor += v * dt;
    const p = posisiJalur(jarakMotor), q = posisiJalur(jarakMotor + 0.6);
    const yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
    let dyaw = yaw - yawSebelum; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    yawSebelum = yaw;
    const belok = dt > 0 ? dyaw / (v * dt) : 0;       // kelengkungan lintasan (1/m)
    mm.motor.local = trs(p[0], 0.02, p[1], 0, yaw, 0);
    mm.rangkaM.local = M4.rotationZ(-belok * 3.2);     // miring ke dalam tikungan
    mm.kemudi.local = trs(0, 0, 0.5, 0, belok * 1.4, 0);
    const putar = jarakMotor / 0.255;                  // sudut roda = jarak / jari-jari
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
    const zA = -3, zB = -63, panjang = zA - zB;
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
  //  7. GEDUNG-GEDUNG
  // ==================================================================
  const gedungGrp = root.add(grp("Gedung"));
  function buatGedung(nama, cx, cz, w, d, lantaiN, o = {}) {
    const h = lantaiN * 3.6;
    const g = gedungGrp.add(grp(nama, trs(cx, 0, cz), { group: o.group }));
    g.add(part("Badan Gedung", mesh(`gedung_${w}_${d}_${h}`, () => Geo.box(w, h, d, 4, 3.6)), o.mat || MT.fasad,
      trs(0, h / 2, 0), null, { info: "tekstur fasad jendela" }));
    for (let f = 1; f < lantaiN; f++)
      g.add(part(`Pelat Lantai ${f + 1}`, MS.box, MT.pelat, trs(0, f * 3.6 - 0.1, 0), M4.scaling(w + 1.2, 0.2, d + 1.2), { group: "Pelat Lantai" }));
    if (o.lengkung) {
      g.add(part("Atap Lengkung", mesh("lengkung", () => Geo.cylinder(28, Math.PI, true)), MT.logam,
        trs(0, h, 0), shapeM(w + 1.5, d + 1.5, 7, 0, 0, 0, -90 * DEG)));
    } else {
      g.add(part("Atap Dak", MS.box, MT.pelat, trs(0, h + 0.17, 0), M4.scaling(w + 1.6, 0.35, d + 1.6)));
    }
    if (o.pintuX) g.add(part("Pintu Samping", MS.box, MT.pintu, trs(o.pintuX * (w / 2 + 0.03), 0.6 + 1.5, o.zPintu || 0), M4.scaling(0.08, 3.0, 3.4)));
    if (o.pintu) g.add(part("Pintu Masuk", MS.box, MT.pintu, trs(0, 0.4 + 1.5, o.pintu * (d / 2 + 0.03)), M4.scaling(3.6, 3.0, 0.08)));
    return g;
  }
  buatGedung("Gedung Awal", 0, 10, 30, 18, 2, { pintu: -1 });
  buatGedung("Gedung Ujung", 0, -77, 40, 20, 3, { pintu: 1, mat: MT.fasad2 });
  buatGedung("Gedung Samping Parkir", 40, -32, 14, 50, 3);
  buatGedung("Gedung Aula", -46, -40, 26, 20, 2, { lengkung: true, mat: MT.fasad2, pintuX: 1, zPintu: 7 });
  buatGedung("Gedung Jauh 1", 25, -125, 54, 16, 4, { group: "Gedung Jauh" });
  buatGedung("Gedung Jauh 2", -75, -100, 30, 22, 3, { group: "Gedung Jauh", mat: MT.fasad2 });

  // ==================================================================
  //  8. LAMPU TAMAN (bola putih di atas tiang) — point light malam hari
  // ==================================================================
  const lampuGrp = root.add(grp("Lampu Taman"));
  [[-6.5, -6], [-6.5, -18], [-6.5, -30], [-6.5, -42], [-6.5, -54], [-12.2, -38.8], [-22, -38.8], [-31, -38.8]].forEach(([x, z], i) => {
    const l = lampuGrp.add(grp(`Lampu Taman ${i + 1}`, trs(x, 0, z), { group: "Lampu Taman" }));
    const alas = l.add(part("Alas Beton", MS.box, MT.beton, trs(0, 0.1, 0), M4.scaling(0.28, 0.2, 0.28)));
    const tiang = alas.add(part("Tiang", MS.cyl8, MT.tiang, trs(0, 1.45, 0), M4.scaling(0.07, 2.7, 0.07)));
    tiang.add(part("Bola Lampu", MS.sph, MT.bolaLampu, trs(0, 1.52, 0), M4.scaling(0.36, 0.36, 0.36),
      { light: { color: [1.0, 0.82, 0.55], power: 4.0, offset: [0, 0, 0] }, castShadow: false, info: "point light (malam)" }));
  });

  // ==================================================================
  //  9. POHON (batang -> cabang -> tajuk), bergoyang tertiup angin
  // ==================================================================
  const pohonGrp = root.add(grp("Pepohonan"));
  const larangan = [[-34, -1, -44, -28], [-9, 9, -72, 6], [3, 30, -62, -2], [-16, 16, -88, 20], [32, 48, -58, -6], [-62, -30, -54, -26],
    [-4, 54, -134, -116], [-92, -58, -112, -88]];
  const rngP = makeRng(7);
  let jumlahPohon = 0;
  while (jumlahPohon < 22) {
    const x = -95 + rngP() * 160, z = -140 + rngP() * 175;
    if (larangan.some(([x1, x2, z1, z2]) => x > x1 - 4 && x < x2 + 4 && z > z1 - 4 && z < z2 + 4)) continue;
    const s = 0.8 + rngP() * 0.5, fase = rngP() * 6;
    const pohon = pohonGrp.add(grp(`Pohon ${++jumlahPohon}`, trs(x, 0, z, 0, rngP() * 6, 0), { group: "Pohon" }));
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
  }

  return {
    root, materials: [...Object.values(MT), ...warnaMotor, mm.lampu.mat],
    selasar: { L, LANTAI_Y, N_SEG, S },
    motorMelaju: mm, posisiJalur,
  };
}
