import { createClient } from "@/lib/supabase";
import { fetchTeachingRelations, type TeachingActivityKind } from "@/lib/portfolio/teaching";

// 교사 "학생 포트폴리오" 메인 화면의 "전체 학생" 목록 — 성능을 위해 학생별 전체
// 포트폴리오(연구계획/보고서/연구일지 본문 등)를 가져오지 않고, 목록에 필요한
// 요약 데이터만 몇 번의 배치 쿼리로 가져온다. 개별 학생 상세는 열 때만
// getStudentPortfolio()로 따로 가져온다(src/lib/portfolio/detail.ts).

export interface StudentDirectoryRow {
  id: string;
  name: string;
  username: string | null;
  grade: number | null;
  class: string | null;
  number: number | null;
  /** 주요 활동 배지(R&E/동아리/창의개인연구/기타 활동) — 중복 없이. */
  activityKinds: TeachingActivityKind[];
  /** 현재 로그인한 교사 기준 "지도 활동" — 비어 있으면 비지도 학생. */
  teachingActivityKinds: TeachingActivityKind[];
  /** 참여 연구(팀+개인연구) 건수 — 기타활동은 제외(연구 프로젝트가 아니므로). */
  projectCount: number;
  /** 작성한 연구일지(연구노트) 건수. */
  logCount: number;
  recentActivityAt: string | null;
}

function yearOf(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : String(d.getFullYear());
}

export async function fetchStudentDirectory(params: {
  teacherId: string;
  academicYear: string | null;
}): Promise<{ rows: StudentDirectoryRow[]; yearOptions: string[] }> {
  const { teacherId, academicYear } = params;
  const supabase = createClient();

  const [{ data: studentRows }, { data: teamRows }, { data: indivRows }, { data: otherRows }] = await Promise.all([
    supabase.from("users").select("id,name,username,grade,class,number").eq("role", "student"),
    supabase.from("teams").select("id,type,school_year"),
    supabase.from("individual_research").select("id,student_id,year"),
    supabase.from("other_activities").select("id,student_id,activity_date,created_at"),
  ]);

  const allTeams = (teamRows ?? []) as { id: string; type: string; school_year: string | null }[];
  const allIndivs = (indivRows ?? []) as { id: string; student_id: string; year: number | null }[];
  const allOthers = (otherRows ?? []) as { id: string; student_id: string; activity_date: string | null; created_at: string }[];

  // 학년도 드롭다운 옵션 — 필터 여부와 무관하게 존재하는 모든 실제 academic_year를 모은다.
  const years = new Set<string>();
  for (const t of allTeams) if (t.school_year) years.add(t.school_year);
  for (const r of allIndivs) if (r.year != null) years.add(String(r.year));
  for (const o of allOthers) {
    const y = yearOf(o.activity_date) ?? yearOf(o.created_at);
    if (y) years.add(y);
  }
  const yearOptions = [...years].sort((a, b) => b.localeCompare(a));

  const teams = academicYear ? allTeams.filter((t) => t.school_year === academicYear) : allTeams;
  const indivs = academicYear ? allIndivs.filter((r) => String(r.year ?? "") === academicYear) : allIndivs;
  const others = academicYear
    ? allOthers.filter((o) => (yearOf(o.activity_date) ?? yearOf(o.created_at)) === academicYear)
    : allOthers;

  const teamIds = teams.map((t) => t.id);
  const teamKindById: Record<string, TeachingActivityKind> = {};
  for (const t of teams) teamKindById[t.id] = t.type === "rne" ? "R&E" : "동아리";

  const { data: memberRows } =
    teamIds.length > 0
      ? await supabase.from("team_members").select("team_id,student_id").in("team_id", teamIds)
      : { data: [] as { team_id: string; student_id: string }[] };
  const teamsByStudent: Record<string, string[]> = {};
  for (const m of (memberRows ?? []) as { team_id: string; student_id: string }[]) {
    (teamsByStudent[m.student_id] ??= []).push(m.team_id);
  }

  const individualIds = new Set(indivs.map((r) => r.id));
  const indivsByStudent: Record<string, number> = {};
  for (const r of indivs) indivsByStudent[r.student_id] = (indivsByStudent[r.student_id] ?? 0) + 1;

  const othersByStudent = new Set<string>();
  for (const o of others) othersByStudent.add(o.student_id);

  // 연구일지 — "실제 academic_year"는 로그가 속한 팀/개인연구를 통해서만 알 수 있다.
  // 학년도 필터가 있으면 그 학년도의 팀/개인연구에 속한 로그만, 기타활동 로그는
  // (활동 자체에 academic_year가 없어) 로그 작성일 연도로 판단한다 — other_activities와 동일한 원칙.
  const { data: logRows } = await supabase
    .from("activity_logs")
    .select("author_id,entity_type,entity_id,log_date")
    .neq("log_type", "personal");
  const allowedTeamIds = new Set(teamIds);
  const allowedIndivIds = individualIds;
  const logsByStudent: Record<string, { count: number; latest: string | null }> = {};
  for (const l of (logRows ?? []) as { author_id: string; entity_type: string; entity_id: string; log_date: string | null }[]) {
    if (academicYear) {
      if (l.entity_type === "team" && !allowedTeamIds.has(l.entity_id)) continue;
      if (l.entity_type === "individual" && !allowedIndivIds.has(l.entity_id)) continue;
      if (l.entity_type === "other" && (!l.log_date || yearOf(l.log_date) !== academicYear)) continue;
    }
    const bucket = (logsByStudent[l.author_id] ??= { count: 0, latest: null });
    bucket.count++;
    if (l.log_date && (!bucket.latest || l.log_date > bucket.latest)) bucket.latest = l.log_date;
  }

  const teachingMap = await fetchTeachingRelations(teacherId, academicYear);

  const rows: StudentDirectoryRow[] = ((studentRows ?? []) as {
    id: string; name: string; username: string | null; grade: number | null; class: string | null; number: number | null;
  }[]).map((s) => {
    const myTeamIds = (teamsByStudent[s.id] ?? []).filter((tid) => teamKindById[tid]);
    const kinds = new Set<TeachingActivityKind>();
    for (const tid of myTeamIds) kinds.add(teamKindById[tid]);
    if ((indivsByStudent[s.id] ?? 0) > 0) kinds.add("창의개인연구");
    if (othersByStudent.has(s.id)) kinds.add("기타 활동");

    const logInfo = logsByStudent[s.id];
    const teaching = teachingMap.get(s.id);

    return {
      id: s.id,
      name: s.name,
      username: s.username,
      grade: s.grade,
      class: s.class,
      number: s.number,
      activityKinds: [...kinds],
      teachingActivityKinds: teaching ? [...teaching] : [],
      projectCount: myTeamIds.length + (indivsByStudent[s.id] ?? 0),
      logCount: logInfo?.count ?? 0,
      recentActivityAt: logInfo?.latest ?? null,
    };
  });

  return { rows, yearOptions };
}
