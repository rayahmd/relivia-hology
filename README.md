# Relivia

**Relivia** adalah aplikasi pendamping caregiver untuk memantau kondisi harian pasien (mis. pasien dengan kebutuhan pemantauan kesehatan jiwa) dan mengubah catatan harian menjadi sinyal klinis terstruktur untuk psikiater.

Alur utama: **Caregiver mengisi daily check-in → grafik & kalender pemantauan → Insight AI (Gemini) → ringkasan periode + unduh PDF → diskusi komunitas → tombol darurat (SOS).**

Fitur monitoring otomatis (opsional): **Health Connect → background sync → baseline personal → deteksi perubahan → Relivia Agent → notifikasi.**

Tech stack:

- **Frontend + Backend:** Next.js 14 (App Router), React 18, Tailwind CSS, Framer Motion
- **Auth + Database:** Supabase (Auth + Postgres + RLS)
- **AI:** Google Gemini API (`gemini-3.1-flash-lite`) via server-side route `/api/insight`
- **PDF:** jsPDF (client-side)
- **Mobile (opsional):** Capacitor 8 (Android)
- **Deploy referensi:** Vercel

---

## Daftar Isi

1. [Prasyarat](#1-prasyarat)
2. [Spesifikasi Lingkungan Pengujian](#2-spesifikasi-lingkungan-pengujian)
3. [Panduan Instalasi](#3-panduan-instalasi)
4. [Cara Menjalankan Aplikasi](#4-cara-menjalankan-aplikasi)
5. [Akun Demo](#5-akun-demo)
6. [Alur Pengujian Manual (Checklist Juri)](#6-alur-pengujian-manual-checklist-juri)
7. [Struktur Proyek](#7-struktur-proyek)
8. [Catatan & Troubleshooting](#8-catatan--troubleshooting)

---

## 1. Prasyarat

Sebelum instalasi, siapkan:

1. **Node.js LTS** (disarankan v20.x) + **npm 10.x**
   - Cek versi: `node --version` dan `npm --version`
2. **Akun Supabase** (gratis) di [supabase.com](https://supabase.com) — untuk Auth + Postgres
3. **Kunci Gemini API** (gratis) di [Google AI Studio](https://aistudio.google.com/app/apikey) — untuk fitur Insight AI
4. **Git** untuk clone repo
5. Opsional (hanya untuk build Android):
   - Android Studio + Android SDK
   - Perangkat Android dengan Health Connect (atau gunakan mode simulasi `/health` tanpa perangkat)

---

## 2. Spesifikasi Lingkungan Pengujian

Aplikasi ini diuji dan dinyatakan berjalan pada lingkungan berikut:

### 2.1. Perangkat Lunak

| Komponen | Versi yang Diuji |
|---|---|
| OS | Windows 10 Home Single Language 22H2 (Build 26100) |
| Node.js | v26.5.0 (disarankan LTS v20.x, `packageManager: npm@10.9.2`) |
| npm | v11.17.0 (repo dipin ke npm 10.9.2 via `packageManager`) |
| Next.js | 14.2.5 |
| React / React DOM | 18.3.1 |
| TypeScript | 5.5.3 |
| Tailwind CSS | 3.4.4 |
| Supabase JS / SSR | `@supabase/supabase-js@2.45.4`, `@supabase/ssr@0.5.1` |
| Capacitor (Core/Android/CLI) | 8.5.1 |
| Framer Motion | 13.x |
| jsPDF | 2.5.2 |
| Browser | Google Chrome / Microsoft Edge versi terbaru (disarankan), Firefox terbaru |
| Deploy referensi | Vercel (Node 20 runtime) |

### 2.2. Perangkat Keras (mesin uji)

| Komponen | Spesifikasi |
|---|---|
| CPU | 12th Gen Intel Core i5-12450H (8 core) |
| RAM | 8 GB (minimum disarankan 8 GB) |
| Penyimpanan bebas | ± 1 GB untuk `node_modules` + build `.next` |
| Jaringan | Koneksi internet aktif (wajib untuk Supabase, Gemini, dan Google News RSS) |

### 2.3. Layanan Eksternal

| Layanan | Kegunaan | Wajib? |
|---|---|---|
| Supabase (URL + Anon Key) | Auth, tabel `patients`, `daily_checkins`, `ai_insights`, `profiles`, `community_posts`, dsb. | Ya |
| Gemini API Key | Generate Insight AI di `/api/insight` | Ya (hanya untuk fitur Insight) |
| Google OAuth Client | Tombol “Lanjut dengan Google” | Tidak (login email tetap bisa tanpa ini) |
| Health Connect (Android) | Sinkronisasi data kesehatan otomatis | Tidak (ada mode simulasi) |

> Port default aplikasi: `http://localhost:3000`.

---

## 3. Panduan Instalasi

### Langkah 1 — Clone & install dependencies

```bash
git clone <url-repo-relivia>
cd relivia
npm install
```

### Langkah 2 — Setup Database Supabase

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor → New Query**, jalankan seluruh isi file berikut **berurutan**:
   - `supabase/schema.sql` (tabel inti + RLS + trigger verifikasi + fungsi `increment_helpful`)
   - `supabase/migrations/02_auto_monitoring.sql` (tabel monitoring otomatis: `health_data`, `baselines`, `detected_changes`, sesi agent, notifikasi)
   - Kedua skrip aman dijalankan ulang (`IF NOT EXISTS`).
3. Buka **Project Settings → API**, salin:
   - `Project URL`
   - `anon public key`
4. Buka **Authentication → Sign In / Providers**, pastikan **Email** aktif.
   - Untuk demo/penjurian: di **Authentication → Settings**, **matikan “Confirm email”** agar signup langsung bisa login tanpa verifikasi email.

### Langkah 3 — Setup Environment Variable

```bash
cp .env.example .env.local
```

Isi `.env.local`:

```env
# Supabase — Project Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxx-anon-key-kamu

# Gemini — https://aistudio.google.com/app/apikey
# Server-side only, jangan expose ke browser.
GEMINI_API_KEY=xxxx-gemini-key-kamu
```

> Jangan commit `.env.local`. File ini sudah ada di `.gitignore`.

### Langkah 4 — (Opsional) Setup Google OAuth

Tanpa langkah ini, login email tetap berjalan — hanya tombol Google yang akan error (bukan bug kode).

1. Di [Google Cloud Console](https://console.cloud.google.com), buat **OAuth Client ID** tipe **Web application**.
2. Isi **Authorized redirect URI** dengan:
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. Di dashboard Supabase → **Authentication → Providers → Google**, aktifkan dan isi **Client ID + Client Secret**.
4. Di Supabase → **Authentication → URL Configuration → Redirect URLs**, tambahkan:
   - `http://localhost:3000`
   - URL Vercel kamu (mis. `https://relivia-xxx.vercel.app`)

### Langkah 5 — Verifikasi instalasi

```bash
npm run build
```

Jika build sukses tanpa error TypeScript, instalasi selesai. Lanjut ke bagian menjalankan aplikasi.

---

## 4. Cara Menjalankan Aplikasi

### 4.1. Mode Development (disarankan untuk penjurian lokal)

```bash
npm run dev
```

Buka: `http://localhost:3000`

### 4.2. Mode Production lokal (simulasi hasil deploy)

```bash
npm run build
npm run start
```

Buka: `http://localhost:3000`

### 4.3. Deploy ke Vercel

Opsi A — via CLI:

```bash
npx vercel
```

Opsi B — via dashboard:

1. **Import Project** dari repo GitHub ini ke Vercel.
2. Di **Environment Variables**, isi 3 variabel yang sama seperti `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`
3. Klik **Deploy** — selesai, tanpa konfigurasi tambahan.

### 4.4. Menjalankan versi Android (Capacitor, opsional)

Arsitektur: APK memuat URL web yang sudah di-deploy (via `server.url` di `capacitor.config.ts`), karena API routes (`/api/health-sync`, `/api/agent/*`) butuh server — bukan static export.

```bash
# 1. Deploy web dulu ke Vercel, lalu isi server.url di capacitor.config.ts
# 2. Build + sinkron ke proyek Android:
npm run build:android

# 3. Buka di Android Studio:
npx cap open android
```

Lalu **Run/Build APK** dari Android Studio (butuh Android SDK + perangkat dengan Health Connect).

> Demo **tanpa perangkat fisik**: buka halaman `/health` → klik **“Seed 7 Hari Baseline”** → klik **“Simulasi Hari Perubahan”** → pipeline otomatis berjalan (deteksi + sesi agent + notifikasi). Buka `/agent` untuk menjawab pertanyaan agent dan melihat insight.

### 4.5. Rute utama aplikasi

| Rute | Deskripsi | Butuh Login? |
|---|---|---|
| `/` | Landing page + berita caregiver live (server-side RSS) | Tidak |
| `/login` | Login, signup, layar “cek email”, resend, Google OAuth | Tidak |
| `/onboarding` | Isi profil pasien pertama kali (nama + umur wajib) | Ya |
| `/dashboard` | Grafik pemantauan, kalender, log harian | Ya |
| `/checkin` | Wizard catatan harian 5 langkah (mood, tidur, interaksi, medikasi, catatan) | Ya |
| `/insight` | Tombol “Buat Insight” → Gemini → simpan ke `ai_insights` (min. 3 hari data) | Ya |
| `/summary` | Ringkasan per periode (1/3 minggu, 1 bulan) + unduh PDF (jsPDF) | Ya |
| `/community` | Feed lintas-user, tulis post, vote “membantu” | Ya |
| `/health` | Simulasi/seed data Health Connect + baseline | Ya |
| `/agent` | Menjawab pertanyaan Relivia Agent + melihat Clinical Insight | Ya |
| `/auth/callback` | Handler penukaran code → session (OAuth & email) | — |

---

## 5. Akun Demo

> Tidak ada akun hardcoded di dalam kode. Untuk pengujian, buat salah satu akun demo berikut dengan cara di bawah. Semua data demo terisolasi per akun (RLS Supabase).

### 5.1. Kredensial demo yang disarankan

| Peran | Email | Password | Cara mendapatkan |
|---|---|---|---|
| Caregiver Demo (utama) | `demo@relivia.id` | `Relivia123!` | Daftar manual via `/login` → menu Signup (lihat 5.2) |
| Caregiver Kedua (untuk uji Komunitas lintas-user) | `demo2@relivia.id` | `Relivia123!` | Daftar manual via `/login` → menu Signup |
| Login cepat Google | akun Google pribadi juri | — | Klik “Lanjut dengan Google” di `/login` (butuh setup OAuth §3 Langkah 4) |

> Jika juri tidak ingin mendaftar, panitia dapat membuatkan dulu 2 email di atas di project Supabase yang dipakai demo, lalu langsung login dengan password tersebut.

### 5.2. Cara membuat akun demo (2 menit)

1. Jalankan aplikasi (`npm run dev`), buka `http://localhost:3000/login`.
2. Pilih tab **Daftar**, isi email demo (mis. `demo@relivia.id`) + password (mis. `Relivia123!`), klik Daftar.
   - Jika di Supabase **“Confirm email” dimatikan**: akun langsung login otomatis.
   - Jika **“Confirm email” aktif**: buka layar “Cek email”, klik link verifikasi (redirect ke `/auth/callback`), lalu login.
3. Setelah login pertama, kamu diarahkan ke `/onboarding` — isi **nama pasien + umur**, simpan.
4. Selesai — kamu masuk ke `/dashboard` dan bisa mulai uji checklist di bawah.

### 5.3. Cara menyiapkan data demo yang bagus (5 menit, disarankan)

Agar fitur Insight, Grafik, dan PDF langsung terlihat isinya:

1. Login sebagai akun demo.
2. Buka `/checkin`, isi **3–5 catatan harian** (ubah tanggal/mood bervariasi; minimal 3 hari untuk membuka fitur Insight).
3. Buka `/insight` → klik **“Buat Insight”** (butuh `GEMINI_API_KEY` valid).
4. Buka `/summary` → ganti periode → klik **Unduh PDF**.
5. (Opsional otomatisasi) Buka `/health` → **Seed 7 Hari Baseline** → **Simulasi Hari Perubahan** → buka `/agent` dan jawab pertanyaan.

---

## 6. Alur Pengujian Manual (Checklist Juri)

1. **Landing (`/`)** — halaman terbuka tanpa login, berita caregiver tampil.
2. **Register/Login (`/login`)** — signup email berhasil, user baru dilempar ke `/onboarding`.
3. **Onboarding (`/onboarding`)** — simpan nama + umur pasien, redirect ke `/dashboard`.
4. **Check-in (`/checkin`)** — wizard 5 langkah tersimpan, muncul di dashboard/kalender.
5. **Dashboard (`/dashboard`)** — grafik, kalender, dan log harian update dari data asli.
6. **Insight (`/insight`)** — dengan ≥3 hari data, “Buat Insight” mengembalikan `risk_category` + ringkasan klinis; dengan <3 hari, ditolak dengan pesan jelas.
7. **Summary (`/summary`)** — ganti periode berubah, tombol unduh menghasilkan PDF asli.
8. **Community (`/community`)** — tulis post, post tampil di feed, vote “membantu” menambah angka; badge “Terverifikasi” otomatis aktif setelah 14 catatan.
9. **SOS** — tombol darurat tampil di semua halaman, `tel:` ke 119 / Sejiwa 119 ext 8.
10. **Guard** — buka `/dashboard` tanpa login → redirect ke `/login`; user tanpa onboarding → redirect ke `/onboarding`.

---

## 7. Struktur Proyek

```
app/
  page.tsx              Landing — fetch berita caregiver live (server-side)
  login/                Login, signup, cek email, resend, Google OAuth
  onboarding/           Isi profil pasien pertama kali
  auth/callback/        Route handler penukaran code → session
  dashboard/            Grafik, kalender, log harian (data asli)
  checkin/              Wizard 5 langkah: mood, tidur, interaksi, medikasi, catatan
  insight/              Tombol Buat Insight → Gemini API → ai_insights
  summary/              Selector periode + unduh PDF (jsPDF)
  community/            Feed lintas-user, tulis post, vote membantu
  health/               Seed/simulasi Health Connect + baseline
  agent/                Jawab pertanyaan agent + Clinical Insight
  api/insight/route.ts  Endpoint server-side Gemini (gemini-3.1-flash-lite, retry 3x)
  api/health-sync/      Ingest data kesehatan + trigger deteksi
  api/agent/            Sesi pertanyaan agent + re-analisis
  api/notifications/    Dispatch notifikasi
lib/
  news.ts               RSS Google News keyword caregiver + og:image
  getOrCreatePatient.ts Auto-provision pasien (MVP: 1 caregiver = 1 pasien)
  getOrCreateProfile.ts Auto-provision profil caregiver (Komunitas)
  autoTrigger.ts        Baseline personal + deteksi perubahan
  nativeBridge.ts       Bridge Capacitor ↔ Web
  healthSyncQueue.ts    Antrean sync offline-first
  supabase/             Client & server Supabase (@supabase/ssr)
supabase/
  schema.sql            Skema inti + RLS + trigger + increment_helpful
  migrations/02_auto_monitoring.sql  Skema monitoring otomatis
components/
  landing/              Navbar, Hero, Features, HowItWorks, dst.
  TopNav.tsx            Navbar sticky pasca-login (framer-motion)
  CheckinWizard.tsx     Wizard 5 langkah catatan harian
  MonitoringChart.tsx / Calendar.tsx / InsightPanel.tsx / SummaryClient.tsx
  CommunityFeed.tsx / ShareStoryForm.tsx / SosButton.tsx / Icons.tsx / Logo.tsx
android/                Proyek Capacitor (ReliviaHealthPlugin, HealthSyncWorker 6-jam)
capacitor.config.ts     server.url → URL Vercel deploy
```

---

## 8. Catatan & Troubleshooting

| Gejala | Penyebab umum & solusi |
|---|---|
| `Missing Supabase env` / halaman blank | `.env.local` belum diisi — ulangi §3 Langkah 3, restart `npm run dev`. |
| Tombol Google error `provider is not enabled` | OAuth belum dikonfigurasi — itu normal; setup via §3 Langkah 4 atau pakai login email. |
| Signup stuck di “Cek email” | “Confirm email” aktif di Supabase — klik link di inbox, atau matikan untuk demo. |
| “Butuh minimal 3 hari catatan” di Insight | Memang disengaja — isi 3+ check-in dulu via `/checkin`. |
| Insight error `invalid key / quota / 429` | `GEMINI_API_KEY` salah/habis — pesan error asli dari Gemini ditampilkan; tunggu atau ganti key. |
| `npm run build` gagal di Windows | Pastikan Node 20+ dan hapus `.next` + `node_modules` lalu `npm install` ulang. |
| APK tidak bisa login OAuth | Tambahkan redirect `relivia://auth/callback` dan URL deploy ke Supabase Redirect URLs; jangan ubah `androidScheme` ke `relivia` (lihat komentar `capacitor.config.ts`). |

---

## Lisensi

Proyek untuk keperluan kompetisi/hackathon. Hak cipta milik tim pengembang Relivia.
