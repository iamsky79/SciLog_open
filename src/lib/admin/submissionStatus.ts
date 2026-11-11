import { createClient } from "@/lib/supabase";
import { deriveReviewPhase, type ReviewPhase } from "@/lib/review/actions";
import type { ReportSchedule, Team, IndividualResearch, ResearchPlan, ResearchReport } from "@/lib/database.types";

// 관리자 "제출 현황" — 새 source of truth를 만들지 않는다. report_schedules(일정) +
// teams/individual_research(대상) + research_plans/research_reports(현재 상태) +
// submission_snapshots(최초 제출 시각)를 그대로 조합해서 계산한다.
//
// "제출 상태"(미제출/기한 내 제출/지각 제출)와 "지도교사 검토 상태"(검토 대기/
// 수정 요청/재검토 필요/승인 완료)는 서로 다른 축이라 하나의 status로 합치지 않는다.
//
// submission_type이 'plan'|'report'인 일정만 팀/개인당 "행 1개"라는 명확한 제출
// 단위가 있어 정확히 집계할 수 있다. 'note'(연구일지)/'registration'(등록 기간)은
// "제출 완료" 개념 자체가 team/individual당 1건으로 떨어지지 않아(연구일지는
// 계속 여러 건 작성되는 구조) 대상 수는 보여주되 제출 현황은 집계하지 않는다
// (trackable=false) — 실제로 계산할 수 없는 걸 억지로 추정하지 않는다.

export type SubmissionStatusKind = "not_submitted" | "on_time" | "late";
export type ScheduleActivityLabel = "R&E" | "동아리" | "창의개인연구" | "전체";

export interface ScheduleStatusRow {
  schedule: ReportSchedule;
  activityLabel: ScheduleActivityLabel;
  trackable: boolean;
  targetCount: number;
  onTime: number;
  late: number;
  missing: number;
  reviewPending: number;
  revisionRequested: number;
  approved: number;
}

export interface ScheduleTargetDetail {
  targetKey: string;
  targetLabel: string;
  teacherId: string | null;
  teacherName: string;
  submissionStatus: SubmissionStatusKind;
  firstSubmittedAt: string | null;
  reviewPhase: ReviewPhase | null;
}

export interface SubmissionStatusFilter {
  /** teams.school_year 또는 individual_research.year 문자열 — portfolio/directory.ts와 같은 개념. */
  academicYear?: string | null;
  teacherId?: string | null;
}

export interface SubmissionFilterOptions {
  teachers: { id: string; name: string }[];
  academicYears: string[];
}

/** 필터 dropdown 채우기용 — 실제 존재하는 교사/학년도만 모은다. */
export async function fetchSubmissionFilterOptions(): Promise<SubmissionFilterOptions> {
  const supabase = createClient();
  const [{ data: teacherRows }, { data: teamRows }, { data: indivRows }] = await Promise.all([
    supabase.from("users").select("id,name").eq("role", "teacher").order("name"),
    supabase.from("teams").select("school_year"),
    supabase.from("individual_research").select("year"),
  ]);
  const years = new Set<string>();
  for (const t of (teamRows ?? []) as { school_year: string | null }[]) if (t.school_year) years.add(t.school_year);
  for (const r of (indivRows ?? []) as { year: number | null }[]) if (r.year != null) years.add(String(r.year));
  return {
    teachers: ((teacherRows ?? []) as { id: string; name: string }[]),
    academicYears: [...years].sort().reverse(),
  };
}

const ACTIVITY_LABEL: Record<string, ScheduleActivityLabel> = { rne: "R&E", club: "동아리", individual: "창의개인연구" };

function isTrackable(submissionType: string | null): boolean {
  return submissionType === "plan" || submissionType === "report";
}

/** 이 일정이 적용되는 (team|individual) 대상 목록을 계산한다 — fetchStudentSchedule과 같은 "적용 범위" 원칙. */
type ResolvedTarget = { kind: "team" | "individual"; id: string; label: string; teacherId: string | null; year: string | null };

