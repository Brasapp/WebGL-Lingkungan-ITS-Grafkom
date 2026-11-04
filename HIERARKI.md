# Hierarki Objek (Scene Graph) — Selasar ITS

Dokumen ini menjelaskan susunan hierarki objek pada scene WebGL Tugas 2.
Semua kode hierarki ada di `js/scene.js`, sedangkan perhitungan matriks dunia ada di `js/main.js` (`updateDunia`).

## 1. Konsep dasar

Setiap objek adalah sebuah **Node** (`class Node` di `scene.js`). Node memiliki:

| Field      | Arti |
|------------|------|
| `local`    | Transformasi relatif terhadap induk (translasi, rotasi). **Diwariskan** ke semua anak. |
| `shape`    | Transformasi khusus bentuk mesh (biasanya skala). **Tidak diwariskan**. |
| `world`    | Posisi akhir di dunia: `world = world_induk × local`. Dihitung ulang setiap frame. |
| `mesh`     | Geometri (kotak, silinder, bola, torus, spandek). Node tanpa mesh = node grup. |
| `mat`      | Material (warna, tekstur, specular, pijar). |
| `update`   | Fungsi animasi opsional yang mengubah `local` setiap frame. |
| `light`    | Opsional: node ini juga menjadi point light. |
| `children` | Daftar anak. |

Matriks yang dikirim ke shader:

```
model = world × shape
```

`shape` dipisah agar skala sebuah bagian tidak ikut meregangkan anaknya.
Contoh: `Kolom` diskalakan menjadi batang tipis setinggi 2,6 m, tetapi `Pelat Dasar` (anaknya) tetap berukuran normal.

Penelusuran pohon (rekursif, di `main.js`):

```js
function telusur(node, worldInduk) {
  if (node.update) node.update(waktu, dt);       // animasi mengubah node.local
  node.world = worldInduk × node.local;
  if (node.mesh) node.model = node.world × node.shape;
  for (const anak of node.children) telusur(anak, node.world);
}
telusur(root, I);
```

Fungsi pembantu matriks (di `matriks.js`):
- `trs(tx,ty,tz, rx,ry,rz)` = T · Ry · Rx · Rz untuk `local`
- `shapeM(sx,sy,sz, tx,ty,tz, rx,ry,rz)` = T · R · S untuk `shape`

## 2. Pohon hierarki lengkap

Keterangan: `×N` = node berulang, ⟳ = beranimasi, ☀ = sumber cahaya, ▦ = bertekstur.

