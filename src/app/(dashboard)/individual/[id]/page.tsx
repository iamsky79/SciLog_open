"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { SharedDocSection } from "@/components/SharedDocSection";
import { ReferencesSection } from "@/components/ReferencesSection";
import { PlanSection } from "@/components/PlanSection";
import { ReportSection } from "@/components/ReportSection";
import { PersonalRecordSection } from "@/components/PersonalRecordSection";
import { MyRoleActivitySummary } from "@/components/MyRoleActivitySummary";
import { ActivityLogSection } from "@/components/ActivityLogSection";
import { JournalTimeline } from "@/components/JournalTimeline";
import { SummaryTabBar, type SummaryTabValue } from "@/components/SummaryTabBar";
import { ExportMenu } from "@/components/ExportMenu";
import { ProjectExportButton } from "@/components/submissions/ProjectExportButton";
import { PortfolioExportDialog } from "@/components/portfolio/PortfolioExportDialog";
import { isSubmissionPdfValue, extractSubmissionPdfPath } from "@/lib/uploads/submissionPdf";
import type { ProjectExportContext } from "@/lib/submissions/hub";
import type { IndividualResearch, PlanStatus, ResearchReport } from "@/lib/database.types";
import {
  fetchPortfolioPayload,
  fetchReferencesPayload,
} from "@/lib/export/build-payloads";
import { generateReferencesExportDOCX, generateReferencesExportPDF } from "@/lib/export/render-references";
import { generatePortfolioExportDOCX, generatePortfolioExportPDF } from "@/lib/export/render-portfolio";

const termLabel: Record<string, string> = {
  "1-2": "1학년 2학기",
  "2-1": "2학년 1학기",
  "2-2": "2학년 2학기",
  "3-1": "3학년 1학기",
};

interface LogStats {
  total: number;
  recentDate: string | null;
  rejectedMine: number;
  pendingReview: number;
  todayCount: number;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

const CARD_STATUS: Record<PlanStatus, { text: string; cls: string }> = {
  draft: { text: "작성 전", cls: "text-slate-400" },
  submitted: { text: "검토 중", cls: "text-amber-600" },
  approved: { text: "✓ 승인 완료", cls: "text-green-600" },
  rejected: { text: "반려됨", cls: "text-red-500" },
  historical: { text: "과거 기록", cls: "text-slate-500" },
};

export default function IndividualResearchDetailPage() {
  const params = useParams<{ id: string }>();
  const researchId = params.id;
  const { userId, profile, loading: authLoading } = useAuth();
  const router = useRouter();

  // "제출물" 허브 등 외부에서 ?tab=plan|logs|report|docs|mine, ?log=<id>, ?compose=1로
  // 정확한 탭/항목까지 딥링크할 수 있게 한다. 원본 화면은 그대로 두고 진입 시점만 다르다.
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const focusLogId = searchParams.get("log");

  const [research, setResearch] = useState<IndividualResearch | null>(null);
  const [reportStat, setReportStat] = useState<{ status: PlanStatus; date: string | null } | null>(null);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [refCount, setRefCount] = useState(0);
  const [studentName, setStudentName] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showProjectPortfolio, setShowProjectPortfolio] = useState(false);

  const [activeTab, setActiveTab] = useState<SummaryTabValue>(
    initialTab === "plan" || initialTab === "logs" || initialTab === "report" || initialTab === "docs" || initialTab === "mine"
      ? initialTab
      : "logs"
  );
  const [showCompose, setShowCompose] = useState(searchParams.get("compose") === "1");