async function resolveTargets(
  schedule: ReportSchedule,
  allTeams: Team[],
  allIndividuals: IndividualResearch[],
  filter?: SubmissionStatusFilter
): Promise<ResolvedTarget[]> {
  const targets: ResolvedTarget[] = [];
  const wantsTeamType = (t: "rne" | "club") => !schedule.entity_type || schedule.entity_type === t;
  const wantsIndividual = !schedule.entity_type || schedule.entity_type === "individual";

  if (schedule.entity_id) {
    const team = allTeams.find((t) => t.id === schedule.entity_id);
    if (team) targets.push({ kind: "team", id: team.id, label: team.name, teacherId: team.teacher_id, year: team.school_year });
    else {
      const indiv = allIndividuals.find((r) => r.id === schedule.entity_id);
      if (indiv) targets.push({ kind: "individual", id: indiv.id, label: indiv.title, teacherId: indiv.teacher_id, year: indiv.year != null ? String(indiv.year) : null });
    }
  } else {
    for (const t of allTeams) {
      if ((t.type === "rne" && wantsTeamType("rne")) || (t.type === "club" && wantsTeamType("club"))) {
        targets.push({ kind: "team", id: t.id, label: t.name, teacherId: t.teacher_id, year: t.school_year });
      }
    }
    if (wantsIndividual) {
      for (const r of allIndividuals) targets.push({ kind: "individual", id: r.id, label: r.title, teacherId: r.teacher_id, year: r.year != null ? String(r.year) : null });
    }
  }

  return targets.filter((t) => {
    if (filter?.teacherId && t.teacherId !== filter.teacherId) return false;
    if (filter?.academicYear && t.year !== filter.academicYear) return false;
    return true;
  });
}

function statusOf(row: { status: string } | null, firstSubmittedAt: string | null, deadline: string): SubmissionStatusKind {
  if (!row || row.status === "draft" || !firstSubmittedAt) return "not_submitted";
  return new Date(firstSubmittedAt).getTime() > new Date(deadline).getTime() ? "late" : "on_time";
}

