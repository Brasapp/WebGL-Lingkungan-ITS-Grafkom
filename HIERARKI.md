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
│   ├── Jalur Paving ▦
│   ├── Lahan Parkir ▦
│   └── Jalan Paving Motor ▦                    lintasan berbentuk stadion
│
├── Selasar                                     koridor beratap utama (66 m)
│   ├── Lantai
│   │   ├── Pelat Beton ▦
│   │   ├── Keramik ▦                           keramik diagonal, memantulkan langit
│   │   ├── List Tepi Kiri ▦
│   │   └── List Tepi Kanan ▦
│   ├── Segmen ×23                              satu bentang setiap 3 m
│   │   ├── Kolom Kiri / Kolom Kanan
│   │   │   └── Pelat Dasar
│   │   ├── Kuda-kuda
│   │   │   └── Batang Miring ×2 (kiri, kanan)
│   │   ├── Balok Ikat
│   │   ├── Kasau ×3                            setiap 0,75 m
│   │   │   └── Batang Miring ×2
│   │   └── Lampu Neon ☀                        hanya di segmen genap (11 buah)
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
├── Selasar Kantilever                          cabang ke Gedung Aula, diputar 90°
│   ├── Lantai
│   │   ├── Dinding Beton ▦
│   │   ├── Keramik ▦
│   │   └── List Tepi ×2 ▦
│   ├── Sambungan ▦                             penghubung ke selasar utama
│   │   └── Keramik Sambungan ▦
│   ├── Portal ×9
│   │   ├── Tiang Tinggi
│   │   │   └── Balok Atas (kantilever)
│   │   ├── Tiang Pendek
│   │   ├── Balok Atap
│   │   └── Kabel Baja ×1–2
│   └── Rangka Memanjang
│       ├── Balok Tepi ×2
│       └── Atap Miring ▦                       atap miring satu arah
│
├── Area Parkir
│   ├── Pagar ×4 (Barat Utara, Barat Selatan, Timur, Utara)
│   │   ├── Tiang Pagar ×N
│   │   ├── Pipa Atas
│   │   └── Pipa Tengah
│   └── Motor Parkir ×±110                      struktur sama dengan Motor (lihat bawah)
│
├── Motor Melaju ⟳                              bergerak di lintasan
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
├── Gedung
│   ├── Gedung Awal, Gedung Ujung, Gedung Samping Parkir, Gedung Aula, Gedung Jauh ×2
│   │   ├── Badan Gedung ▦                      tekstur fasad berjendela
│   │   ├── Pelat Lantai ×(jumlah lantai − 1)
│   │   ├── Atap Dak  atau  Atap Lengkung ▦     (Gedung Aula: lengkung)
│   │   └── Pintu Masuk / Pintu Samping
│
├── Lampu Taman
│   └── Lampu Taman ×8
│       └── Alas Beton ▦
│           └── Tiang
│               └── Bola Lampu ☀                point light malam
│
└── Pepohonan
    └── Pohon ×22
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

- `Segmen ×23` hanya dibuat dalam satu loop dengan `local = trs(0, 0, −i × 3)`.
  Isi segmen (kolom, kuda-kuda, kasau, lampu) didefinisikan sekali dalam koordinat lokal segmen.
- `Selasar Kantilever` dibangun memanjang ke arah −z lokal, lalu **seluruh cabang** diputar 90° (`trs(−2.45, 0, −33, 0, π/2, 0)`), sehingga semua anaknya ikut menghadap −x dunia.
- `Motor Parkir ×±110` memakai fungsi `buatMotor()` yang sama dengan `Motor Melaju`. Bedanya:
  - `Rangka Motor` dimiringkan tetap (−0,08 rad) karena motor parkir bertumpu pada standar samping.
  - `Kemudi` dibelokkan acak.

## 4. Optimasi tanpa merusak hierarki

Node yang tidak memiliki `update` (dan tidak berada di bawah node beranimasi) disebut **statis**.
Saat program dimulai, mesh statis digabung per material menjadi beberapa buffer besar (`gabungStatis()` di `main.js`).
Hasilnya, ±2.350 part digambar dengan ±250 draw call (angka tampil di pojok kanan bawah layar).

Node dinamis (motor melaju, pejalan, pohon) tetap digambar satu per satu dengan matriks dunianya masing-masing setiap frame.

## 5. Ringkasan file

| File | Isi |
|------|-----|
| `js/matriks.js` | Pustaka matriks 4×4: translasi, rotasi, skala, `lookAt`, perspektif, invers, `trs`, `shapeM` |
| `js/geometri.js` | Pembuat mesh: kotak, silinder, bola, torus, spandek bergelombang, pita jalan |
| `js/tekstur.js` | 10 tekstur prosedural (Canvas 2D) |
| `js/shader.js` | Shader GLSL: Blinn-Phong, point light, spotlight, shadow map, kabut, langit |
| `js/scene.js` | **Hierarki objek (scene graph) & fungsi animasi** |
| `js/main.js` | Penelusuran pohon, render loop, shadow pass, siklus siang–malam, kamera, panel kontrol |
