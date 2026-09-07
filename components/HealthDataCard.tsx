"use client";

import { useState } from "react";
import Image from "next/image";

type HealthMetric = {
  metric: string;
  today_value: number | null;
  today_unit: string | null;
  baseline_value: number | null;
  change_percent: number | null;
  has_data: boolean;
};

const METRIC_CONFIG: Record<string, { label: string; icon: string; unit_display: string; card: string; value: string; unit: string; labelCls: string; baselineCls: string; watermark: string }> = {
  sleep_hours: {
    label: "Durasi Tidur",
    icon: "/images/icons/moon.svg",
    unit_display: "Jam",
    card: "bg-[#1B2436]",
    value: "text-[#FDEEB3]",
    unit: "text-[#FDEEB3]/80",
    labelCls: "text-white",
    baselineCls: "text-white/55",
    watermark: "",
  },
  steps: {
    label: "Langkah / Aktivitas",
    icon: "🏃",
    unit_display: "langkah",
    card: "bg-[#FFF3C2]",
    value: "text-[#111827]",
    unit: "text-[#111827]/60",
    labelCls: "text-[#6D28D9]",
    baselineCls: "text-[#67728A]",
    watermark: "text-[#111827]",
  },
  heart_rate: {
    label: "Detak Jantung",
    icon: "❤️",
    unit_display: "bpm",
    card: "bg-[#FBD2E8]",
    value: "text-[#111827]",
    unit: "text-[#6D28D9]",
    labelCls: "text-[#6D28D9]",
    baselineCls: "text-[#6D28D9]/70",
    watermark: "text-[#111827]",
  },
};

function formatValue(metric: string, v: number): string {
  if (metric === "sleep_hours") return v.toFixed(1);
  return Math.round(v).toLocaleString("id-ID");
}

