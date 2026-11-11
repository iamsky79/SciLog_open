"use client";

import { useState } from "react";
import { getStudentPortfolio } from "@/lib/portfolio/detail";
import type { PortfolioTypeKey } from "@/lib/portfolio/detail";
import { fetchObservations, sortObservationsForPortfolio, type TeacherObservation } from "@/lib/observations/actions";
import {
  generateFullPortfolioPDF,
  generateFullPortfolioDOCX,
  buildPortfolioZipBlob,
  hasExportableContent,
  portfolioFileBaseName,
  DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  type PortfolioExportOptions,
} from "@/lib/export/render-full-portfolio";

// 학생 "내 포트폴리오"와 교사 "학생 포트폴리오"가 완전히 같은 dialog shell을 쓴다 —
// 차이는 어떤 studentId를 조회하느냐뿐이다(별도 학생용/교사용 dialog를 복제하지 않음).
// 학년도를 dialog에서 바꾸면 getStudentPortfolio를 그 학년도로 다시 조회한다 —
// 화면에 이미 떠 있는 portfolio 객체를 그대로 재사용하지 않으므로, 학생 A를
// 내보낸 뒤 dialog를 다시 열어 학생 B를 내보내도(같은 컴포넌트 인스턴스가 아니라
// studentId만 바뀐 새 인스턴스이므로) 이전 학생 데이터가 섞일 수 없다.
//
// "출력 형식"(PDF/Word)과 "원본 첨부파일까지 함께 받기"는 서로 다른 축이다 —
// 원본 첨부는 xlsx/csv/jpg 등을 PDF/DOCX 안에 넣을 수 없어, 이 옵션이 켜지면
// 선택한 형식과 무관하게 항상 ZIP으로 묶어서 내려받는다(별도 ZIP 시스템이 아니라
// buildPortfolioZipBlob 하나가 format 인자로 00_포트폴리오 안의 문서 종류만 바꾼다).

const ACTIVITY_OPTIONS: { key: PortfolioTypeKey; label: string }[] = [
  { key: "rne", label: "R&E" },
  { key: "individual", label: "창의개인연구" },
  { key: "club", label: "동아리" },
  { key: "other", label: "기타 활동" },
];

const SECTION_OPTIONS: { key: keyof Omit<PortfolioExportOptions, "activityTypes" | "includeSubmittedPdf" | "includePdfAttachments">; label: string }[] = [
  { key: "includeSummary", label: "활동 요약" },
  { key: "includeProcess", label: "연구 과정 (연구계획서)" },
  { key: "includeLogs", label: "연구일지" },
  { key: "includeRoles", label: "나의 역할" },
  { key: "includeMyRecords", label: "나의 기록" },
  { key: "includeFeedback", label: "학생에게 공개 가능한 교사 피드백" },
  { key: "includeReport", label: "결과보고서 / 성과" },
  { key: "includeAwards", label: "수상 / 발표 기록" },
];

type Format = "pdf" | "docx";
type Sections = Omit<PortfolioExportOptions, "activityTypes" | "includeSubmittedPdf" | "includePdfAttachments">;

