# Financial Expenses Tracker

Web app ringkas untuk track perbelanjaan kewangan harian — versi web dari
konsep `my_spending` (Flutter), dibina dengan **HTML + CSS + JavaScript
vanilla** (tiada build step, tiada npm install).

**Versi:** v1.2 (Hybrid local + cloud sync)

## Cara jalan
- **Cara paling senang:** double-click `index.html` — terus buka kat browser.
- **Kat HP:** host folder ni (GitHub Pages / Netlify) → buka URL kat browser
  phone. App jalan **offline** (data simpan kat localStorage phone).
- **Cara dev (auto-reload):** buka folder ni dalam VS Code, install extension
  **Live Server**, klik kanan `index.html` → "Open with Live Server".

## Model data (v1.2 — Hybrid)
- **localStorage = SUMBER KEBENARAN.** Semua add/padam tulis ke localStorage
  DULU → selamat walaupun offline. Data tak hilang bila tutup browser.
- **Supabase = lapisan sync (best-effort).** Bila online, rekod dipush/pull ke
  cloud (jadual `Expenses`). Kalau cloud gagal/offline, app **tetap jalan**
  guna data lokal. Auth (S3) belum dibuat — tangguh.

## Features
- Tambah perbelanjaan: jumlah (RM), kategori, tarikh, nota.
- Dashboard: total belanja bulan semasa (hero card), bilangan transaksi,
  purata, dan jumlah keseluruhan.
- Pecahan perbelanjaan mengikut kategori (bar visual) + **doughnut chart**.
- Senarai transaksi dengan navigasi bulan (‹ ›) + butang "Semua".
- Padam transaksi.
- **Export CSV** (buka kat Excel) + **Export/Import sandaran JSON** (gabung ID).
- **Bajet bulanan + amaran** bar 3-warna (hijau/amber/merah).
- **Dark / light mode** toggle.
- **Multi-profile** (asing data per nama).
- Foto resit: dilampirkan sebagai **nota** (tiada OCR palsu).

## Struktur fail
- `index.html` — struktur & UI (termasuk Supabase SDK + config)
- `styles.css` — tema emerald/slate
- `app.js` — logik hybrid (localStorage + Supabase sync), render

## Setup Supabase (bila nak sync)
1. Buat project Supabase, jadual `Expenses`:
   `id` text PK, `Title` text, `Amount` numeric, `Category` text,
   `Date` date, `note` text, `created_at` timestamptz default now().
2. Isi `SUPABASE_URL` + `SUPABASE_ANON_KEY` di `index.html`.
3. **PENTING:** pasang **Row Level Security (RLS)** sebelum share — else data
   terbuka. (Auth pengguna masih belum disambung — v1.3.)

## Next ideas (bila ready)
- ~~CSV export~~ — **DONE** (v1.2)
- ~~Export/import JSON~~ — **DONE**
- ~~Bajet bulanan + amaran~~ — **DONE**
- ~~Dark/light mode~~ — **DONE**
- Edit transaksi sedia ada
- Chart bulanan (bar/line)
- **S3: Authentication + RLS betul** (supaya sync selamat)
- Hosting + PWA (buka macam app kat phone)
