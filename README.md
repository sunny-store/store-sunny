# Sunny Store — versi Cloudflare (gratis)

Isi: website toko + admin + Rekap (penjualan, langganan, pengeluaran & laba, budgeting) + pengingat harian + musik latar + logo aplikasi.
Berjalan di **Cloudflare Workers** (website + API dalam satu project) dengan database **D1**. Tidak ada kredit per-deploy seperti Netlify; file website (HTML/gambar) gratis dan tidak terbatas.

## Kenapa Cloudflare, bukan Vercel
Paket gratis Vercel (Hobby) hanya untuk pemakaian pribadi non-komersial, sedangkan toko ini berjualan. Cloudflare gratis boleh untuk usaha, dan jadwal pengingat harian ada di project yang sama.

---
## 0. LAKUKAN DULU, selagi website Netlify lama masih menyala
1. Buka `https://kedaisunny.netlify.app/api/config` di browser, tekan **Ctrl+S**, simpan sebagai **config.json**. File ini berisi produk, harga, logo, QRIS, musik, dan pengaturan tokomu.
2. Siapkan 3 file CSV dari Rekap lama (Penjualan, Langganan, Pengeluaran). Kalau ada data baru sejak terakhir ekspor, ekspor ulang.
3. Catat password admin lama.

## 1. Repository GitHub baru
Buat repo baru (mis. `sunny-store-cloudflare`, boleh Private). Upload **isi folder zip ini** dengan menyeret folder `public` dan `src` serta file `wrangler.jsonc`, `package.json`, `.gitignore`, `README.md`. Struktur harus seperti ini (jangan ada folder pembungkus):
```
public/index.html  public/impor.html
src/worker.mjs  src/db.mjs  src/env.mjs  src/api/*.mjs  src/lib/*.mjs
wrangler.jsonc  package.json
```

## 2. Akun Cloudflare
Daftar gratis di https://dash.cloudflare.com (cukup email, tanpa kartu).

## 3. Buat database D1
1. Dashboard → **Storage & databases** → **D1 SQL database** → **Create database**. Nama: `sunny-db`.
2. Salin **Database ID** (deretan huruf-angka panjang).
3. Di GitHub buka `wrangler.jsonc` → ikon pensil → ganti `ISI_DENGAN_DATABASE_ID_D1_KAMU` dengan ID tadi → **Commit changes**.
Tabel dibuat otomatis saat pertama kali dipakai.

## 4. Hubungkan GitHub ke Cloudflare
1. Dashboard → **Workers & Pages** → **Create application** → **Import a repository** (Workers Builds) → pilih repo tadi.
2. Nama project harus **`kedaisunny`** (sama dengan `name` di `wrangler.jsonc`; kalau mau nama lain, ubah keduanya).
3. Build command: kosongkan. Deploy command: `npx wrangler deploy` (bawaan). Tekan **Save and Deploy**.
4. Setelah berhasil, alamat websitemu tampil di halaman project, bentuknya `https://kedaisunny.<nama-akunmu>.workers.dev`.
Jika build gagal, buka log build: kesalahan paling umum adalah Database ID belum diganti atau nama project berbeda.

## 5. Isi Secrets (kunci rahasia)
Worker `kedaisunny` → **Settings** → **Variables and Secrets** → **Add**, pilih tipe **Secret** (bukan Text, supaya tidak hilang saat deploy ulang):
| Nama | Isi |
|---|---|
| `ADMIN_PASSWORD` | password admin (panjang & sulit ditebak) |
| `TOKEN_SECRET` | teks acak minimal 40 karakter (wajib; juga dipakai mengenkripsi data akun) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | opsional, untuk notifikasi pengingat harian |
| `HASH_ITER` | opsional, lihat "Batas paket gratis" |
Simpan lalu tunggu deploy selesai.

