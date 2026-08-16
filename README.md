# Financial Expenses Tracker

Web app ringkas untuk track perbelanjaan kewangan harian — versi web dari
konsep `my_spending` (Flutter), dibina dengan **HTML + CSS + JavaScript
vanilla** (tiada build step, tiada npm install).

**Versi semasa:** v1.2 (Hybrid: localStorage + Supabase sync best-effort)

---

## Apa yang telah dibuat (v1.2)

Projek ni dibangunkan secara berperingkat. Di bawah ialah ringkasan kerja
yang telah siap setakat ini:

### Asas (fungsi teras — berfungsi)
- **Tambah perbelanjaan**: jumlah (RM), kategori, tarikh, nota.
- **Dashboard**: Total Belanja Bulan Ini (hero card), bilangan transaksi,
  purata se-transaksi, dan Jumlah Keseluruhan.
- **Pecahan kategori**: bar visual + **doughnut chart** (Chart.js via CDN).
- **Senarai transaksi**: navigasi bulan (‹ ›) + butang "Semua".
- **Padam transaksi**.
- **Bajet bulanan + amaran**: bar progres 3-warna
  (🟢 hijau selamat / 🟡 amber ≥80% / 🔴 merah melebihi bajet + warning).
- **Dark / light mode** toggle (simpan ke `fet_theme`).
- **Multi-profile**: asing data per nama (localStorage key per-profile).

### v1.2 — penambahbaikan & pembersihan
1. **Model data Hybrid (Pilihan 1)**: localStorage = **sumber kebenaran**,
   Supabase = lapisan sync best-effort. App jalan offline; data tak hilang
   bila tutup browser / cloud down.
2. **Export CSV sebenar** (buka kat Excel, dengan BOM utf-8).
3. **Export / Import sandaran JSON** (gabung ikut ID — rekod sedia ada tak hilang).
4. **Migration shim (S5)**: data lama v1.1 (kunci `fet_transactions`)
   auto-dipulihkan ke per-profile, kemudian kunci lama dibuang.
5. **Receipt photo = nota (S2)**: foto resit dilampirkan sebagai nota —
   tiada claim OCR palsu.
6. **Supabase config kekal** (`index.html`): anon key + `createClient()`.
   Sync best-effort; tak halang app jalan bila offline.

---

## Perubahan: v1.1 → v1.2

| Perkara | v1.1 (lama) | v1.2 (sekarang) |
|---|---|---|
| Simpanan data | localStorage (single key `fet_transactions`) | localStorage **per-profile** (`fet_transactions_<nama>`) = sumber kebenaran |
| Cloud sync | Tiada | Supabase best-effort (push/pull jadual `Expenses`) |
| Export | JSON sahaja | **CSV** (Excel) + JSON backup |
| Import | JSON (gabung ID) | JSON (gabung ID) — kekal |
| Receipt | Button "AI auto-scan" (palsu/rambang) | Foto = nota (honest, tiada OCR) |
| Chart | Bar visual | Bar visual + **doughnut chart** |
| Theme | Tiada | **Dark / light mode** toggle |
| Profile | Tiada | **Multi-profile** |
| Bajet | Tiada | **Bajet bulanan + amaran 3-warna** |
| Offline | Jalan (local) | Jalan (local), sync bila online |
| README | Tidak sehaluan dgn code | Diselaraskan (doc ini) |

**Yang dibuang / diganti:**
- Button "Export PDF" & "Export Excel" (mati, tiada handler) → diganti
  **Export CSV**.
- Claim "AI akan baca resit secara automatik" → diganti foto sebagai nota.

---

## Cara jalan

- **Paling senang:** double-click `index.html` → terus buka kat browser.
- **Kat HP:** host folder ni (GitHub Pages / Netlify / Cloudflare Pages) →
  buka URL kat browser phone. App jalan **offline** (data kat localStorage phone).
- **Dev (auto-reload):** buka dalam VS Code, install extension **Live Server**,
  klik kanan `index.html` → "Open with Live Server".

## Bawa data ke device lain (tiada cloud)
1. Kat device asal: klik **Export JSON / CSV**.
2. Hantar file ke device baru.
3. Buka app → **Import** (JSON) → data masuk.
(CSV hanya untuk rujukan Excel, tak boleh di-import balik.)

---

## Struktur fail
- `index.html` — struktur & UI (termasuk Supabase SDK + config block)
- `styles.css` — tema emerald/slate (dark/light)
- `app.js` — logik hybrid (localStorage + Supabase sync), render, export/import
- `README.md` — dokumen ini

## Setup Supabase (bila nak hidupkan sync)
1. Buat project Supabase, jadual `Expenses`:
   `id` text PK, `Title` text, `Amount` numeric, `Category` text,
   `Date` date, `note` text, `created_at` timestamptz default now().
2. Isi `SUPABASE_URL` + `SUPABASE_ANON_KEY` di `index.html`
   (dah ada, kekal — anon key adalah public by design).
3. **PENTING:** pasang **Row Level Security (RLS)** + policy
   `using (auth.uid() = user_id)` SEBELUM buka sync kepada orang.
   Else data terbuka. (Auth pengguna = S3, belum disambung.)

> **Nota privacy:** Data perbelanjaan TIDAK disimpan dalam repo. Ia simpan
> kat localStorage device. Repo public hanya dedahkan code + anon key
> (selamat asal RLS on).

---

## Next ideas (backlog)
- Edit transaksi sedia ada
- Chart bulanan (bar/line)
- **S3: Authentication + RLS betul** (supaya sync selamat & per-user)
- Hosting + PWA (buka macam app kat phone, install ke home screen)
- Custom domain

---

*Dihasilkan dengan bantuan Jarvis. Versi v1.2 — 16 Aug 2026.*
