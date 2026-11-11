"use client";

import { useState } from "react";

interface RevisionRequestModalProps {
  open: boolean;
  title?: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void | Promise<void>;
  submitting?: boolean;
}

/** 검토 Inbox와 팀/개인 페이지가 공유하는 "수정 요청" 사유 입력 모달 — 사유는 필수 입력이다. */
export function RevisionRequestModal({ open, title = "수정 요청", onCancel, onSubmit, submitting }: RevisionRequestModalProps) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  const trimmed = reason.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">수정이 필요한 내용을 입력해주세요.</label>
          <textarea
            autoFocus
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 연구 목적과 연구 방법의 연결을 조금 더 구체적으로 작성하세요."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            disabled={submitting || !trimmed}
            onClick={() => onSubmit(trimmed)}
            className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "처리 중..." : "수정 요청 보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