export function PortfolioExportDialog({
  studentId,
  initialAcademicYear,
  yearOptions,
  onClose,
  lockedActivityKey,
  currentTeacherId,
}: {
  studentId: string;
  initialAcademicYear: string | null;
  yearOptions: string[];
  onClose: () => void;
  /** 프로젝트 페이지의 "포트폴리오 내보내기"에서 넘어온 activity.key(예: "rne-<teamId>") —
   * 지정되면 이 프로젝트 하나로 고정하고(학년도/활동유형 선택 숨김), includeGlobalOverview=false로
   * export한다. 별도 다이얼로그를 새로 만들지 않고 이 컴포넌트를 그대로 재사용한다. */
  lockedActivityKey?: string;
  /** 교사/관리자가 다른 학생의 포트폴리오를 내보낼 때만 호출부(/student/[id])가 넘겨준다.
   * 값이 있을 때만 "교사 관찰 기록"을 함께 조회해 문서 맨 마지막에 넣는다 — 학생 본인
   * export(/portfolio, 이 prop을 넘기지 않음)에는 절대 섞이지 않는다. 개별 프로젝트
   * export(lockedActivityKey 지정)는 includeGlobalOverview=false라 renderer가 이 section
   * 자체를 그리지 않으므로, 여기서 값이 있어도 실제로는 아무 영향이 없다. */
  currentTeacherId?: string;
}) {
  const locked = !!lockedActivityKey;
  const [academicYear, setAcademicYear] = useState<string | null>(initialAcademicYear);
  const [activityTypes, setActivityTypes] = useState<Set<PortfolioTypeKey>>(new Set(ACTIVITY_OPTIONS.map((o) => o.key)));
  const [sections, setSections] = useState<Sections>(() => ({
    includeSummary: DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeSummary,
    includeProcess: DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeProcess,
    includeLogs: DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeLogs,
    includeRoles: DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeRoles,
    includeMyRecords: DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeMyRecords,
    includeFeedback: DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeFeedback,
    includeReport: DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeReport,
    includeAwards: DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeAwards,
  }));
  const [format, setFormat] = useState<Format>("pdf");
  const [includeSubmittedPdf, setIncludeSubmittedPdf] = useState(DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includeSubmittedPdf);
  const [includePdfAttachments, setIncludePdfAttachments] = useState(DEFAULT_PORTFOLIO_EXPORT_OPTIONS.includePdfAttachments);
  const [includeRawAttachments, setIncludeRawAttachments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const toggleActivity = (key: PortfolioTypeKey) => {
    setActivityTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleSection = (key: keyof Sections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExport = async () => {
    if (activityTypes.size === 0) {
      setError("최소 하나 이상의 활동을 선택해주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      // 프로젝트 고정 모드는 학년도로 걸러지면 안 되므로(다른 학년도 프로젝트일 수 있음)
      // academicYear 필터 없이 조회한 뒤 activities를 이 프로젝트 하나로 좁힌다.
      const fetched = await getStudentPortfolio(studentId, locked ? null : academicYear);
      const portfolio = locked ? { ...fetched, activities: fetched.activities.filter((a) => a.key === lockedActivityKey) } : fetched;
      const options: PortfolioExportOptions = {
        ...sections,
        activityTypes: locked ? ACTIVITY_OPTIONS.map((o) => o.key) : [...activityTypes],
        includeSubmittedPdf: format === "pdf" && includeSubmittedPdf,
        includePdfAttachments: format === "pdf" && includePdfAttachments,
      };
      if (!hasExportableContent(portfolio, options)) {
        setError("선택한 범위에는 내보낼 수 있는 연구 기록이 없습니다.");
        return;
      }

      // 교사가 다른 학생을 내보낼 때만(currentTeacherId 존재) "교사 관찰 기록"을 함께
      // 조회한다 — 학생 본인 export는 이 prop 자체가 없어 항상 빈 배열([])로 넘어간다.
      let observations: TeacherObservation[] = [];
      if (currentTeacherId) {
        const fetched = await fetchObservations(studentId, currentTeacherId);
        observations = sortObservationsForPortfolio(fetched);
      }

      if (includeRawAttachments) {
        const { saveAs } = await import("file-saver");
        const { blob, warnings: zipWarnings } = await buildPortfolioZipBlob(portfolio, format, options, !locked, observations);
        saveAs(blob, `${portfolioFileBaseName(portfolio, !locked)}.zip`);
        if (zipWarnings.length > 0) setWarnings(zipWarnings);
        else onClose();
      } else if (format === "pdf") {
        const { warnings: pdfWarnings } = await generateFullPortfolioPDF(portfolio, options, !locked, observations);
        if (pdfWarnings.length > 0) setWarnings(pdfWarnings);
        else onClose();
      } else {
        await generateFullPortfolioDOCX(portfolio, options, !locked, observations);
        onClose();
      }
    } catch (e) {
      console.error("포트폴리오 내보내기 실패:", e);
      setError("포트폴리오를 생성하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">{locked ? "프로젝트 포트폴리오 내보내기" : "포트폴리오 내보내기"}</h2>

        {!locked && (
          <>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500">학년도</p>
              <select
                value={academicYear ?? "all"}
                onChange={(e) => setAcademicYear(e.target.value === "all" ? null : e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-60"
              >
                <option value="all">전체 학년도</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}학년도
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500">활동</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ACTIVITY_OPTIONS.map((o) => (
                  <label key={o.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input type="checkbox" checked={activityTypes.has(o.key)} onChange={() => toggleActivity(o.key)} disabled={busy} />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500">포함 내용</p>
          <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto pr-1">
            {SECTION_OPTIONS.map((o) => (
              <label key={o.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={sections[o.key]} onChange={() => toggleSection(o.key)} disabled={busy} />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500">출력 형식</p>
          <div className="flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={format === "pdf"} onChange={() => setFormat("pdf")} disabled={busy} />
              PDF
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={format === "docx"} onChange={() => setFormat("docx")} disabled={busy} />
              Word
            </label>
          </div>
        </div>

        {format === "pdf" && (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3">
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={includeSubmittedPdf} onChange={(e) => setIncludeSubmittedPdf(e.target.checked)} disabled={busy} />
              실제 제출 보고서 PDF (연구계획서·결과보고서 원본을 이 PDF 뒤에 병합)
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={includePdfAttachments} onChange={(e) => setIncludePdfAttachments(e.target.checked)} disabled={busy} />
              PDF 첨부자료 (첨부파일 중 PDF인 것도 함께 병합)
            </label>
          </div>
        )}

        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={includeRawAttachments} onChange={(e) => setIncludeRawAttachments(e.target.checked)} disabled={busy} />
          원본 첨부파일까지 함께 받기 (xlsx/csv/이미지 등 원본 보존, ZIP으로 다운로드)
        </label>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {warnings.length > 0 && (
          <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
            취소
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={busy}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
          >
            {busy ? "포트폴리오 생성 중..." : "내보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
