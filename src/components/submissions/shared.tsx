"use client";

// 학생 "제출물"(/submissions) 페이지와 교사 "제출물 보관함"(/archive) 페이지가
// 공통으로 쓰는 표시 조각들. 두 페이지는 목적이 다르지만(해야 할 일 vs 전체 아카이브),
// "제출 당시 내용을 어떻게 보여줄지"/"첨부파일을 어떻게 내려받을지"는 완전히 같아야
// 하므로 여기 한 곳에서만 구현한다.

import { useEffect, useRef, useState } from "react";
import { Paperclip, Download, ChevronDown } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import type { HubPhase, SnapshotView } from "@/lib/submissions/hub";
import { downloadFile, downloadFilesAsZip } from "@/lib/submissions/download";
import {
  downloadAuthoredContentPdf,
  downloadAuthoredContentDocx,
  downloadSubmittedPdf,
  submittedPdfOf,
  getSubmissionExportContext,
  type ExportableSubmission,
} from "@/lib/export/submission-export";

export const PHASE_UI: Record<HubPhase, { label: string; tone: Tone; action: string }> = {
  not_started: { label: "작성 전", tone: "gray", action: "작성하기" },
  draft: { label: "작성 중", tone: "gray", action: "이어쓰기" },
  submitted: { label: "검토 중", tone: "gold", action: "내용 보기" },
  resubmitted: { label: "재검토 중", tone: "gold", action: "내용 보기" },
  revision_requested: { label: "수정 요청", tone: "red", action: "수정하러 가기" },
  approved: { label: "승인 완료", tone: "green", action: "보기" },
};

export const OUTCOME_UI: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "검토 중", tone: "gold" },
  approved: { label: "승인 완료", tone: "green" },
  rejected: { label: "수정 요청", tone: "red" },
};

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export function fmtDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function isDisplayableString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function firstPreviewText(content: Record<string, unknown> | null): string | null {
  if (!content) return null;
  const entry = Object.entries(content).find(([, v]) => isDisplayableString(v));
  return entry ? (entry[1] as string) : null;
}

export interface ParticipantEntry {
  name: string;
  roles: string[];
  description: string | null;
}