```
Dunia (Scene)                                   akar scene graph
├── Lingkungan
│   ├── Rumput ▦
│   ├── Tanah Selatan ▦ / Tanah Timur ▦         tanah kering (cokelat pada citra)
│   └── Jalur Paving ▦                          jalan setapak menuju parkir
│
├── Selasar                                     koridor beratap utama (54 m, lantai 56 m)
│   ├── Lantai
│   │   ├── Pelat Beton ▦
│   │   ├── Keramik ▦                           keramik diagonal, memantulkan langit
│   │   ├── List Tepi Kiri ▦
│   │   └── List Tepi Kanan ▦
│   ├── Segmen ×19                              satu bentang setiap 3 m
│   │   ├── Kolom Kiri / Kolom Kanan
│   │   │   └── Pelat Dasar
│   │   ├── Kuda-kuda
│   │   │   └── Batang Miring ×2 (kiri, kanan)
│   │   ├── Balok Ikat
│   │   ├── Kasau ×3                            setiap 0,75 m
│   │   │   └── Batang Miring ×2
│   │   └── Lampu Neon ☀                        hanya di segmen genap (9 buah)
│   ├── Rangka Memanjang
│   │   ├── Balok Tepi Kiri / Balok Tepi Kanan
│   │   ├── Balok Bubungan
│   │   └── Gording ×2
│   └── Atap
│       ├── Atap Kiri / Atap Kanan              miring 10°
│       │   ├── Spandek Bawah ▦                 geometri gelombang sinus
│       │   └── Spandek Atas ▦
│       └── Nok (tutup bubungan) ▦
│
├── Area Parkir                                 menempel di sudut selasar & Gedung ITS ROBOCON
│   ├── Lahan Parkir ▦                          segi empat, satu sisi miring mengikuti fasad
│   ├── Jalan Paving Motor ▦                    berbentuk L (tidak melingkar), dari selasar ke gedung
│   ├── Pagar ×5 (Selasar, Gedung, Selatan, Barat 1, Barat 2)
│   │   ├── Tiang Pagar ×N
│   │   ├── Pipa Atas
│   │   └── Pipa Tengah
│   └── Motor Parkir ×±60                       struktur sama dengan Motor (lihat bawah)
│
├── Motor Melaju ⟳ (anak Area Parkir)            bolak-balik di jalan, putar balik di ujung
│   └── Rangka Motor ⟳                          miring saat menikung
│       ├── Roda Belakang ⟳                     berputar
│       │   ├── Ban (torus)
│       │   └── Velg
│       ├── Bodi Belakang
│       ├── Jok
│       ├── Lampu Rem                         berpijar saat malam
│       ├── Dek Kaki
│       ├── Tameng Depan
│       ├── Kemudi ⟳                            berbelok mengikuti tikungan
│       │   ├── Garpu Depan
│       │   ├── Batok Lampu
│       │   ├── Setang
│       │   ├── Lampu Depan ☀                   spotlight
│       │   ├── Spion ×2
│       │   └── Roda Depan ⟳
│       │       ├── Ban
│       │       └── Velg
│       └── Pengendara
│           ├── Badan
│           │   ├── Helm
│           │   └── Lengan ×2
│           └── Paha ×2
│               └── Betis
│
├── Pejalan Kaki
│   └── Pejalan ×2 ⟳                            berjalan bolak-balik di selasar
│       └── Pinggul ⟳                           naik-turun saat melangkah
│           ├── Badan
│           │   ├── Kepala
│           │   │   └── Rambut
│           │   └── Lengan Atas ×2 ⟳            berayun
│           │       └── Lengan Bawah ⟳
│           └── Paha ×2 ⟳                       berayun
│               └── Betis ⟳                     menekuk
│                   └── Sepatu
│
├── Gedung                                      posisi & arah dari citra satelit
│   ├── Gedung Barat, Gedung IRIS Robotics, Gedung Bayucaraka, Gedung ITS ROBOCON,
│   │   Bangunan Samping IRIS, Penghubung IRIS–ROBOCON, Bangunan Belakang ROBOCON,
│   │   Gedung Utara, Gudang Kecil, Gedung Jauh ×2
│   │   ├── Badan Gedung ▦                      tekstur fasad berjendela
│   │   ├── Pelat Lantai ×(lantai − 1)          hanya Gedung Jauh
│   │   ├── Atap Pelana                         atau Atap Dak (datar)
│   │   │   ├── Pengisi Pelana                  prisma segitiga
│   │   │   ├── Atap Utara / Atap Selatan       miring 6°
│   │   │   │   └── Spandek ▦
│   │   │   └── Nok
│   │   ├── Pintu Selasar                       Gedung Barat & ROBOCON (ujung selasar)
│   │   └── Teras Lantai 1                      IRIS & ROBOCON, menghadap selasar
│   │       └── Bagian ×1–2                     dipotong di tempat selasar menempel
│   │           ├── Lantai Teras ▦              ditinggikan 45 cm
│   │           ├── Keramik Teras ▦
│   │           ├── Atap Teras ▦                kanopi beton setinggi 3,6 m
│   │           ├── Pipa Atas, Pipa Tengah, Pagar Samping ×2
│   │           ├── Jeruji ×N
│   │           └── Kolom Teras ×N              setiap ±4 m
│
├── Lampu Taman                                 di rumput antara selasar & Gedung IRIS
│   └── Lampu Taman ×5
│       └── Alas Beton ▦
│           └── Tiang
│               └── Bola Lampu ☀                point light malam
│
└── Pepohonan
    └── Pohon ×30                               16 dari rumpun pohon citra, 14 acak di luar citra
        └── Batang ⟳ ▦                          bergoyang tertiup angin
            ├── Cabang ×3 ▦
            │   └── Tajuk ▦
            └── Tajuk Atas ▦
```

## 3. Mengapa dibuat hierarkis — contoh pewarisan transformasi

### a. Motor Melaju (animasi hierarkis bertingkat)

Setiap frame, `Motor Melaju.update` mengubah `local` beberapa node:

| Node | Transformasi `local` | Efek pada anak |
|------|----------------------|----------------|
| `Motor Melaju` | `trs(x, 0, z, 0, yaw, 0)`: posisi & arah di lintasan | Seluruh motor + pengendara ikut berpindah |
| `Rangka Motor` | `rotationZ(−kelengkungan × 3,2)` | Bodi, roda, kemudi **dan pengendara** ikut miring ke dalam tikungan |
| `Kemudi` | `trs(0,0,0.5, 0, kelengkungan × 1,4, 0)` | Setang, lampu depan, spion **dan roda depan** ikut berbelok, roda belakang tidak |
| `Roda Depan` / `Roda Belakang` | `rotationX(jarak / jari-jari)` | Ban & velg berputar sesuai jarak tempuh |

Karena `Roda Depan` adalah anak dari `Kemudi`, yang merupakan anak dari `Rangka Motor`, matriks dunia roda depan menjadi:

```
world(Roda Depan) = M(Motor) × M(Rangka) × M(Kemudi) × M(Roda Depan)
                    pindah    miring      belok        berputar
```

Roda depan otomatis berpindah, miring, berbelok, dan berputar tanpa perlu menghitung semuanya secara manual.
Arah sorot lampu depan (spotlight) juga diambil dari `world` node `Lampu Depan`, sehingga cahayanya ikut berbelok.

### b. Pejalan Kaki (rantai sendi)

```
Pejalan → Pinggul → Paha → Betis → Sepatu
                  → Badan → Lengan Atas → Lengan Bawah
```

