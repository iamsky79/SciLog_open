"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Brain, Lock, Download } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import type { AiAnalysis } from "@/lib/database.types";
import { getStudentPortfolio, type StudentPortfolio } from "@/lib/portfolio/detail";
import { fetchTeachingRelations, type TeachingActivityKind } from "@/lib/portfolio/teaching";
import { fetchObservations, type TeacherObservation } from "@/lib/observations/actions";
import { StudentPortfolioView } from "@/components/portfolio/StudentPortfolioView";
import { TeacherManagementPanel } from "@/components/portfolio/TeacherManagementPanel";
import { TeacherObservationsSection } from "@/components/portfolio/TeacherObservationsSection";
import { PortfolioExportDialog } from "@/components/portfolio/PortfolioExportDialog";

// 학생 본인이 자신의 포트폴리오를 열 때(/portfolio)와 교사가 이 학생의 포트폴리오를
// 열 때(이 페이지) 핵심 내용은 완전히 같은 data builder(getStudentPortfolio)와
// 뷰 컴포넌트(StudentPortfolioView)를 그대로 쓴다. 이 페이지에서 추가하는 것은
// "교사 전용 관리 정보"(TeacherManagementPanel)와 AI 연구 분석뿐이다.

export default function StudentPortfolioPage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id;
  const { userId, profile, loading: authLoading } = useAuth();

  const isTeacherOrAdmin = profile != null && (profile.is_admin || profile.role === "teacher");
  const isSelf = userId === studentId;
  const canView = isTeacherOrAdmin || isSelf;

  const [portfolio, setPortfolio] = useState<StudentPortfolio | null>(null);
  const [teachingKinds, setTeachingKinds] = useState<TeachingActivityKind[]>([]);
  const [observations, setObservations] = useState<TeacherObservation[]>([]);
  const [academicYear, setAcademicYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExport, setShowExport] = useState(false);

  const [latestAnalysis, setLatestAnalysis] = useState<AiAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);


  useEffect(() => {
    if (authLoading || !studentId || !canView) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await getStudentPortfolio(studentId, academicYear);
      if (cancelled) return;
      setPortfolio(data);

      if (isTeacherOrAdmin && !isSelf && userId) {
        const relations = await fetchTeachingRelations(userId, academicYear);
        if (!cancelled) setTeachingKinds([...(relations.get(studentId) ?? [])]);
      }

      // 교사 관찰 기록 — 학생 본인 화면/포트폴리오 data builder(getStudentPortfolio)에는
      // 절대 섞이지 않도록 여기서만 별도 조회한다. RLS(039_teacher_observations.sql)가
      // 지도 관계 없는 교사/학생을 이미 차단하므로, 여기서 따로 권한 검사를 다시 하지 않는다.
      if (isTeacherOrAdmin && userId) {
        const obs = await fetchObservations(studentId, userId);
        if (!cancelled) setObservations(obs);
      } else if (!cancelled) {
        setObservations([]);
      }

      if (isTeacherOrAdmin) {
        const supabase = createClient();
        const { data: analysisRow } = await supabase
          .from("ai_analyses")
          .select("*")
          .eq("student_id", studentId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled) setLatestAnalysis((analysisRow as AiAnalysis) ?? null);
      }

      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, studentId, academicYear, canView, isTeacherOrAdmin, isSelf, userId]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/ai/analyze-student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setAnalyzeError(err?.error ?? `분석 실패 (HTTP ${res.status})`);
      } else {
        const data = await res.json();
        setLatestAnalysis(data.analysis as AiAnalysis);
      }
    } catch {
      setAnalyzeError("네트워크 오류가 발생했습니다.");
    }
    setAnalyzing(false);
  };

  if (authLoading || loading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (!canView) return <p className="text-sm text-slate-500">본인 포트폴리오만 볼 수 있습니다.</p>;
  if (!portfolio) return <p className="text-sm text-slate-400">학생을 찾을 수 없습니다.</p>;

  // "전체 검토" 개념을 없앴으므로, 관리자도 실제 승인 액션이 가능한 화면(제출물
  // 관리)으로 보낸다 — 집계 전용인 /admin/submissions로 보내면 여기서 눌러도
  // 다시 액션을 못 하는 화면으로 가게 된다.
  const reviewHref = "/archive?view=review";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{portfolio.student.name} 포트폴리오</h1>
        {/* 이전 구현은 화면을 html2canvas로 스크린샷 → 이미지로 PDF에 붙이는 방식이라
            캡처 실패(cross-origin tainted canvas 등)가 조용히 삼켜지곤 했다. 학생 "내
            포트폴리오"와 완전히 같은 구조화 데이터 기반 dialog/renderer를 쓰고, dialog가
            매번 이 studentId로 getStudentPortfolio를 새로 호출하므로 다른 학생을 조회했던
            이전 상태가 섞여 들어올 수 없다. */}
        <button
          type="button"
          onClick={() => setShowExport(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" />
          포트폴리오 내보내기
        </button>
      </div>

      {isTeacherOrAdmin && !isSelf && (
        <TeacherManagementPanel teachingKinds={teachingKinds} management={portfolio.management} reviewHref={reviewHref} />
      )}

      <StudentPortfolioView portfolio={portfolio} academicYear={academicYear} onAcademicYearChange={setAcademicYear} />

      {isTeacherOrAdmin && <TeacherObservationsSection observations={observations} />}

      {isTeacherOrAdmin && (
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            <h2 className="text-base font-semibold text-slate-900">AI 연구 분석</h2>
            <span className="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              <Lock className="h-3 w-3" />
              교사/관리자 전용
            </span>
          </div>

          {latestAnalysis && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-slate-400">
                마지막 분석:{" "}
                {new Date(latestAnalysis.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
              </p>
              <AnalysisSection label="진로 방향 및 관심 분야" content={latestAnalysis.content.career_direction} />
              <AnalysisSection label="연구 강점" content={latestAnalysis.content.strengths} />
              <AnalysisSection label="약점 및 보완점" content={latestAnalysis.content.weaknesses} />
              <AnalysisSection label="앞으로의 연구 방향" content={latestAnalysis.content.future_direction} />
              <AnalysisSection label="지도 시 주목할 점" content={latestAnalysis.content.guidance_points} />
            </div>
          )}

          {analyzeError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{analyzeError}</p>
          )}

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing}
            className="flex items-center gap-2 rounded-lg bg-purple-500 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-600 disabled:opacity-60"
          >
            <Brain className="h-4 w-4" />
            {analyzing ? "분석 중..." : latestAnalysis ? "다시 분석하기" : "분석 생성하기"}
          </button>
        </Card>
      )}

      {showExport && (
        <PortfolioExportDialog
          studentId={studentId}
          initialAcademicYear={academicYear}
          yearOptions={portfolio.yearOptions}
          currentTeacherId={isTeacherOrAdmin && userId ? userId : undefined}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

function AnalysisSection({ label, content }: { label: string; content: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{content}</p>
    </div>
  );
}
