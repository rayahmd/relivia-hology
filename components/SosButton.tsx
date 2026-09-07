"use client";

import { useState } from "react";

export default function SosButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#E53935] hover:bg-[#D32F2F] text-white text-xs sm:text-sm font-bold shadow-sm transition active:scale-95"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
          <path d="M6 4C5 4 4 5 4 6c0 8 6 14 14 14 1 0 2-1 2-2v-2.5c0-.6-.4-1.1-1-1.3l-3-1c-.5-.2-1 0-1.3.4l-1 1.3c-2-1-3.6-2.6-4.6-4.6l1.3-1c.4-.3.6-.8.4-1.3l-1-3C10.1 4.4 9.6 4 9 4H6z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Panggilan Darurat</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] flex items-start sm:items-center justify-center z-[120] p-5 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-[420px] p-5 sm:p-7" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold mb-1.5">Butuh bantuan segera?</h3>
            <p className="text-[13px] text-soft mb-5 leading-relaxed">
              Tenang dulu. Pilih salah satu di bawah — semua nomor ini bisa langsung dihubungi dari HP kamu.
            </p>

            <a href="tel:119" className="flex items-center gap-3.5 w-full p-3.5 rounded-2xl border-[1.5px] border-[#E4C1AC] bg-red-tint mb-2.5 hover:bg-[#F3D3C3] transition">
              <span className="w-[38px] h-[38px] rounded-xl bg-red text-white flex items-center justify-center flex-none">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 4C5 4 4 5 4 6c0 8 6 14 14 14 1 0 2-1 2-2v-2.5c0-.6-.4-1.1-1-1.3l-3-1c-.5-.2-1 0-1.3.4l-1 1.3c-2-1-3.6-2.6-4.6-4.6l1.3-1c.4-.3.6-.8.4-1.3l-1-3C10.1 4.4 9.6 4 9 4H6z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div>
                <p className="text-sm font-bold m-0">Panggil Ambulans — 119</p>
                <span className="text-xs text-soft">Layanan gawat darurat nasional</span>
              </div>
            </a>

            <a href="tel:1198" className="flex items-center gap-3.5 w-full p-3.5 rounded-2xl border-[1.5px] border-[#E4C1AC] bg-red-tint mb-2.5 hover:bg-[#F3D3C3] transition">
              <span className="w-[38px] h-[38px] rounded-xl bg-red text-white flex items-center justify-center flex-none">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div>
                <p className="text-sm font-bold m-0">Sejiwa — 119 ext 8</p>
                <span className="text-xs text-soft">Layanan sehat jiwa Kemenkes, siaga 24 jam</span>
              </div>
            </a>

            <button onClick={() => setOpen(false)} className="w-full text-center text-sm font-bold text-soft hover:text-ink py-2.5">
              Batal, ini bukan keadaan darurat
            </button>
          </div>
        </div>
      )}
    </>
  );
}
