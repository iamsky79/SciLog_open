"use client";

import { useEffect, useState } from "react";
import { teamPeriodLabel } from "@/lib/period";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Pencil, Lock } from "lucide-react";
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
import { admissionYearFromUsername } from "@/lib/grade";
import { summarizeMemberNames } from "@/lib/members";
import type { ProjectExportContext } from "@/lib/submissions/hub";
import type { PlanStatus, ResearchPlan, ResearchReport, Team, TeamMember } from "@/lib/database.types";
import {
  fetchPortfolioPayload,
  fetchReferencesPayload,
} from "@/lib/export/build-payloads";
import { generateReferencesExportDOCX, generateReferencesExportPDF } from "@/lib/export/render-references";
import { generatePortfolioExportDOCX, generatePortfolioExportPDF } from "@/lib/export/render-portfolio";

interface MemberRow extends TeamMember {
  displayName: string;
}

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

export default function ClubTeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = params.id;
  const { userId, profile, loading: authLoading } = useAuth();

  // "제출물" 허브 등 외부에서 ?tab=plan|logs|report|docs|mine, ?log=<id>, ?compose=1로
  // 정확한 탭/항목까지 딥링크할 수 있게 한다. 원본 화면은 그대로 두고 진입 시점만 다르다.
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const focusLogId = searchParams.get("log");

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [planStat, setPlanStat] = useState<{ status: PlanStatus; date: string | null } | null>(null);
  const [reportStat, setReportStat] = useState<{ status: PlanStatus; date: string | null } | null>(null);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [refCount, setRefCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<SummaryTabValue>(
    initialTab === "plan" || initialTab === "logs" || initialTab === "report" || initialTab === "docs" || initialTab === "mine"
      ? initialTab
      : "logs"
  );
  const [showCompose, setShowCompose] = useState(searchParams.get("compose") === "1");
  const [portfolioExportSubject, setPortfolioExportSubject] = useState<{ id: string; name: string } | null>(null);

  const load = async () => {
    const supabase = createClient();
    setLoading(true);

    const { data: teamData } = await supabase.from("teams").select("*").eq("id", teamId).single();
    const teamRow = (teamData as Team) ?? null;
    setTeam(teamRow);

    const [{ data: memberRows }, { data: planRow }, { data: reportRow }, { count: refCountResult }] = await Promise.all([
      supabase.from("team_members").select("*").eq("team_id", teamId).order("joined_at", { ascending: true }),
      supabase.from("research_plans").select("status, submitted_at").eq("team_id", teamId).eq("entity_type", "club").maybeSingle(),
      supabase.from("research_reports").select("status, submitted_at").eq("team_id", teamId).eq("entity_type", "club").maybeSingle(),
      supabase.from("references").select("id", { count: "exact", head: true }).eq("entity_type", "club").eq("entity_id", teamId),
    ]);
    setPlanStat(planRow ? { status: (planRow as ResearchPlan).status, date: (planRow as ResearchPlan).submitted_at } : null);
    setReportStat(reportRow ? { status: (reportRow as ResearchReport).status, date: (reportRow as ResearchReport).submitted_at } : null);
    setRefCount(refCountResult ?? 0);

    const rows = (memberRows as TeamMember[]) ?? [];
    const studentIds = rows.map((r) => r.student_id);
    let displayMap: Record<string, string> = {};
    if (studentIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, name, username").in("id", studentIds);
      displayMap = Object.fromEntries((users ?? []).map((u) => [u.id, (u.username as string | null) ?? u.name]));
    }
    setMembers(rows.map((r) => ({ ...r, displayName: displayMap[r.student_id] ?? "알 수 없음" })));

    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || !teamId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, teamId]);

  if (loading || authLoading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (!team) return <p className="text-sm text-slate-400">동아리를 찾을 수 없습니다.</p>;

  const canReview =
    profile != null &&
    (profile.is_admin || (profile.role === "teacher" && team.teacher_id === userId));
  const isMember = members.some((m) => m.student_id === userId);
  const canExport = isMember || profile?.is_admin || profile?.role === "teacher";

  const gradeSourceUsername = members.find((m) => m.student_id === userId)?.displayName ?? members[0]?.displayName ?? null;
  const admissionYear = admissionYearFromUsername(gradeSourceUsername);
  const gradeNum = team.school_year && admissionYear != null ? parseInt(team.school_year, 10) - admissionYear + 1 : null;
  const periodLabel = teamPeriodLabel(team.school_year, team.semester, gradeNum);
  const { summary: memberSummary, full: memberFull } = summarizeMemberNames(members.map((m) => m.displayName));

  const recordSubjects = isMember
    ? [{ id: userId as string, name: profile?.name ?? "나" }]
    : canReview
    ? members.map((m) => ({ id: m.student_id, name: m.displayName }))
    : [];

  const exportCtx = {
    entityKind: "club" as const,
    entityId: team.id,
    entityName: team.name,
    teamId: team.id,
    periodLabel,
    teacherId: team.teacher_id,
    memberNames: members.map((m) => m.displayName),
  };

  const projectExportCtx: ProjectExportContext = {
    activityKind: "동아리",
    teamId: team.id,
    individualId: null,
    schoolYear: team.school_year,
    projectName: team.name,
    studentNames: members.map((m) => m.displayName),
    basePath: `/club/${team.id}`,
  };

  const handleExportReferences = async (format: "pdf" | "docx") => {
    const payload = await fetchReferencesPayload(exportCtx);
    if (format === "pdf") await generateReferencesExportPDF(payload);
    else await generateReferencesExportDOCX(payload);
  };
  const handleExportPortfolio = (subject: { id: string; name: string }) => async (format: "pdf" | "docx") => {
    const payload = await fetchPortfolioPayload({
      ...exportCtx,
      studentId: subject.id,
      subjectName: subject.name,
      personalRecordEntityKind: "club",
    });
    if (format === "pdf") await generatePortfolioExportPDF(payload, "club");
    else await generatePortfolioExportDOCX(payload, "club");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">{team.name}</h1>
          {periodLabel && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-sm text-slate-600">{periodLabel}</span>
            </>
          )}
          {memberSummary && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-sm text-slate-600" title={memberFull}>{memberSummary}</span>
            </>
          )}
          <span className="text-slate-300">·</span>
          <SharedDocSection
            entityType="club"
            entityId={team.id}
            initialUrl={team.shared_doc_url ?? null}
            canEdit={isMember || canReview}
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(isMember || canReview) && (
              <button type="button" onClick={() => { setActiveTab("logs"); setShowCompose(true); }}
                className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
                + 연구일지 작성
              </button>
            )}
            {canExport && <ProjectExportButton ctx={projectExportCtx} />}
            {profile?.is_admin && (
              <Link href={`/club/${teamId}/edit`}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                <Pencil className="h-4 w-4" />
                팀 수정
              </Link>
            )}
          </div>
        </div>

      {(isMember || canReview) && (
        <SummaryTabBar
          activeTab={activeTab}
          onChange={setActiveTab}
          planStatusText={CARD_STATUS[planStat?.status ?? "draft"].text}
          planDate={fmtDate(planStat?.date ?? null)}
          logCount={logStats?.total ?? 0}
          recentDate={logStats?.recentDate ? fmtDate(logStats.recentDate) : undefined}
          reportStatusText={CARD_STATUS[reportStat?.status ?? "draft"].text}
          reportDate={fmtDate(reportStat?.date ?? null)}
          refCount={refCount}
        />
      )}

      {activeTab === "plan" && userId && (isMember || canReview) && (
        <PlanSection
          entityType="club"
          entityId={team.id}
          teamId={team.id}
          currentUserId={userId}
          canEdit={isMember}
          canReview={canReview}
          entityName={team.name}
          exportCtx={projectExportCtx}
          onChanged={load}
        />
      )}

      {activeTab === "logs" && userId && (isMember || canReview) && (
        <JournalTimeline
          entityType="team"
          entityId={team.id}
          currentUserId={userId}
          canReview={canReview}
          members={members.map((m) => ({ id: m.student_id, name: m.displayName }))}
          showCompose={showCompose}
          onOpenCompose={() => setShowCompose(true)}
          onCloseCompose={() => setShowCompose(false)}
          onStats={setLogStats}
          focusLogId={focusLogId}
          exportCtx={projectExportCtx}
        />
      )}

      {activeTab === "report" && userId && (isMember || canReview) && (
        <ReportSection
          entityType="club"
          entityId={team.id}
          teamId={team.id}
          currentUserId={userId}
          canEdit={isMember}
          canReview={canReview}
          entityName={team.name}
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
            entityType="club"
            entityId={team.id}
            currentUserId={userId}
            entityName={team.name}
            schoolYear={team.school_year}
          />
        </>
      )}

      {activeTab === "mine" && userId && recordSubjects.length > 0 && (
        <div className="space-y-6">
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Lock className="h-3 w-3" /> 본인 + 교사/관리자만 열람
          </p>
          {recordSubjects.map((subject) => (
            <div key={subject.id} className="space-y-3">
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPortfolioExportSubject(subject)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  프로젝트 포트폴리오
                </button>
                <ExportMenu onExport={handleExportPortfolio(subject)} label="포트폴리오 내보내기" size="xs" />
              </div>
              <MyRoleActivitySummary
                entityType="team"
                entityId={team.id}
                studentId={subject.id}
                studentName={subject.id !== userId ? subject.name : undefined}
              />
              <ActivityLogSection
                entityType="team"
                entityId={team.id}
                currentUserId={userId}
                canReview={canReview}
                logType="personal"
                authorFilter={subject.id}
                hideFilterTabs
                title={subject.id !== userId ? `${subject.name}의 개인 일지` : "개인 일지"}
              />
              <PersonalRecordSection
                entityType="club"
                entityId={team.id}
                studentId={subject.id}
                studentName={subject.id !== userId ? subject.name : undefined}
                readOnly={subject.id !== userId}
              />
            </div>
          ))}
        </div>
      )}

      {portfolioExportSubject && (
        <PortfolioExportDialog
          studentId={portfolioExportSubject.id}
          initialAcademicYear={null}
          yearOptions={[]}
          lockedActivityKey={`club-${team.id}`}
          onClose={() => setPortfolioExportSubject(null)}
        />
      )}
    </div>
  );
}
