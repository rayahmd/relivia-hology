import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Relivia — Capacitor config (PRD §7).
 *
 * Next.js tetap menjadi UI + backend (server mode, bukan static export),
 * karena API routes (/api/health-sync, /api/agent/*) membutuhkan server.
 * Pola yang dipakai: APK memuat URL web yang sudah di-deploy
 * (mis. Vercel) melalui `server.url` — lihat README bagian Android.
 *
 * Untuk demo lokal: `npm run dev`, lalu arahkan server.url ke IP LAN.
 */
const config: CapacitorConfig = {
  appId: "com.relivia.app",
  appName: "Relivia",
  webDir: "capacitor-www",
  backgroundColor: "#2D1B69",
  android: {
    allowMixedContent: false,
  },
  server: {
    url: "https://relivia-hology-wini.vercel.app",
    androidScheme: "relivia",
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_icon",
      iconColor: "#2D1B69",
    },
  },
};

export default config;
