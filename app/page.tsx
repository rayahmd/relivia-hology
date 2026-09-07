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
  const [isNative, setIsNative] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        return Capacitor.isNativePlatform();
      } catch {
        return false;
      }
    }
    return false;
  });

  useIsomorphicLayoutEffect(() => {
    try {
      if (Capacitor.isNativePlatform()) {
        setIsNative(true);
      }
    } catch {
      // Fallback
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

    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const supabase = createClient();
    let handled = false;

    const navigate = (destination: string, reason: string) => {
      if (handled) return;
      handled = true;
      console.log(`[ReliviaAuth] Native launch redirecting to ${destination} (reason: ${reason})`);
      window.location.replace(destination);
    };

    // 1. Immediate check: if a valid session is instantly available
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        navigate("/dashboard", "immediate getSession valid user");
      }
    }).catch(() => {});

    // 2. Listen for Supabase auth state initialization (handles token refresh & persistent cookie restoration)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`[ReliviaAuth] Auth state event on launch: ${event}, user: ${session?.user?.id ?? "none"}`);
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (session?.user) {
          navigate("/dashboard", `onAuthStateChange:${event}`);
        } else if (event === "INITIAL_SESSION") {
          navigate("/login", "onAuthStateChange:INITIAL_SESSION_no_user");
        }
      } else if (event === "SIGNED_OUT") {
        navigate("/login", "onAuthStateChange:SIGNED_OUT");
      }
    });

    // 3. Fallback timeout: if network or auth initialization takes longer than 2.5 seconds
    const timer = setTimeout(async () => {
      if (handled) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          navigate("/dashboard", "timeout fallback session exists");
        } else {
          navigate("/login", "timeout fallback no session");
        }
      } catch {
        navigate("/login", "timeout fallback error");
      }
    }, 2500);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
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
