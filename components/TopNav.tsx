"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { IconHome, IconEdit, IconFlame, IconSparkle, IconAlertTriangle, IconFileText, IconUsers } from "@/components/Icons";
import Logo from "@/components/Logo";
import SosButton from "@/components/SosButton";

const items = [
  { href: "/dashboard", label: "Dasbor", Icon: IconHome },
  { href: "/checkin", label: "Catatan Harian", Icon: IconEdit },
  { href: "/health", label: "Kesehatan", Icon: IconFlame },
  { href: "/agent", label: "Agent", Icon: IconSparkle },
  { href: "/insight", label: "Insight", Icon: IconAlertTriangle },
  { href: "/summary", label: "Ringkasan", Icon: IconFileText },
  { href: "/community", label: "Komunitas", Icon: IconUsers },
];

export default function TopNav({ patientName, patientAge }: { patientName: string; patientAge?: number | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setOpen(false);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="sticky top-0 z-20 bg-white border-b border-border pt-[max(env(safe-area-inset-top),14px)]">
      <div className="flex items-center justify-between gap-3 px-4 md:px-7 py-2.5">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="font-extrabold text-lg hidden sm:inline">Relivia</span>
        </div>

        <nav className="hidden md:flex relative gap-1 bg-bg rounded-full p-1">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors whitespace-nowrap ${
                  active ? "text-white" : "text-soft hover:text-ink"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="topnav-active-pill"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="absolute inset-0 rounded-full bg-primary shadow-pop"
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <item.Icon size={15} />
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 md:gap-3">
          <SosButton />
          <div className="hidden md:flex items-center gap-2.5 bg-bg border border-border rounded-full pl-1.5 pr-3.5 py-1.5">
            <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center font-bold text-xs">
              {patientName.charAt(0)}
            </div>
            <div className="leading-tight">
              <p className="text-xs font-bold m-0">{patientName}{patientAge ? `, ${patientAge}` : ""}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="hidden md:inline text-xs font-semibold text-soft hover:text-red-deep">
            Keluar
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Tutup menu" : "Buka menu"}
            aria-expanded={open}
            aria-controls="topnav-menu"
            className="md:hidden w-11 h-11 -mr-1 flex items-center justify-center rounded-full text-ink hover:bg-bg active:bg-bg transition-colors"
          >
            {open ? (
              <svg className="w-5 h-5" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg className="w-5 h-5" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="topnav-menu"
          className="absolute inset-x-0 top-full md:hidden bg-white border-b border-border shadow-[0_16px_32px_-16px_rgba(31,41,55,0.25)]"
        >
          <div className="px-4 py-4 animate-menu-in">
          <div className="flex items-center gap-2.5 bg-bg border border-border rounded-2xl px-3.5 py-3 mb-2">
            <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm">
              {patientName.charAt(0)}
            </div>
            <div className="leading-tight min-w-0">
              <p className="text-sm font-bold m-0 truncate">{patientName}{patientAge ? `, ${patientAge}` : ""}</p>
              <p className="text-xs text-faint m-0">Caregiver</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1 bg-bg rounded-2xl p-2">
            {items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition ${
                    active ? "bg-primary text-white shadow-pop" : "text-soft hover:text-ink hover:bg-white"
                  }`}
                >
                  <item.Icon size={18} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 mt-2 rounded-xl px-4 py-3 text-sm font-bold text-red-deep bg-red-tint hover:bg-red hover:text-white transition"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
              <path d="M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 8l-4 4 4 4M6 12h10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Keluar
          </button>
        </div>
        </div>
      )}

      {open && <div className="fixed inset-0 z-[-1] md:hidden" onClick={() => setOpen(false)} />}
    </div>
  );
}
