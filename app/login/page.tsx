"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";

// Login creates a Supabase browser client during render, which throws when
// build-time env is absent (e.g. Vercel without env vars configured).
// force-dynamic skips prerender so `next build` never hard-crashes on this.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function resendEmail() {
    setResending(true);
    setError(null);
    setResent(false);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setResent(true);
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
    // on success, Supabase redirects the browser to Google — no further code runs here
  }

  // Auto-trigger Google sign-in if the landing page linked here with ?provider=google
  // Also surface OAuth callback failures (?error=auth_failed) as a clear message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("provider") === "google") {
      handleGoogleSignIn();
    }
    if (params.get("error") === "auth_failed") {
      setError("Login Google gagal — sesi tidak terbentuk. Coba lagi.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setLoading(false);

      if (error) {
        setError(error.message);
        return;
      }

      // Session langsung ada kalau "Confirm email" nonaktif — masuk sekarang.
      if (data.session) {
        sessionStorage.setItem("registered", "1");
        router.push("/dashboard");
        router.refresh();
        return;
      }

      // Fallback: coba login langsung agar tidak perlu menunggu konfirmasi email.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (!signInError) {
        sessionStorage.setItem("registered", "1");
        router.push("/dashboard");
        router.refresh();
        return;
      }

      setCheckEmail(true);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-5 sm:px-6 py-6">
      <div className="w-full max-w-sm [perspective:1200px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            className="card w-full p-6 sm:p-8"
            initial={{ rotateY: 90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: -90, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
          >
            <div className="flex items-center gap-2.5 mb-8">
              <Logo size={30} />
              <span className="font-extrabold text-lg">Relivia</span>
            </div>

            {checkEmail ? (
              <div className="text-center pt-2">
                <p className="text-sm font-bold text-green-deep bg-green-tint rounded-xl px-4 py-3 mb-4">
                  Pendaftaran berhasil!
                </p>
                <div className="w-[64px] h-[64px] rounded-full bg-primary-light text-primary flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="M3.5 7l8.5 6 8.5-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h1 className="text-xl font-extrabold mb-2">Cek email kamu dulu ya</h1>
                <p className="text-sm text-soft leading-relaxed mb-5">
                  Kami sudah kirim tautan konfirmasi ke{" "}
                  <b className="text-ink break-all">{email}</b>. Klik tautan itu agar akun aktif,
                  lalu kembali ke sini untuk masuk.
                </p>
                {error && <p className="text-sm text-red-deep bg-red-tint rounded-lg px-3 py-2 mb-4">{error}</p>}
                {resent && (
                  <p className="text-sm text-green-deep bg-green-tint rounded-lg px-3 py-2 mb-4">
                    Email konfirmasi terkirim ulang — cek juga folder spam.
                  </p>
                )}
                <button
                  onClick={resendEmail}
                  disabled={resending}
                  className="btn-primary w-full justify-center disabled:opacity-60"
                >
                  {resending ? "Mengirim…" : "Kirim ulang email konfirmasi"}
                </button>
                <button
                  onClick={() => {
                    setCheckEmail(false);
                    setMode("login");
                  }}
                  className="text-sm text-soft hover:text-primary mt-4 w-full text-center"
                >
                  Sudah konfirmasi? Masuk
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-extrabold mb-1">
                  {mode === "login" ? "Masuk ke akunmu" : "Buat akun caregiver"}
                </h1>
                <p className="text-sm text-soft mb-6">
                  {mode === "login" ? "Lanjutkan pemantauan yang sudah kamu mulai." : "Satu akun caregiver, satu pasien untuk saat ini."}
                </p>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading}
                  className="w-full flex items-center justify-center gap-2.5 border-[1.5px] border-border rounded-xl px-4 py-3 text-sm font-bold hover:border-primary-tint transition disabled:opacity-60 mb-4"
                >
                  <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 6.5 29.5 4.5 24 4.5c-8 0-14.9 4.6-18.3 11.3z"/><path fill="#4CAF50" d="M24 44.5c5.4 0 10.3-2 13.9-5.3l-6.4-5.4C29.5 35.5 26.9 36.5 24 36.5c-5.3 0-9.7-3.1-11.4-7.5l-6.6 5.1C9.1 39.9 16 44.5 24 44.5z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.9 2.5-2.5 4.6-4.6 6l6.4 5.4C40.7 36.8 44.5 31 44.5 24c0-1.2-.1-2.4-.3-3.5z"/></svg>
                  {googleLoading ? "Mengalihkan ke Google…" : "Lanjut dengan Google"}
                </button>

                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-faint font-semibold">atau</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                  <input
                    type="email"
                    required
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="border-2 border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Kata sandi (min. 6 karakter)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-2 border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary"
                  />

                  {error && <p className="text-sm text-red-deep bg-red-tint rounded-lg px-3 py-2">{error}</p>}

                  <button type="submit" disabled={loading} className="btn-primary justify-center mt-1 disabled:opacity-60">
                    {loading ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
                  </button>
                </form>

                <button
                  onClick={() => setMode(mode === "login" ? "signup" : "login")}
                  className="text-sm text-soft hover:text-primary mt-5 w-full text-center"
                >
                  {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
                </button>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}