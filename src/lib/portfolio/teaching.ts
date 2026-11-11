import { createClient } from "@/lib/supabase";

// "지도 학생" — 별도 테이블/수동 체크값이 아니라, 현재 로그인한 교사가 실제로
// 지도교사(teams.teacher_id / individual_research.teacher_id / other_activities.teacher_id)로
// 연결된 활동에 학생이 참여하고 있는지를 매 조회 시점에 계산한다. 새 "지도 학생" 테이블은
// 만들지 않는다 — 기존 교사-활동 관계(teams/individual_research/other_activities)를 그대로 재사용.

export type TeachingActivityKind = "R&E" | "동아리" | "창의개인연구" | "기타 활동";

/** 학생별로 "이 교사와 어떤 활동 종류로 연결돼 있는지"를 중복 없이 모은다. */
export type TeachingRelationMap = Map<string, Set<TeachingActivityKind>>;

function addRelation(map: TeachingRelationMap, studentId: string, kind: TeachingActivityKind) {
  const set = map.get(studentId) ?? new Set<TeachingActivityKind>();
  set.add(kind);
  map.set(studentId, set);
}

function yearOf(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : String(d.getFullYear());
}

/**
 * 현재 교사가 지도교사로 연결된 팀/개인연구/기타활동을 찾아, 그 활동에 실제로 참여하는
 * 학생별로 지도 활동 종류(R&E/동아리/창의개인연구/기타 활동)를 모은다.
 * academicYear가 주어지면 그 학년도(실제 academic_year 필드 기준)의 활동만 반영한다.
 */
export async function fetchTeachingRelations(teacherId: string, academicYear: string | null = null): Promise<TeachingRelationMap> {
  const supabase = createClient();
  const map: TeachingRelationMap = new Map();

  const [{ data: teamRows }, { data: indivRows }, { data: otherRows }] = await Promise.all([
    supabase.from("teams").select("id,type,school_year").eq("teacher_id", teacherId),
    supabase.from("individual_research").select("id,student_id,year").eq("teacher_id", teacherId),
    supabase.from("other_activities").select("id,student_id,activity_date,created_at").eq("teacher_id", teacherId),
  ]);

  const teams = ((teamRows ?? []) as { id: string; type: string; school_year: string | null }[]).filter(
    (t) => !academicYear || t.school_year === academicYear
  );
  const teamIds = teams.map((t) => t.id);
  const teamKindById: Record<string, TeachingActivityKind> = {};
  for (const t of teams) teamKindById[t.id] = t.type === "rne" ? "R&E" : "동아리";

  if (teamIds.length > 0) {
    const { data: memberRows } = await supabase.from("team_members").select("team_id,student_id").in("team_id", teamIds);
    for (const m of (memberRows ?? []) as { team_id: string; student_id: string }[]) {
      addRelation(map, m.student_id, teamKindById[m.team_id]);
    }
  }

  for (const r of (indivRows ?? []) as { id: string; student_id: string; year: number | null }[]) {
    if (academicYear && String(r.year ?? "") !== academicYear) continue;
    addRelation(map, r.student_id, "창의개인연구");
  }

  for (const o of (otherRows ?? []) as { id: string; student_id: string; activity_date: string | null; created_at: string }[]) {
    const y = yearOf(o.activity_date) ?? yearOf(o.created_at);
    if (academicYear && y !== academicYear) continue;
    addRelation(map, o.student_id, "기타 활동");
  }

  return map;
}
