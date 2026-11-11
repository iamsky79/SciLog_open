import { createClient } from "@/lib/supabase";
import type { ReportSchedule } from "@/lib/database.types";

// "올해의 연구 일정" — 학생 대시보드가 관리자 "제출 일정 관리"(report_schedules)를
// 그대로 source of truth로 쓴다. 새 Annual Plan/단계 테이블을 만들지 않는다.
// 각 report_schedules 행 자체가 "하나의 단계/일정"이고, 그 title이 곧 단계명이다
// (예: 관리자가 "연구계획서 제출"이라는 제목으로 만들면 그게 그대로 단계명).

export type ScheduleActivityKind = "R&E" | "동아리" | "창의개인연구" | "전체" | "대회";

export interface StudentScheduleItem {
  id: string;
  activityKind: ScheduleActivityKind;
  title: string;
  deadline: string;
  submissionType: string | null;
  isPast: boolean;
}

const ENTITY_TYPE_TO_KIND: Record<string, ScheduleActivityKind> = { rne: "R&E", club: "동아리", individual: "창의개인연구" };

/**
 * 이 학생에게 실제로 적용되는 모든 일정(지난 것 포함)을 날짜순으로 돌려준다.
 * entity_id가 있으면 그 팀/개인연구에 학생이 속해 있을 때만, entity_type만 있으면
 * 그 유형에 학생이 참여 중일 때만, 둘 다 없으면(전체 공통 일정) 누구에게나 적용된다.
 */
export async function fetchStudentSchedule(studentId: string): Promise<StudentScheduleItem[]> {
  const supabase = createClient();

  const [{ data: memberRows }, { data: indivRows }, { data: scheduleRows }] = await Promise.all([
    supabase.from("team_members").select("team_id").eq("student_id", studentId),
    supabase.from("individual_research").select("id").eq("student_id", studentId),
    supabase.from("report_schedules").select("*").order("deadline", { ascending: true }),
  ]);

  const teamIds = ((memberRows ?? []) as { team_id: string }[]).map((m) => m.team_id);
  const individualIds = new Set(((indivRows ?? []) as { id: string }[]).map((r) => r.id));

  const teamKindById: Record<string, ScheduleActivityKind> = {};
  const hasTeamType: Record<string, boolean> = { rne: false, club: false };
  if (teamIds.length > 0) {
    const { data: teamRows } = await supabase.from("teams").select("id,type").in("id", teamIds);
    for (const t of (teamRows ?? []) as { id: string; type: string }[]) {
      const kind = ENTITY_TYPE_TO_KIND[t.type];
      if (kind) {
        teamKindById[t.id] = kind;
        if (t.type === "rne") hasTeamType.rne = true;
        if (t.type === "club") hasTeamType.club = true;
      }
    }
  }
  const hasIndividual = individualIds.size > 0;

  const now = Date.now();
  const items: StudentScheduleItem[] = [];
  for (const s of (scheduleRows ?? []) as ReportSchedule[]) {
    let applies = false;
    let kind: ScheduleActivityKind = "전체";

    if (!s.entity_type && !s.entity_id) {
      applies = true;
      kind = "전체";
    } else if (s.entity_id) {
      if (teamKindById[s.entity_id]) {
        applies = true;
        kind = teamKindById[s.entity_id];
      } else if (individualIds.has(s.entity_id)) {
        applies = true;
        kind = "창의개인연구";
      }
    } else if (s.entity_type) {
      if (s.entity_type === "rne" && hasTeamType.rne) {
        applies = true;
        kind = "R&E";
      } else if (s.entity_type === "club" && hasTeamType.club) {
        applies = true;
        kind = "동아리";
      } else if (s.entity_type === "individual" && hasIndividual) {
        applies = true;
        kind = "창의개인연구";
      }
    }

    if (!applies) continue;
    // 대회/공모전/학술발표 일정 — entity_type/entity_id로 정해지는 "적용 범위"는
    // 그대로 재사용하되(전체 공통일 수도, 특정 활동 한정일 수도 있음), 학생 화면에는
    // 새 대규모 대회 시스템 없이 submission_type='competition'만으로 별도 유형으로 표시한다.
    if (s.submission_type === "competition") kind = "대회";
    items.push({
      id: s.id,
      activityKind: kind,
      title: s.title,
      deadline: s.deadline,
      submissionType: s.submission_type,
      isPast: new Date(s.deadline).getTime() < now,
    });
  }

  return items.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
}
