"use client";

import { useState } from "react";
import { getStudentPortfolio } from "@/lib/portfolio/detail";
import { fetchObservations, sortObservationsForPortfolio, type TeacherObservation } from "@/lib/observations/actions";
import { exportPortfoliosBulk } from "@/lib/export/bulk-portfolio-export";
import type { StudentDirectoryRow } from "@/lib/portfolio/directory";

// 교사가 학생 여러 명의 포트폴리오를 한 번에 내보내는 dialog. "전체"가 곧바로
// 학교 전체를 뜻하지 않도록, 대상 범위(지도 학생/현재 필터 결과/선택한 학생)를
// 항상 화면에서 명시적으로 고르게 한다. 실제 문서 생성은 기존
// buildFullPortfolioPDFBytes(단일 학생 renderer)를 그대로 재사용하는
// exportPortfoliosBulk에 위임한다 — 여기서 새 렌더러를 만들지 않는다.

// 학생 1명당 getStudentPortfolio가 여러 쿼리를 순차 실행하므로, 한 번에 너무
// 많은 학생을 브라우저에서 동시에 처리하면 부담이 크다. 배경 job 없이 안전하게
// 처리할 수 있는 현실적인 상한선을 둔다(요청사항: 임의의 작은 숫자를 하드코딩하지
// 말라고 했지만, 완전 무제한도 위험하므로 "한 화면에서 다룰 법한 지도 인원 규모"인
// 80명을 상한으로 둔다 — 이보다 많으면 필터/선택으로 범위를 좁히도록 안내한다).
const MAX_BULK_EXPORT = 80;
const CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type Scope = "guided" | "filtered" | "selected";

export function BulkPortfolioExportDialog({
  guidedStudents,
  filteredStudents,
  selectedStudents,
  academicYear,
  currentTeacherId,
  onClose,
}: {
  guidedStudents: StudentDirectoryRow[];
  filteredStudents: StudentDirectoryRow[];
  selectedStudents: StudentDirectoryRow[];
  academicYear: string | null;
  /** 이 화면은 항상 교사/관리자 전용(students/page.tsx가 isTeacherOrAdmin으로 이미
   * 접근을 막는다)이라 별도 조건 없이 항상 "교사 관찰 기록"을 학생별로 조회해 각자의
   * 포트폴리오 맨 마지막에 넣는다. */
  currentTeacherId: string;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>(selectedStudents.length > 0 ? "selected" : "guided");
  const [format, setFormat] = useState<"pdf" | "zip">("zip");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ warnings: string[]; exportedCount: number } | null>(null);

  const scopeStudents: Record<Scope, StudentDirectoryRow[]> = {
    guided: guidedStudents,
    filtered: filteredStudents,
    selected: selectedStudents,
  };
  const targets = scopeStudents[scope];
  const overLimit = targets.length > MAX_BULK_EXPORT;

  const handleExport = async () => {
    if (targets.length === 0 || overLimit) return;
    setRunning(true);
    setResult(null);
    setProgress({ done: 0, total: targets.length });
    try {
      let done = 0;
      const observationsByStudent: Record<string, TeacherObservation[]> = {};
      const portfolios = await mapWithConcurrency(targets, CONCURRENCY, async (row) => {
        const [p, obs] = await Promise.all([getStudentPortfolio(row.id, academicYear), fetchObservations(row.id, currentTeacherId)]);
        observationsByStudent[row.id] = sortObservationsForPortfolio(obs);
        done++;
        setProgress({ done, total: targets.length });
        return p;
      });
      const res = await exportPortfoliosBulk(portfolios, format, observationsByStudent);
      setResult(res);
      if (res.warnings.length === 0) onClose();
    } catch (e) {
      console.error("일괄 포트폴리오 내보내기 실패:", e);
      alert("내보내기 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-semibold text-slate-900">포트폴리오 일괄 내보내기</h2>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">대상</p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" checked={scope === "guided"} onChange={() => setScope("guided")} />
            현재 지도 학생 {guidedStudents.length}명
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" checked={scope === "filtered"} onChange={() => setScope("filtered")} />
            현재 필터 결과 {filteredStudents.length}명
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" checked={scope === "selected"} disabled={selectedStudents.length === 0} onChange={() => setScope("selected")} />
            직접 선택한 학생 {selectedStudents.length}명
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">형식</p>
          <div className="flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={format === "pdf"} onChange={() => setFormat("pdf")} />
              통합 PDF
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={format === "zip"} onChange={() => setFormat("zip")} />
              ZIP (학생별 PDF)
            </label>
          </div>
        </div>

        {overLimit && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            선택된 {targets.length}명이 한 번에 처리 가능한 상한({MAX_BULK_EXPORT}명)을 넘었습니다. 필터나 선택 범위를 좁혀주세요.
          </p>
        )}

        {progress && (
          <p className="text-xs text-slate-500">
            포트폴리오 생성 중... {progress.done}/{progress.total}
          </p>
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
            disabled={running || targets.length === 0 || overLimit}
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