## 6. Cek server
Buka `https://kedaisunny.<akunmu>.workers.dev/api/finance?kind=sub`. Jika muncul `{"error":"Tidak diizinkan, login admin dulu"}`, server sudah hidup. Jika muncul pesan tentang D1, ulangi langkah 3.

## 7. Impor data lama
1. Buka `…workers.dev/impor.html`, masukkan password admin.
2. Pilih `config.json` dan 3 file CSV, tekan **Impor sekarang**.
3. Hasil tampil per jenis (ditambahkan / sudah ada / tidak valid). Aman diulang: data yang sudah masuk tidak dobel.
Angka acuan dari CSV yang kamu unggah ke saya: 33 pesanan (omzet Rp1.036.000), 19 langganan, 37 pengeluaran (Rp664.000), jadi laba Rp372.000.

## 8. Cek hasil
Buka halaman utama → login admin (alamat `/admin`) → ✎ Edit → **Buka Rekap Bulanan**. Cocokkan angkanya. Setelah yakin, hapus `public/impor.html` dari repo.

## 9. Pindahan akhir
- Alamat baru berbeda dengan `kedaisunny.netlify.app`: perbarui link di bio/WhatsApp. Punya domain sendiri? Worker → **Settings → Domains & Routes → Add**.
- **Jangan hapus project Netlify** sampai yakin semuanya pindah (data akun pelanggan & ulasan hanya ada di sana).

---
## Yang TIDAK ikut pindah
- **Akun pelanggan** (username/password) dan **ulasan**: tidak ada fitur ekspornya di versi lama, jadi pelanggan perlu daftar ulang dan ulasan perlu dikumpulkan lagi. Kaitan "pesanan saya" per akun juga hilang (data pesanan tetap ada di Rekap).
- **Riwayat perpanjangan** langganan: CSV hanya memuat jumlahnya. Tanggal berakhir saat ini tetap benar; jumlah perpanjangan lama dicatat di kolom catatan.
- Anggaran (Budgeting) bulan lama: tidak ada di CSV, isi ulang.

## Batas paket gratis Cloudflare (per 2026, cek dokumentasi untuk perubahan)
- 100.000 permintaan API per hari; file website tidak dihitung.
- **10 ms CPU per permintaan.** Hash password pelanggan memakai PBKDF2 dengan 10.000 putaran supaya muat. Ini lebih ringan dari standar ideal. Jika memakai Workers Paid ($5/bulan) set `HASH_ITER=210000`. Jika daftar/masuk pelanggan memunculkan error 1102, turunkan `HASH_ITER` (mis. 5000). Password admin tidak di-hash (dibandingkan langsung dengan Secret).
- D1: 100.000 baris tulis dan 5 juta baris baca per hari, 5 GB. Lebih dari cukup untuk toko kecil.
- Login admin hanya satu password bersama (sama seperti versi lama).

## Pengingat harian
Cron `0 1 * * *` UTC = 08.00 WIB (di `wrangler.jsonc`). Menyusun daftar langganan H-7, H-3, H-1, hari H, +1, +7, lalu mengirimkannya ke Telegram-mu jika `TELEGRAM_*` terisi. Pesan ke buyer tetap kamu kirim sendiri lewat WhatsApp. Tes manual: Rekap → Langganan → **Jalankan & kirim sekarang**.
Telegram: chat @BotFather → `/newbot` → salin token; kirim satu pesan ke botmu lalu buka `https://api.telegram.org/bot<TOKEN>/getUpdates` untuk melihat `chat.id`.

## Backup
Ekspor CSV dari tiap tab Rekap secara rutin. D1 juga punya fitur pemulihan ke titik waktu (Time Travel) di dashboard.

## Mengubah isi website
Tampilan, produk, logo, musik, dan QRIS diubah lewat Edit di halaman admin (langsung live, tanpa deploy). Hanya perubahan kode (`public/index.html`, `src/…`) yang perlu commit ke GitHub dan memicu deploy otomatis.
