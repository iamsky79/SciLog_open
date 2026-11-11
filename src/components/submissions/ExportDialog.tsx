"use client";

import { useState } from "react";
import {
  DEFAULT_EXPORT_OPTIONS,
  exportSubmissions,
  getSubmissionExportContext,
  type ExportableSubmission,
  type SubmissionExportOptions,
} from "@/lib/export/submission-export";

// 학생 제출물 / 교사 제출물 관리에서 여러 submission을 선택해 함께 내보낼 때 쓰는
// 공용 dialog. 페이지마다 옵션 이름과 로직을 따로 만들지 않는다 — 존재하지 않는
// 자료(예: 학생 제출 PDF가 하나도 없음)는 옵션 자체를 숨긴다.

export function SubmissionExportDialog({ items, onClose }: { items: ExportableSubmission[]; onClose: () => void }) {
  const ctx = getSubmissionExportContext(items);
  const [options, setOptions] = useState<SubmissionExportOptions>({
    ...DEFAULT_EXPORT_OPTIONS,
    includeSubmittedPdf: ctx.submittedPdfCount > 0,
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ warnings: string[] } | null>(null);

  const atLeastOne = options.includeAuthoredContent || options.includeSubmittedPdf || options.includeAttachments || options.includeTeacherFeedback || options.includeReviewHistory;

  const handleExport = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await exportSubmissions(items, options);
      setResult(res);
      if (res.warnings.length === 0) onClose();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-semibold text-slate-900">선택 제출물 내보내기</h2>
          <p className="mt-1 text-sm text-slate-500">선택한 제출물 {ctx.count}건</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">포함할 자료</p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={options.includeAuthoredContent}
              onChange={(e) => setOptions((o) => ({ ...o, includeAuthoredContent: e.target.checked }))}
            />
            작성내용
          </label>
          {ctx.submittedPdfCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={options.includeSubmittedPdf}
                onChange={(e) => setOptions((o) => ({ ...o, includeSubmittedPdf: e.target.checked }))}
              />
              학생 제출 보고서 PDF ({ctx.submittedPdfCount}개)
            </label>
          )}
          {ctx.attachmentCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={options.includeAttachments}
                onChange={(e) => setOptions((o) => ({ ...o, includeAttachments: e.target.checked }))}
              />
              첨부파일 ({ctx.attachmentCount}개)
            </label>
          )}
          {ctx.hasTeacherFeedback && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={options.includeTeacherFeedback}
                onChange={(e) => setOptions((o) => ({ ...o, includeTeacherFeedback: e.target.checked }))}
              />
              교사 피드백
            </label>
          )}
          {ctx.hasReviewHistory && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={options.includeReviewHistory}
                onChange={(e) => setOptions((o) => ({ ...o, includeReviewHistory: e.target.checked }))}
              />
              제출/검토 이력
            </label>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">내보내기 형식</p>
          <div className="flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={options.outputFormat === "pdf"} onChange={() => setOptions((o) => ({ ...o, outputFormat: "pdf" }))} />
              통합 PDF
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={options.outputFormat === "zip"} onChange={() => setOptions((o) => ({ ...o, outputFormat: "zip" }))} />
              ZIP 묶음
            </label>
          </div>
        </div>

        {options.outputFormat === "zip" && options.includeAuthoredContent && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500">작성내용 형식</p>
            <div className="flex flex-col gap-1.5 text-sm text-slate-700">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={options.authoredContentFormat === "pdf"} onChange={() => setOptions((o) => ({ ...o, authoredContentFormat: "pdf" }))} />
                하나의 통합 PDF
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={options.authoredContentFormat === "individual_pdf"} onChange={() => setOptions((o) => ({ ...o, authoredContentFormat: "individual_pdf" }))} />
                제출물별 개별 PDF
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={options.authoredContentFormat === "docx"} onChange={() => setOptions((o) => ({ ...o, authoredContentFormat: "docx" }))} />
                제출물별 개별 Word
              </label>
            </div>
          </div>
        )}

        {result && result.warnings.length > 0 && (
          <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {result.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            취소
          </button>
          <button
            type="button"
            disabled={running || !atLeastOne}
            onClick={handleExport}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {running ? "내보내는 중..." : "내보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