export function FullFields({ content }: { content: Record<string, unknown> | null }) {
  if (!content || Object.keys(content).length === 0) {
    return <p className="text-sm text-slate-400">작성된 내용이 없습니다.</p>;
  }
  return (
    <div className="space-y-2.5">
      {Object.entries(content).map(([label, value]) => {
        if (isDisplayableString(value)) {
          return (
            <div key={label}>
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{value}</p>
            </div>
          );
        }
        if (label === "참여자" && Array.isArray(value)) {
          return (
            <div key={label}>
              <p className="text-xs font-semibold text-slate-500">참여자</p>
              <ul className="space-y-1">
                {(value as ParticipantEntry[]).map((p, i) => (
                  <li key={i} className="text-sm text-slate-700">
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-1.5 text-slate-500">{p.roles.length > 0 ? p.roles.join(" / ") : "역할 미입력"}</span>
                    {p.description && <span className="ml-1 text-xs text-slate-500">&ldquo;{p.description}&rdquo;</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

export function AttachmentList({ attachments }: { attachments: { name: string; url: string }[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-500">첨부파일</p>
      {attachments.map((a) => {
        const isPdf = /\.pdf(\?|$)/i.test(a.url);
        return (
          <div key={a.url} className="rounded-lg border border-slate-200 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm text-slate-700">{a.name}</span>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-medium text-sky-600 hover:text-sky-800">
                파일 보기
              </a>
            </div>
            {isPdf && <iframe src={a.url} title={a.name} className="mt-2 h-72 w-full rounded border border-slate-200" />}
          </div>
        );
      })}
    </div>
  );
}

export interface ContentSource {
  snapshots: SnapshotView[];
  currentContent: Record<string, unknown> | null;
  currentAttachments: { name: string; url: string }[];
}

/** 제출 당시 내용 — 스냅샷이 있으면 이력별로, 없으면 "현재 원본" 폴백을 명확히 표시하고 보여준다. */
export function SubmissionContent({ item }: { item: ContentSource }) {
  if (item.snapshots.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          이 제출 건은 과거 버전 데이터가 저장되지 않아 현재 원본 내용을 표시합니다.
        </p>
        <FullFields content={item.currentContent} />
        <AttachmentList attachments={item.currentAttachments} />
      </div>
    );
  }

  const ordered = [...item.snapshots].reverse(); // 최신(마지막 제출)부터
  const total = ordered.length;
  return (
    <div className="space-y-3">
      {total > 1 && <p className="text-xs font-medium text-slate-500">제출 이력 {total}건</p>}
      {ordered.map((snap, i) => {
        const order = total - i;
        const outcome = OUTCOME_UI[snap.status] ?? OUTCOME_UI.submitted;
        return (
          <div key={snap.submittedAt} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">
                {order}차 제출{i === 0 ? " · 최신" : ""} · {fmtDate(snap.submittedAt)}
              </p>
              <Badge tone={outcome.tone}>{outcome.label}</Badge>
            </div>
            {snap.feedback && (
              <p className="mb-2 rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-700">교사 피드백: &ldquo;{snap.feedback}&rdquo;</p>
            )}
            <FullFields content={snap.content.fields} />
            <div className="mt-2">
              <AttachmentList attachments={snap.content.attachments} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 표/모바일 리스트에서 "내용 보기"를 열지 않고도 바로 다운로드할 수 있게 하는 셀.
 * 0개="—", 1개=파일명 클릭 시 바로 다운로드, 2개 이상="📎 N" 클릭 시 목록 팝오버 + 전체 다운로드(zip).
 */
export function AttachmentCell({ attachments }: { attachments: { name: string; url: string }[] }) {
  const [open, setOpen] = useState(false);
  const [zipping, setZipping] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (attachments.length === 0) return <span className="text-slate-300">—</span>;

  if (attachments.length === 1) {
    const a = attachments[0];
    return (
      <button
        type="button"
        onClick={() => downloadFile(a.url, a.name)}
        title={`${a.name} 다운로드`}
        className="flex max-w-[140px] items-center gap-1 text-sm text-sky-600 hover:text-sky-800"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{a.name}</span>
      </button>
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-sky-600 hover:text-sky-800">
        <Paperclip className="h-3.5 w-3.5" />
        {attachments.length}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <p className="mb-1.5 px-1 text-xs font-semibold text-slate-500">첨부파일 {attachments.length}개</p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {attachments.map((a) => (
              <li key={a.url} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-slate-50">
                <span className="truncate text-sm text-slate-700" title={a.name}>
                  {a.name}
                </span>
                <button
                  type="button"
                  onClick={() => downloadFile(a.url, a.name)}
                  className="shrink-0 text-xs font-medium text-sky-600 hover:text-sky-800"
                >
                  다운로드
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={zipping}
            onClick={async () => {
              setZipping(true);
              await downloadFilesAsZip(attachments, "첨부파일.zip");
              setZipping(false);
            }}
            className="mt-2 w-full rounded-lg bg-slate-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {zipping ? "압축 중..." : "전체 다운로드"}
          </button>
        </div>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-slate-500">
      <div className="flex items-center gap-2">
        <span>총 {total}건</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}개씩
            </option>
          ))}
        </select>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-slate-300 px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            이전
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-slate-300 px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 제출물 하나에 대한 "다운로드 ▼" 메뉴 — 작성내용 PDF/Word, 학생 제출 PDF, 전체 묶음 ZIP.
 * 실제 존재하지 않는 항목(예: 결과보고서 PDF가 없음)은 표시하지 않는다.
 */
export function SubmissionDownloadMenu({ item }: { item: ExportableSubmission }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ctx = getSubmissionExportContext([item]);
  const hasSubmittedPdf = !!submittedPdfOf(item);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        다운로드
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => run(() => downloadAuthoredContentPdf(item))}
            className="block w-full rounded px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            작성내용 PDF
          </button>
          <button
            type="button"
            onClick={() => run(() => downloadAuthoredContentDocx(item))}
            className="block w-full rounded px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            작성내용 Word
          </button>
          {hasSubmittedPdf && (
            <button
              type="button"
              onClick={() => run(() => downloadSubmittedPdf(item))}
              className="block w-full rounded px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              학생 제출 보고서 PDF
            </button>
          )}
          {ctx.attachmentCount > 0 && (
            <button
              type="button"
              onClick={() =>
                run(async () => {
                  const { exportSubmissions, DEFAULT_EXPORT_OPTIONS } = await import("@/lib/export/submission-export");
                  await exportSubmissions([item], { ...DEFAULT_EXPORT_OPTIONS, outputFormat: "zip" });
                })
              }
              className="block w-full rounded px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              전체 묶음 ZIP
            </button>
          )}
        </div>
      )}
    </div>
  );
}
