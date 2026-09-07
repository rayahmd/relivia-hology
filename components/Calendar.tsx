"use client";

import type { DailyCheckin } from "@/lib/types";

const DOW = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export default function Calendar({ checkins }: { checkins: DailyCheckin[] }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDate = new Map(checkins.map((c) => [c.checkin_date, c]));

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push(<div key={`e${i}`} className="aspect-square" />);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = byDate.get(dateStr);
    const isToday = dateStr === now.toISOString().slice(0, 10);

    // Styling matching screenshot: vibrant soft pink/magenta/purple rounded pills with white text
    let cls = "aspect-square rounded-2xl flex flex-col items-center justify-center text-sm font-bold bg-[#F5D0FE] text-[#86198F] transition-all";
    
    if (entry) {
      cls = "aspect-square rounded-2xl flex flex-col items-center justify-center text-sm font-extrabold bg-[#E879F9] text-white cursor-pointer hover:bg-[#D946EF] shadow-sm transition-all";
    }
    if (entry?.behavior_change_flag) {
      cls = "aspect-square rounded-2xl flex flex-col items-center justify-center text-sm font-extrabold bg-[#F43F5E] text-white cursor-pointer hover:bg-[#E11D48] shadow-sm transition-all";
    }
    if (isToday) {
      cls += " ring-3 ring-[#7C3AED] ring-offset-2";
    }

    cells.push(
      <div
        key={dateStr}
        className={cls}
        onClick={
          entry
            ? () => {
                const el = document.getElementById(`log-${dateStr}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("flash-highlight");
                  setTimeout(() => el.classList.remove("flash-highlight"), 1200);
                }
              }
            : undefined
        }
      >
        {d}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-7 gap-2 p-4 sm:p-6">
      {DOW.map((d) => (
        <div key={d} className="text-center text-xs font-bold text-gray-500 pb-1">
          {d}
        </div>
      ))}
      {cells}
    </div>
  );
}
