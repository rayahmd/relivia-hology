"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";
import LandingNavbar from "@/components/landing/LandingNavbar";
import Hero from "@/components/landing/Hero";
import Features from "@/components/landing/Features";
import HowItWorks from "@/components/landing/HowItWorks";
import InsightSection from "@/components/landing/InsightSection";
import Showcase from "@/components/landing/Showcase";
import Trust from "@/components/landing/Trust";
import FAQ from "@/components/landing/FAQ";
import FinalCTA from "@/components/landing/FinalCTA";
import Footer from "@/components/landing/Footer";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function LandingPage() {
  const router = useRouter();
  // Always start as false so the first client render matches the SSR HTML
  // (full landing). Native detection happens in the layout effect below,
  // which runs before browser paint — combined with the inline boot guard
  // in app/layout.tsx (same purple background, body hidden), the landing
  // pixels are never visible inside the APK. Never call browser-only APIs
  // during render.
  const [isNative, setIsNative] = useState(false);

  useIsomorphicLayoutEffect(() => {
    let native = false;
    try {
      if (Capacitor.isNativePlatform()) {
        native = true;
      }
    } catch {
      // Capacitor not ready — fall through to sticky-flag / WebView checks.
    }
    if (!native) {
      try {
        if (localStorage.getItem("rv-is-native") === "1") {
          native = true;
        }
      } catch {
        /* storage unavailable — ignore */
      }
    }
    if (!native) {
      try {
        const ua = navigator.userAgent || "";
        if (/Android/.test(ua) && /;\s*wv/.test(ua)) {
          native = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (native) {
      // Persist for the next cold start so the inline boot guard in
      // app/layout.tsx can redirect before React even loads.
      try {
        localStorage.setItem("rv-is-native", "1");
      } catch {
        /* ignore */
      }
      // Belt-and-suspenders if the boot guard missed (e.g. bridge injected
      // late on first install): hide landing synchronously before paint.
      try {
        document.documentElement.classList.add("rv-native-boot");
      } catch {
        /* ignore */
      }
      setIsNative(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Safety net: if Supabase ever redirects the OAuth code to the Site URL
    // (root) instead of /auth/callback, forward it so the session exchange
    // still runs. Normal visitors without ?code= are unaffected.
    const params = new URLSearchParams(window.location.search);
    if (params.get("code")) {
      window.location.replace(`/auth/callback?${params.toString()}`);
      return;
    }

    const supabase = createClient();
    let handled = false;

    // SPA navigation (bukan window.location.replace): tidak ada full reload,
    // tidak ada kehilangan router state, cepat di WebView maupun browser.
    const navigate = (destination: string, reason: string) => {
      if (handled) return;
      handled = true;
      console.log(`[ReliviaAuth] Launch redirecting to ${destination} (reason: ${reason})`);
      router.replace(destination);
    };

    // Single deterministic check: sesi yang sudah persisten → dashboard,
    // tidak ada sesi → biarkan landing (web) / ke login (native).
    // Satu getSession + satu listener INITIAL_SESSION; tanpa timeout
    // artifisial — tidak ada polling, tidak ada reload.
    // Web yang sudah login dibuka di "/" → langsung dashboard
    // (sebelumnya: early-return sehingga user authed stuck di landing).
    // Native tanpa sesi → /login agar landing tidak sempat tampil di APK
    // (placeholder ungu di bawah menutup jeda transisi).
    const isNative = Capacitor.isNativePlatform();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        navigate("/dashboard", "immediate getSession valid user");
      } else if (isNative) {
        navigate("/login", "immediate getSession no user (native)");
      }
    }).catch(() => {});

    // Listen for Supabase auth state initialization (handles token refresh & persistent cookie restoration)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`[ReliviaAuth] Auth state event on launch: ${event}, user: ${session?.user?.id ?? "none"}`);
      if (session?.user) {
        navigate("/dashboard", `onAuthStateChange:${event}`);
      } else if (event === "SIGNED_OUT" && isNative) {
        navigate("/login", "onAuthStateChange:SIGNED_OUT");
      }
      // Web tanpa sesi: tetap di landing (jangan tendang ke /login).
      // INITIAL_SESSION tanpa user bukan aksi — biarkan hasil getSession
      // di atas yang menentukan, agar tidak ada redirect sementara.
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  if (isNative) {
    return <div className="min-h-screen bg-[#2D1B69]" />;
  }

  return (
    <main className="font-sans min-h-screen bg-bg text-ink">
      <LandingNavbar />
      <Hero />
      <Features />
      <HowItWorks />
      <InsightSection />
      <Showcase />
      <Trust />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
