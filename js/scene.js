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
  const xTengahParkir = (X_SELASAR + X_SELATAN) / 2;
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
  // Pagar: sisi selasar, sisi gedung, sisi selatan, dan sisi barat (ada jalan masuk di tengah, menghadap jalan)
  const MASUK = [xTengahParkir - 1.6, xTengahParkir + 1.6];
  parkir.add(buatPagar("Pagar Selasar", X_SELASAR, zGedung(X_SELASAR), X_SELASAR, Z_BARAT));
  parkir.add(buatPagar("Pagar Gedung", X_SELASAR, zGedung(X_SELASAR), X_SELATAN, zGedung(X_SELATAN)));
  parkir.add(buatPagar("Pagar Selatan", X_SELATAN, zGedung(X_SELATAN), X_SELATAN, Z_BARAT));
  parkir.add(buatPagar("Pagar Barat 1", X_SELASAR, Z_BARAT, MASUK[0], Z_BARAT));
  parkir.add(buatPagar("Pagar Barat 2", MASUK[1], Z_BARAT, X_SELATAN, Z_BARAT));

  // 4 baris motor sejajar selasar; motor menghadap pagar / lorong tengah (lorong lurus dengan jalan masuk)
  const rng = makeRng(2026);
  const baris = [[1.4, -1], [3.5, 1], [9.5, -1], [11.6, 1]].map(([dx, a]) => [X_SELASAR + dx, a]);   // [x, arah hadap]
  let nomor = 0;
  for (const [x, arah] of baris) {
    for (let z = Z_BARAT - 0.7; z > zGedung(x) + 0.7; z -= 0.95) {
      if (rng() < 0.2) continue;                                     // slot kosong
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