/** 메인 테이블 — schedule마다 대상/제출/검토 집계 한 줄. */
export async function fetchSubmissionStatusOverview(filter?: SubmissionStatusFilter): Promise<ScheduleStatusRow[]> {
  const supabase = createClient();
  const [{ data: scheduleRows }, { data: teamRows }, { data: indivRows }] = await Promise.all([
    supabase.from("report_schedules").select("*").order("deadline", { ascending: true }),
    supabase.from("teams").select("*"),
    supabase.from("individual_research").select("*"),
  ]);
  const schedules = (scheduleRows ?? []) as ReportSchedule[];
  const allTeams = (teamRows ?? []) as Team[];
  const allIndividuals = (indivRows ?? []) as IndividualResearch[];

  const rows: ScheduleStatusRow[] = [];
  for (const schedule of schedules) {
    const activityLabel = schedule.entity_type ? ACTIVITY_LABEL[schedule.entity_type] ?? "전체" : "전체";
    const trackable = isTrackable(schedule.submission_type);
    const targets = await resolveTargets(schedule, allTeams, allIndividuals, filter);
    if ((filter?.teacherId || filter?.academicYear) && targets.length === 0) continue;

    if (!trackable) {
      rows.push({ schedule, activityLabel, trackable, targetCount: targets.length, onTime: 0, late: 0, missing: 0, reviewPending: 0, revisionRequested: 0, approved: 0 });
      continue;
    }

    const teamIds = targets.filter((t) => t.kind === "team").map((t) => t.id);
    const individualIds = targets.filter((t) => t.kind === "individual").map((t) => t.id);

    let onTime = 0,
      late = 0,
      missing = 0,
      reviewPending = 0,
      revisionRequested = 0,
      approved = 0;

    if (schedule.submission_type === "plan") {
      const [{ data: teamPlans }, { data: snaps }] = await Promise.all([
        teamIds.length > 0 ? supabase.from("research_plans").select("id,team_id,status,feedback").in("team_id", teamIds) : Promise.resolve({ data: [] as ResearchPlan[] }),
        supabase.from("submission_snapshots").select("source_table,source_id,submitted_at").in("source_table", ["research_plans", "individual_research"]),
      ]);
      const planByTeam: Record<string, ResearchPlan> = {};
      for (const p of (teamPlans ?? []) as ResearchPlan[]) if (p.team_id) planByTeam[p.team_id] = p;
      const firstSubmitted: Record<string, string> = {};
      for (const s of (snaps ?? []) as { source_table: string; source_id: string; submitted_at: string }[]) {
        const key = `${s.source_table}:${s.source_id}`;
        if (!firstSubmitted[key] || s.submitted_at < firstSubmitted[key]) firstSubmitted[key] = s.submitted_at;
      }
      const indivById: Record<string, IndividualResearch> = {};
      for (const r of allIndividuals) indivById[r.id] = r;

      for (const t of targets) {
        if (t.kind === "team") {
          const plan = planByTeam[t.id] ?? null;
          const firstAt = plan ? firstSubmitted[`research_plans:${plan.id}`] ?? null : null;
          const st = statusOf(plan, firstAt, schedule.deadline);
          if (st === "not_submitted") missing++;
          else if (st === "late") late++;
          else onTime++;
          if (plan) {
            const phase = deriveReviewPhase(plan.status, plan.feedback);
            if (phase === "submitted" || phase === "resubmitted") reviewPending++;
            else if (phase === "revision_requested") revisionRequested++;
            else if (phase === "approved") approved++;
          }
        } else {
          const indiv = indivById[t.id];
          const firstAt = firstSubmitted[`individual_research:${t.id}`] ?? null;
          const st = statusOf(indiv ? { status: indiv.plan_status } : null, firstAt, schedule.deadline);
          if (st === "not_submitted") missing++;
          else if (st === "late") late++;
          else onTime++;
          if (indiv) {
            const phase = deriveReviewPhase(indiv.plan_status, indiv.plan_feedback);
            if (phase === "submitted" || phase === "resubmitted") reviewPending++;
            else if (phase === "revision_requested") revisionRequested++;
            else if (phase === "approved") approved++;
          }
        }
      }
    } else {
      // report
      const orParts: string[] = [];
      if (teamIds.length > 0) orParts.push(`team_id.in.(${teamIds.join(",")})`);
      if (individualIds.length > 0) orParts.push(`and(entity_type.eq.individual,entity_id.in.(${individualIds.join(",")}))`);
      const [{ data: reportRows }, { data: snaps }] = await Promise.all([
        orParts.length > 0 ? supabase.from("research_reports").select("*").or(orParts.join(",")) : Promise.resolve({ data: [] as ResearchReport[] }),
        supabase.from("submission_snapshots").select("source_id,submitted_at").eq("source_table", "research_reports"),
      ]);
      const reports = (reportRows ?? []) as ResearchReport[];
      const reportByTeam: Record<string, ResearchReport> = {};
      const reportByIndividual: Record<string, ResearchReport> = {};
      for (const r of reports) {
        if (r.team_id) reportByTeam[r.team_id] = r;
        else if (r.entity_type === "individual") reportByIndividual[r.entity_id] = r;
      }
      const firstSubmitted: Record<string, string> = {};
      for (const s of (snaps ?? []) as { source_id: string; submitted_at: string }[]) {
        if (!firstSubmitted[s.source_id] || s.submitted_at < firstSubmitted[s.source_id]) firstSubmitted[s.source_id] = s.submitted_at;
      }

      for (const t of targets) {
        const report = t.kind === "team" ? reportByTeam[t.id] : reportByIndividual[t.id];
        const firstAt = report ? firstSubmitted[report.id] ?? null : null;
        const st = statusOf(report, firstAt, schedule.deadline);
        if (st === "not_submitted") missing++;
        else if (st === "late") late++;
        else onTime++;
        if (report) {
          const phase = deriveReviewPhase(report.status, report.feedback);
          if (phase === "submitted" || phase === "resubmitted") reviewPending++;
          else if (phase === "revision_requested") revisionRequested++;
          else if (phase === "approved") approved++;
        }
      }
    }

    rows.push({ schedule, activityLabel, trackable, targetCount: targets.length, onTime, late, missing, reviewPending, revisionRequested, approved });
  }

  return rows;
}

