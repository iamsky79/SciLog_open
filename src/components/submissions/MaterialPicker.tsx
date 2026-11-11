"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ExportableSubmission } from "@/lib/export/submission-export";

// "전체 내보내기" 클릭 시 바로 모든 자료를 내보내지 않고, 먼저 어떤 자료(연구계획서/
// 연구일지 각 건/결과보고서)를 포함할지 고르게 한다. 새 export 데이터 모델을 만들지
// 않고 fetchProjectExportItems()가 이미 준 ExportableSubmission[]을 그대로
// 체크박스로 고른 뒤, 선택된 부분집합만 기존 SubmissionExportDialog에 넘긴다.

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function MaterialPickerDialog({
  items,
  onCancel,
  onConfirm,
}: {
  items: ExportableSubmission[];
  onCancel: () => void;
  onConfirm: (selected: ExportableSubmission[]) => void;
}) {
  const plan = useMemo(() => items.find((i) => i.docType === "연구계획서") ?? null, [items]);
  const report = useMemo(() => items.find((i) => i.docType === "결과보고서") ?? null, [items]);
  const logs = useMemo(() => items.filter((i) => i.docType === "연구일지"), [items]);

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.id, true]))
  );
  const [logsExpanded, setLogsExpanded] = useState(logs.length <= 6);

  const toggle = (id: string) => setChecked((c) => ({ ...c, [id]: !c[id] }));

  const logsCheckedCount = logs.filter((l) => checked[l.id]).length;
  const logsAllChecked = logs.length > 0 && logsCheckedCount === logs.length;
  const logsNoneChecked = logsCheckedCount === 0;
  const setAllLogs = (value: boolean) =>
    setChecked((c) => {
      const next = { ...c };
      for (const l of logs) next[l.id] = value;
      return next;
    });

  const selectedCount = items.filter((i) => checked[i.id]).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 space-y-1 border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">전체 내보내기</h2>
          <p className="text-sm text-slate-500">포함할 연구 자료를 선택해주세요.</p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {plan && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!checked[plan.id]} onChange={() => toggle(plan.id)} />
              연구계획서
            </label>
          )}

          {logs.length > 0 && (
            <div className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={logsAllChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = !logsAllChecked && !logsNoneChecked;
                    }}
                    onChange={() => setAllLogs(!logsAllChecked)}
                  />
                  연구일지 ({logsCheckedCount}/{logs.length})
                </label>
                <button
                  type="button"
                  onClick={() => setLogsExpanded((v) => !v)}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                >
                  {logsExpanded ? "접기" : "펼치기"}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${logsExpanded ? "rotate-180" : ""}`} />
                </button>
              </div>
              {logsExpanded && (
                <div className="max-h-48 space-y-1 overflow-y-auto border-t border-slate-100 px-3 py-2">
                  {logs.map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={!!checked[l.id]} onChange={() => toggle(l.id)} />
                      <span className="text-slate-400">{fmtDate(l.submittedAt)}</span>
                      <span className="truncate">{l.title || "(제목 없음)"}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {report && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!checked[report.id]} onChange={() => toggle(report.id)} />
              결과보고서
            </label>
          )}

          {items.length === 0 && <p className="text-sm text-slate-400">내보낼 수 있는 제출된 자료가 없습니다.</p>}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-6 py-3">
          <span className="text-xs text-slate-400">{selectedCount}건 선택됨</span>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              취소
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => onConfirm(items.filter((i) => checked[i.id]))}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