export default function HealthDataCard({
  metrics,
  patientId,
}: {
  metrics: HealthMetric[];
  patientId: string;
}) {
  const [syncing, setSyncing] = useState(false);
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [loadingChange, setLoadingChange] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/patient/${patientId}/baseline`);
      if (!res.ok) throw new Error("Gagal sinkronisasi");
      setMessage("Baseline berhasil diperbarui.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function loadDemoData(scenario: "baseline_week" | "change_day") {
    const setter = scenario === "baseline_week" ? setLoadingBaseline : setLoadingChange;
    setter(true);
    setMessage(null);
    try {
      const res = await fetch("/api/health-sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, scenario }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal");
      if (scenario === "baseline_week") {
        setMessage(
          `✅ Contoh data baseline 7 hari berhasil dimuat.`
        );
        // Refresh baseline calculation
        await fetch(`/api/patient/${patientId}/baseline`);
      } else {
        // Hari perubahan: deteksi + analisis berjalan otomatis.
        // Tampilkan notifikasi seperti yang dilakukan lapisan native.
        if (json.notification?.sessionId) {
          try {
            const { notifyAgent } = await import("@/lib/nativeBridge");
            await notifyAgent({
              type: json.notification.type,
              sessionId: json.notification.sessionId,
            });
          } catch {
            /* in-app banner via AutoMonitorProvider polling covers this */
          }
        }
        setMessage(
          json.agentSessionId
            ? `✅ Perubahan terdeteksi otomatis — sesi pendalaman dibuat. Buka halaman Asisten untuk melihat pertanyaan Relivia.`
            : `✅ Contoh data perubahan hari ini berhasil dimuat. Muat ulang untuk melihat perubahannya.`
        );
        await fetch(`/api/patient/${patientId}/baseline`);
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setter(false);
    }
  }

  return (
    <div>
      {/* Metrics Stack — seperti di desain */}
      <div className="flex flex-col gap-3 mb-5">
        {metrics.map((m) => {
          const cfg = METRIC_CONFIG[m.metric] ?? { label: m.metric, icon: "📊", unit_display: "", card: "bg-white border border-border", value: "text-ink", unit: "text-soft", labelCls: "text-primary-deep", baselineCls: "text-faint", watermark: "text-ink" };
          const pct = m.change_percent ?? null;
          const down = (pct ?? 0) < 0;
          const changed = pct !== null && Math.abs(pct) >= 0.05;

          return (
            <div key={m.metric} className={`relative overflow-hidden rounded-[18px] p-4 ${cfg.card}`}>
              {/* watermark */}
              {cfg.icon.endsWith(".svg") ? (
                <img
                  aria-hidden
                  src={cfg.icon}
                  alt=""
                  draggable={false}
                  className="pointer-events-none select-none absolute -right-2 -bottom-3 w-[120px] h-auto"
                />
              ) : (
                <span aria-hidden className={`pointer-events-none select-none absolute -right-3 -bottom-5 text-[92px] leading-none opacity-15 ${cfg.watermark}`}>
                  {cfg.icon}
                </span>
              )}
              <div className="relative flex items-start justify-between gap-3">
                <div className={`text-[32px] leading-none font-extrabold tracking-tight ${cfg.value}`}>
                  {m.has_data && m.today_value !== null ? (
                    <>{formatValue(m.metric, m.today_value)} <span className={`text-[15px] font-bold ${cfg.unit}`}>{cfg.unit_display}</span></>
                  ) : (
                    <span className="text-[28px] opacity-40">—</span>
                  )}
                </div>
                {pct !== null && (
                  <span className="shrink-0 text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-white text-[#C1442B] shadow-sm">
                    <span className="text-[#F2684B]">{down ? "⬇" : "⬆"}</span> {Math.abs(pct).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
                  </span>
                )}
              </div>
              <div className={`relative mt-1.5 text-[15px] font-bold ${cfg.labelCls}`}>{cfg.label}</div>
              {m.baseline_value !== null ? (
                <div className={`relative mt-0.5 text-[11px] ${cfg.baselineCls}`}>
                  Baseline: {m.metric === "sleep_hours" ? Number(m.baseline_value).toFixed(2) : Math.round(m.baseline_value).toLocaleString("id-ID")} {cfg.unit_display.toLowerCase()}
                  {changed && (
                    <span className="font-semibold text-[#C1442B]">
                      {" "}· {down ? "Menurun" : "Meningkat"} dari baseline
                    </span>
                  )}
                </div>
              ) : (
                <div className={`relative mt-0.5 text-[11px] italic ${cfg.baselineCls}`}>
                  {m.has_data ? "Baseline belum tersedia" : "Belum ada data hari ini"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Feedback message */}
      {message && (
        <div className={`text-sm rounded-xl px-4 py-3 mb-4 ${
          message.startsWith("✅") ? "bg-green-tint text-green-deep" : "bg-red-tint text-red-deep"
        }`}>
          {message}
        </div>
      )}

      {/* Simulasi Health Connect */}
      <div className="rounded-[20px] bg-[#7C5CFC] p-5">
        <div className="text-[15px] font-extrabold uppercase tracking-wide text-[#FDEEB3] mb-2">
          Simulasi Health Connect
        </div>
        <p className="text-[13px] leading-relaxed text-white/90 mb-4">
          Simulasikan Data Health Connect. Gunakan tombol di bawah untuk demo scenario.
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            onClick={() => loadDemoData("baseline_week")}
            disabled={loadingBaseline}
            className="w-full text-[13px] font-bold px-4 py-2.5 rounded-full bg-[#F9C6DD] text-[#6D28D9] hover:brightness-95 transition disabled:opacity-60"
          >
            {loadingBaseline ? "Memuat…" : "Seed 7 Hari Baseline"}
          </button>
          <button
            onClick={() => loadDemoData("change_day")}
            disabled={loadingChange}
            className="w-full text-[13px] font-bold px-4 py-2.5 rounded-full bg-[#FFF1C1] text-[#6D28D9] hover:brightness-95 transition disabled:opacity-60"
          >
            {loadingChange ? "Memuat…" : "Simulasi Hari Perubahan"}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full text-[13px] font-bold px-4 py-2.5 rounded-full bg-white text-[#6D28D9] hover:bg-white/90 transition disabled:opacity-60"
          >
            {syncing ? "Menghitung…" : "Hitung Ulang Baseline"}
          </button>
        </div>
      </div>
    </div>
  );
}