/** [상세] drawer — 이 schedule 하나의 대상별 상태를 전부 보여준다. */
export async function fetchScheduleTargetDetails(schedule: ReportSchedule, filter?: SubmissionStatusFilter): Promise<ScheduleTargetDetail[]> {
  const supabase = createClient();
  const [{ data: teamRows }, { data: indivRows }] = await Promise.all([
    supabase.from("teams").select("*"),
    supabase.from("individual_research").select("*"),
  ]);
  const allTeams = (teamRows ?? []) as Team[];
  const allIndividuals = (indivRows ?? []) as IndividualResearch[];
  const targets = await resolveTargets(schedule, allTeams, allIndividuals, filter);
  if (!isTrackable(schedule.submission_type) || targets.length === 0) return [];

  const teacherIds = [...new Set(targets.map((t) => t.teacherId).filter((id): id is string => !!id))];
  const { data: teacherRows } = teacherIds.length > 0 ? await supabase.from("users").select("id,name").in("id", teacherIds) : { data: [] };
  const teacherNameById: Record<string, string> = {};
  for (const u of (teacherRows ?? []) as { id: string; name: string }[]) teacherNameById[u.id] = u.name;

  const teamIds = targets.filter((t) => t.kind === "team").map((t) => t.id);
  const individualIds = targets.filter((t) => t.kind === "individual").map((t) => t.id);

  const results: ScheduleTargetDetail[] = [];

  if (schedule.submission_type === "plan") {
    const [{ data: teamPlans }, { data: snaps }] = await Promise.all([
      teamIds.length > 0 ? supabase.from("research_plans").select("*").in("team_id", teamIds) : Promise.resolve({ data: [] as ResearchPlan[] }),
      supabase.from("submission_snapshots").select("source_table,source_id,submitted_at").in("source_table", ["research_plans", "individual_research"]),
    ]);
    const planByTeam: Record<string, ResearchPlan> = {};
    for (const p of (teamPlans ?? []) as ResearchPlan[]) if (p.team_id) planByTeam[p.team_id] = p;
    const firstSubmitted: Record<string, string> = {};
    for (const s of (snaps ?? []) as { source_table: string; source_id: string; submitted_at: string }[]) {
      const key = `${s.source_table}:${s.source_id}`;
      if (!firstSubmitted[key] || s.submitted_at < firstSubmitted[key]) firstSubmitted[key] = s.submitted_at;
    }
    const indivById: Record<string, IndividualResearch> = {};
    for (const r of allIndividuals) indivById[r.id] = r;

    for (const t of targets) {
      if (t.kind === "team") {
        const plan = planByTeam[t.id] ?? null;
        const firstAt = plan ? firstSubmitted[`research_plans:${plan.id}`] ?? null : null;
        results.push({
          targetKey: t.id,
          targetLabel: t.label,
          teacherId: t.teacherId,
          teacherName: t.teacherId ? teacherNameById[t.teacherId] ?? "-" : "-",
          submissionStatus: statusOf(plan, firstAt, schedule.deadline),
          firstSubmittedAt: firstAt,
          reviewPhase: plan ? deriveReviewPhase(plan.status, plan.feedback) : null,
        });
      } else {
        const indiv = indivById[t.id];
        const firstAt = firstSubmitted[`individual_research:${t.id}`] ?? null;
        results.push({
          targetKey: t.id,
          targetLabel: t.label,
          teacherId: t.teacherId,
          teacherName: t.teacherId ? teacherNameById[t.teacherId] ?? "-" : "-",
          submissionStatus: statusOf(indiv ? { status: indiv.plan_status } : null, firstAt, schedule.deadline),
          firstSubmittedAt: firstAt,
          reviewPhase: indiv ? deriveReviewPhase(indiv.plan_status, indiv.plan_feedback) : null,
        });
      }
    }
  } else {
    const orParts: string[] = [];
    if (teamIds.length > 0) orParts.push(`team_id.in.(${teamIds.join(",")})`);
    if (individualIds.length > 0) orParts.push(`and(entity_type.eq.individual,entity_id.in.(${individualIds.join(",")}))`);
    const [{ data: reportRows }, { data: snaps }] = await Promise.all([
      orParts.length > 0 ? supabase.from("research_reports").select("*").or(orParts.join(",")) : Promise.resolve({ data: [] as ResearchReport[] }),
      supabase.from("submission_snapshots").select("source_id,submitted_at").eq("source_table", "research_reports"),
    ]);
    const reports = (reportRows ?? []) as ResearchReport[];
    const reportByTeam: Record<string, ResearchReport> = {};
    const reportByIndividual: Record<string, ResearchReport> = {};
    for (const r of reports) {
      if (r.team_id) reportByTeam[r.team_id] = r;
      else if (r.entity_type === "individual") reportByIndividual[r.entity_id] = r;
    }
    const firstSubmitted: Record<string, string> = {};
    for (const s of (snaps ?? []) as { source_id: string; submitted_at: string }[]) {
      if (!firstSubmitted[s.source_id] || s.submitted_at < firstSubmitted[s.source_id]) firstSubmitted[s.source_id] = s.submitted_at;
    }

    for (const t of targets) {
      const report = t.kind === "team" ? reportByTeam[t.id] : reportByIndividual[t.id];
      const firstAt = report ? firstSubmitted[report.id] ?? null : null;
      results.push({
        targetKey: t.id,
        targetLabel: t.label,
        teacherId: t.teacherId,
        teacherName: t.teacherId ? teacherNameById[t.teacherId] ?? "-" : "-",
        submissionStatus: statusOf(report, firstAt, schedule.deadline),
        firstSubmittedAt: firstAt,
        reviewPhase: report ? deriveReviewPhase(report.status, report.feedback) : null,
      });
    }
  }

  return results;
}
