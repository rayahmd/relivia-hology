"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
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

export default function LandingPage() {
  const router = useRouter();

  // Safety net: if Supabase ever redirects the OAuth code to the Site URL
  // (root) instead of /auth/callback, forward it so the session exchange
  // still runs. Normal visitors without ?code= are unaffected.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("code")) {
      window.location.replace(`/auth/callback?${params.toString()}`);
      return;
    }

    try {
      if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
        router.replace("/login");
      }
    } catch {
      // Fallback in case Capacitor API is unavailable
    }
  }, [router]);

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