- `Paha` berayun dengan `rotX = 0,45 · sin(fase)`.
- `Betis` menekuk relatif terhadap paha dengan `rotX = 0,75 · max(0, −cos(fase))`.
- Sepatu ikut otomatis karena merupakan anak `Betis`.
- Titik putar setiap sendi berada di pangkalnya, karena `shape` menggeser mesh ke bawah (`shapeM(..., 0, −panjang/2, 0)`).

### c. Pohon

Hanya `Batang` yang dianimasikan dengan rotasi kecil X/Z. Semua `Cabang` dan `Tajuk` ikut bergoyang karena merupakan anaknya.

### d. Objek berulang (instancing lewat hierarki)

- `Segmen ×19` hanya dibuat dalam satu loop dengan `local = trs(0, 0, −i × 3)`.
  Isi segmen (kolom, kuda-kuda, kasau, lampu) didefinisikan sekali dalam koordinat lokal segmen.
- `Area Parkir` mengisi sudut antara sisi selatan selasar dan teras Gedung ITS ROBOCON: pagar utara menempel ke selasar, pagar timur menempel ke teras gedung (mengikuti fasad yang sedikit miring). Jalan berbentuk L di sisi barat dan selatan, tidak melingkar, sehingga `Motor Melaju` berjalan bolak-balik dan memutar balik 180° di setiap ujung jalan.
- `Teras Lantai 1` dibuat dengan `buatBalkon()`: grup teras diputar sehingga sumbu x-nya sepanjang dinding, lalu lantai, pagar, kolom, dan kanopi diletakkan dalam koordinat lokal itu.
- Setiap `Gedung` diputar dengan `trs(cx, 0, cz, 0, yaw, 0)`. Atap, pintu, dan pengisi pelana didefinisikan dalam koordinat lokal gedung, sehingga ikut berputar mengikuti arah gedung pada citra.
- `Motor Parkir ×±60` memakai fungsi `buatMotor()` yang sama dengan `Motor Melaju`. Bedanya:
  - `Rangka Motor` dimiringkan tetap (−0,08 rad) karena motor parkir bertumpu pada standar samping.
  - `Kemudi` dibelokkan acak.

## 4. Tata letak dari citra satelit

Posisi objek diambil dari `footage/Screenshot from 2026-11-05 03-17-41.png` (714 × 630 piksel).
Bentuk 3D selasar mengikuti video di `footage/WhatsApp Unknown 2026-11-05 at 03.18.08/`.

- Persegi panjang tipis pada citra = **Selasar**. Bangunan lain = **Gedung**.
- Sumbu dunia disejajarkan dengan selasar: −z = arah selasar (barat → timur, menuju Gedung ITS ROBOCON), +x = selatan (area parkir), −x = utara (Gedung IRIS).
- Skala 0,1469 m/piksel, dipilih agar lantai selasar (56 m) tepat dari dinding Gedung Barat ke dinding Gedung ITS ROBOCON.
- `peta(u, v)` di `scene.js` mengubah piksel citra → `[x, z]` dunia; `piksel(x, z)` kebalikannya.
- `gedungPiksel(nama, [kiriAtas, kananAtas, kiriBawah], ...)` membuat gedung dari tiga sudut atapnya pada citra: lebar, kedalaman, posisi pusat, dan sudut putarnya dihitung otomatis.

| Gedung | Sudut atap pada citra (piksel) |
|--------|--------------------------------|
| Gedung Barat (ujung barat selasar) | (−50,383) (46,383) (−50,560) |
| Gedung IRIS Robotics | (18,204) (429,160) (36,375) |
| Gedung Bayucaraka | (464,150) (639,136) (486,336) |
| Gedung ITS ROBOCON (ujung timur selasar) | (404,357) (554,343) (443,536) |
| Gedung Utara | (32,72) (256,60) (40,158) |

## 5. Optimasi tanpa merusak hierarki

Node yang tidak memiliki `update` (dan tidak berada di bawah node beranimasi) disebut **statis**.
Saat program dimulai, mesh statis digabung per material menjadi beberapa buffer besar (`gabungStatis()` di `main.js`).
Hasilnya, ±1.670 part digambar dengan ±320 draw call (angka tampil di pojok kanan bawah layar).

Node dinamis (motor melaju, pejalan, pohon) tetap digambar satu per satu dengan matriks dunianya masing-masing setiap frame.

## 6. Ringkasan file

| File | Isi |
|------|-----|
| `js/matriks.js` | Pustaka matriks 4×4: translasi, rotasi, skala, `lookAt`, perspektif, invers, `trs`, `shapeM` |
| `js/geometri.js` | Pembuat mesh: kotak, silinder, bola, torus, prisma, spandek bergelombang, pita jalan |
| `js/tekstur.js` | 10 tekstur prosedural (Canvas 2D) |
| `js/shader.js` | Shader GLSL: Blinn-Phong, point light, spotlight, shadow map, kabut, langit |
| `js/scene.js` | **Hierarki objek (scene graph) & fungsi animasi** |
| `js/main.js` | Penelusuran pohon, render loop, shadow pass, siklus siang–malam, kamera, panel kontrol |
