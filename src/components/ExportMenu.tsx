"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";

interface ExportMenuProps {
  onExport: (format: "pdf" | "docx") => void | Promise<void>;
  label?: string;
  size?: "sm" | "xs";
}

/** 탭별 내보내기(Word/PDF) 드롭다운 — 팀 전체 내보내기 버튼과 동일한 시각 컨벤션. */
export function ExportMenu({ onExport, label = "내보내기", size = "sm" }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handle = async (format: "pdf" | "docx") => {
    setOpen(false);
    setBusy(true);
    try {
      await onExport(format);
    } finally {
      setBusy(false);
    }
  };

  const pad = size === "xs" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={`flex items-center gap-1.5 rounded-lg border border-slate-300 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 ${pad}`}
      >
        <Download className="h-3.5 w-3.5" />
        {busy ? "내보내는 중..." : label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white shadow-lg">
          <button type="button" onClick={() => handle("pdf")} className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
            PDF로 내보내기
          </button>
          <button type="button" onClick={() => handle("docx")} className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
            Word로 내보내기
          </button>
        </div>
      )}
    </div>
  );
}