  const load = async () => {
    const supabase = createClient();
    setLoading(true);

    const { data: researchData } = await supabase.from("individual_research").select("*").eq("id", researchId).single();
    const row = (researchData as IndividualResearch) ?? null;
    setResearch(row);

    if (row) {
      const [{ data: studentRow }, { data: rptRow }, { count: refCountResult }] = await Promise.all([
        supabase.from("users").select("name").eq("id", row.student_id).single(),
        supabase.from("research_reports").select("status, submitted_at").eq("entity_type", "individual").eq("entity_id", researchId).maybeSingle(),
        supabase.from("references").select("id", { count: "exact", head: true }).eq("entity_type", "individual").eq("entity_id", researchId),
      ]);
      setStudentName(studentRow?.name ?? "알 수 없음");
      setReportStat(rptRow ? { status: (rptRow as ResearchReport).status, date: (rptRow as ResearchReport).submitted_at } : null);
      setRefCount(refCountResult ?? 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || !researchId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, researchId]);

  const handleDeleteResearch = async () => {
    if (!research) return;
    setDeleting(true);
    const supabase = createClient();

    const { data: logs } = await supabase.from("activity_logs")
      .select("file_urls").eq("entity_type", "individual").eq("entity_id", researchId);
    const { data: reports } = await supabase.from("research_reports")
      .select("file_url,extra_file_urls").eq("entity_type", "individual").eq("entity_id", researchId);

    await Promise.all([
      supabase.from("activity_logs").delete().eq("entity_type", "individual").eq("entity_id", researchId),
      supabase.from("research_plans").delete().eq("entity_type", "individual").eq("entity_id", researchId),
      supabase.from("research_reports").delete().eq("entity_type", "individual").eq("entity_id", researchId),
      supabase.from("personal_records").delete().eq("entity_type", "individual").eq("entity_id", researchId),
    ]);
    await supabase.from("individual_research").delete().eq("id", researchId);

    const actFiles = (logs ?? []).flatMap((l: { file_urls: string[] }) =>
      (l.file_urls ?? []).map((u: string) => {
        const m = u.match(/\/object\/public\/activity-files\/(.+?)(?:\?|$)/);
        return m ? m[1] : null;
      }).filter(Boolean) as string[]
    );
    // 결과보고서 본문 파일(submission-pdfs, private)과 추가 자료(reports, public)는
    // 서로 다른 버킷에 있다 — file_url이 submission-pdfs 값(path 또는 그 버킷의
    // 레거시 공개 URL)인지 먼저 구분해서 맞는 버킷으로 보낸다.
    const submissionPdfPaths: string[] = [];
    const repFiles: string[] = [];
    for (const r of (reports ?? []) as { file_url: string | null; extra_file_urls: string[] }[]) {
      if (r.file_url) {
        if (isSubmissionPdfValue(r.file_url)) {
          submissionPdfPaths.push(extractSubmissionPdfPath(r.file_url));
        } else {
          const m = r.file_url.match(/\/object\/public\/reports\/(.+?)(?:\?|$)/);
          if (m) repFiles.push(m[1]);
        }
      }
      for (const u of r.extra_file_urls ?? []) {
        const m = u.match(/\/object\/public\/reports\/(.+?)(?:\?|$)/);
        if (m) repFiles.push(m[1]);
      }
    }
    if (actFiles.length > 0) await supabase.storage.from("activity-files").remove(actFiles);
    if (repFiles.length > 0) await supabase.storage.from("reports").remove(repFiles);
    if (submissionPdfPaths.length > 0) await supabase.storage.from("submission-pdfs").remove(submissionPdfPaths);

    setDeleting(false);
    setConfirmDelete(false);
    router.push("/dashboard");
  };

  if (loading || authLoading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (!research) return <p className="text-sm text-slate-400">연구를 찾을 수 없습니다.</p>;

  const canReview = profile != null &&
    (profile.is_admin || (profile.role === "teacher" && research.teacher_id === userId));
  const canEdit = research.student_id === userId;
  const periodLabel = research.year
    ? `${research.year}학년도 (${termLabel[research.semester] ?? research.semester})`
    : (termLabel[research.semester] ?? research.semester);

  const exportCtx = {
    entityKind: "individual" as const,
    entityId: research.id,
    entityName: research.title,
    teamId: null,
    periodLabel,
    teacherId: research.teacher_id,
    studentName,
  };

  const projectExportCtx: ProjectExportContext = {
    activityKind: "창의개인연구",
    teamId: null,
    individualId: research.id,
    schoolYear: research.year != null ? String(research.year) : null,
    projectName: research.title,
    studentNames: [studentName],
    basePath: `/individual/${research.id}`,
  };

  const handleExportReferences = async (format: "pdf" | "docx") => {
    const payload = await fetchReferencesPayload(exportCtx);
    if (format === "pdf") await generateReferencesExportPDF(payload);
    else await generateReferencesExportDOCX(payload);
  };
  const handleExportPortfolio = async (format: "pdf" | "docx") => {
    const payload = await fetchPortfolioPayload({
      ...exportCtx,
      studentId: research.student_id,
      subjectName: studentName,
      personalRecordEntityKind: "individual",
    });
    if (format === "pdf") await generatePortfolioExportPDF(payload, "individual");
    else await generatePortfolioExportDOCX(payload, "individual");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">{research.title}</h1>
          <span className="text-slate-300">·</span>
          <span className="text-sm text-slate-600">{periodLabel}</span>
          <span className="text-slate-300">·</span>
          <span className="text-sm text-slate-600">{studentName}</span>
          <span className="text-slate-300">·</span>
          <SharedDocSection
            entityType="individual"
            entityId={research.id}
            initialUrl={research.shared_doc_url ?? null}
            canEdit={canEdit || canReview}
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canEdit && (
              <button type="button" onClick={() => { setActiveTab("logs"); setShowCompose(true); }}
                className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
                + 연구일지 작성
              </button>
            )}
            <ProjectExportButton ctx={projectExportCtx} />
            <button
              type="button"
              onClick={() => setShowProjectPortfolio(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              프로젝트 포트폴리오
            </button>
            {canEdit && research.plan_status !== "approved" && reportStat?.status !== "approved" && (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">
                연구 삭제
              </button>
            )}
        </div>
      </div>

      {(canEdit || canReview) && (
        <SummaryTabBar
          activeTab={activeTab}
          onChange={setActiveTab}
          planStatusText={CARD_STATUS[research.plan_status ?? "draft"].text}
          planDate={fmtDate(research.plan_submitted_at)}
          logCount={logStats?.total ?? 0}
          recentDate={logStats?.recentDate ? fmtDate(logStats.recentDate) : undefined}
          reportStatusText={CARD_STATUS[reportStat?.status ?? "draft"].text}
          reportDate={fmtDate(reportStat?.date ?? null)}
          refCount={refCount}
        />
      )}

      {activeTab === "plan" && userId && (canEdit || canReview) && (
        <PlanSection
          entityType="individual"
          entityId={research.id}
          teamId={null}
          currentUserId={userId}
          canEdit={canEdit}
          canReview={canReview}
          entityName={research.title}
          exportCtx={projectExportCtx}
          onChanged={load}
        />
      )}

      {activeTab === "logs" && userId && (canEdit || canReview) && (
        <JournalTimeline
          entityType="individual"
          entityId={research.id}
          currentUserId={userId}
          canReview={canReview}
          members={[]}
          showCompose={showCompose}
          onOpenCompose={() => setShowCompose(true)}
          onCloseCompose={() => setShowCompose(false)}
          onStats={setLogStats}
          focusLogId={focusLogId}
          exportCtx={projectExportCtx}
        />
      )}

      {activeTab === "report" && userId && (canEdit || canReview) && (
        <ReportSection
          entityType="individual"
          entityId={research.id}
          teamId={null}
          currentUserId={userId}
          canEdit={canEdit}
          canReview={canReview}
          entityName={research.title}
          exportCtx={projectExportCtx}
          onChanged={load}
        />
      )}

      {activeTab === "docs" && userId && (
        <>
          <div className="flex justify-end">
            <ExportMenu onExport={handleExportReferences} />
          </div>
          <ReferencesSection
            entityType="individual"
            entityId={research.id}
            currentUserId={userId}
            entityName={research.title}
            schoolYear={research.year?.toString()}
          />
        </>
      )}

      {activeTab === "mine" && userId && (canEdit || canReview) && (
        <div className="space-y-6">
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Lock className="h-3 w-3" /> 본인 + 교사/관리자만 열람
          </p>
          <div className="flex justify-end">
            <ExportMenu onExport={handleExportPortfolio} label="포트폴리오 내보내기" size="xs" />
          </div>
          <MyRoleActivitySummary
            entityType="individual"
            entityId={research.id}
            studentId={research.student_id}
          />
          <ActivityLogSection
            entityType="individual"
            entityId={research.id}
            currentUserId={userId}
            canReview={canReview}
            logType="personal"
            authorFilter={research.student_id}
            hideFilterTabs
            title="개인 일지"
          />
          <PersonalRecordSection
            entityType="individual"
            entityId={research.id}
            studentId={research.student_id}
            readOnly={!canEdit}
          />
        </div>
      )}

      {showProjectPortfolio && (
        <PortfolioExportDialog
          studentId={research.student_id}
          initialAcademicYear={null}
          yearOptions={[]}
          lockedActivityKey={`individual-${research.id}`}
          onClose={() => setShowProjectPortfolio(false)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">연구 삭제</h2>
            <p className="text-sm text-slate-600">
              삭제하면 모든 활동 기록과 첨부파일이 함께 삭제됩니다. 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                취소
              </button>
              <button type="button" onClick={handleDeleteResearch} disabled={deleting}
                className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60">
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
