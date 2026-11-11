import { createClient } from "@/lib/supabase";
import { fetchStudentSchedule } from "@/lib/schedule/studentSchedule";
import { PROJECT_KIND_LABEL, type ProjectKind, type ProjectProgress } from "@/lib/dashboard/journey";
import type { ScheduleView } from "@/lib/dashboard/schedule";
import type { ActivityLog, EntityType, ReportSchedule, ReviewStatus } from "@/lib/database.types";

// 대시보드 데이터 계층 — 새 테이블/집계 테이블 없이 기존 source of truth(teams/individual_research/
// research_plans/research_reports/activity_logs/report_schedules)를 그대로 읽는다. 쓰기는 하지 않는다.

export interface ProjectRef {
  id: string;
  kind: ProjectKind;
  name: string;
  year: string | null;
  href: string;
}

const ROUTE: Record<ProjectKind, string> = { rne: "/rne", club: "/club", individual: "/individual" };

const IN_CHUNK = 60;
const PAGE = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** PostgREST 기본 1000행 제한을 넘어도 잘리지 않도록 범위를 나눠 끝까지 읽는다. */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

function toRef(kind: ProjectKind, id: string, name: string, year: string | number | null): ProjectRef {
  return { id, kind, name, year: year == null ? null : String(year), href: `${ROUTE[kind]}/${id}` };
}

/** 학생이 실제로 참여하는 연구(팀 소속 R&E/동아리 + 본인 창의개인연구). */
export async function loadStudentProjects(userId: string): Promise<ProjectRef[]> {
  const supabase = createClient();
  const [{ data: members }, { data: indiv }] = await Promise.all([
    supabase.from("team_members").select("team_id").eq("student_id", userId),
    supabase.from("individual_research").select("id,title,year").eq("student_id", userId),
  ]);
  const teamIds = ((members ?? []) as { team_id: string }[]).map((m) => m.team_id);
  const refs: ProjectRef[] = [];
  for (const ids of chunk(teamIds, IN_CHUNK)) {
    const { data: teams } = await supabase.from("teams").select("id,name,type,school_year").in("id", ids);
    for (const t of (teams ?? []) as { id: string; name: string; type: ProjectKind; school_year: string | null }[]) refs.push(toRef(t.type, t.id, t.name, t.school_year));
  }
  for (const r of (indiv ?? []) as { id: string; title: string; year: number | null }[]) refs.push(toRef("individual", r.id, r.title, r.year));
  return refs;
}

/** 교사가 담당하는 연구(scope "all"=관리자 전체 조회). */
export async function loadTeacherProjects(userId: string, scope: "mine" | "all"): Promise<ProjectRef[]> {
  const supabase = createClient();
  let teamQ = supabase.from("teams").select("id,name,type,school_year");
  let indivQ = supabase.from("individual_research").select("id,title,year");
  if (scope === "mine") {
    teamQ = teamQ.eq("teacher_id", userId);
    indivQ = indivQ.eq("teacher_id", userId);
  }
  const [teams, indiv] = await Promise.all([
    readAll<{ id: string; name: string; type: ProjectKind; school_year: string | null }>((a, b) => teamQ.range(a, b)),
    readAll<{ id: string; title: string; year: number | null }>((a, b) => indivQ.range(a, b)),
  ]);
  return [
    ...teams.map((t) => toRef(t.type, t.id, t.name, t.school_year)),
    ...indiv.map((r) => toRef("individual", r.id, r.title, r.year)),
  ];
}

/**
 * 각 연구의 계획서/결과보고서 상태와 연구일지 상태별 건수. authorId를 주면 그 학생이 쓴 일지만 센다
 * (학생 대시보드는 "내가 쓴 일지", 교사는 연구 전체).
 */
export async function fetchProjectProgress(refs: ProjectRef[], opts: { authorId?: string } = {}): Promise<ProjectProgress[]> {
  if (refs.length === 0) return [];
  const supabase = createClient();
  const teamIds = refs.filter((r) => r.kind !== "individual").map((r) => r.id);
  const indivIds = refs.filter((r) => r.kind === "individual").map((r) => r.id);

  const planOf: Record<string, string> = {};
  const reportOf: Record<string, string> = {};
  type LogRow = { entity_id: string; status: string };
  const logs: LogRow[] = [];

  await Promise.all([
    ...chunk(teamIds, IN_CHUNK).map(async (ids) => {
      const [{ data: plans }, { data: reports }] = await Promise.all([
        supabase.from("research_plans").select("team_id,status").in("team_id", ids),
        supabase.from("research_reports").select("team_id,status").in("team_id", ids),
      ]);
      for (const p of (plans ?? []) as { team_id: string; status: string }[]) planOf[p.team_id] = p.status;
      for (const r of (reports ?? []) as { team_id: string; status: string }[]) reportOf[r.team_id] = r.status;
    }),
    ...chunk(indivIds, IN_CHUNK).map(async (ids) => {
      const [{ data: plans }, { data: reports }] = await Promise.all([
        supabase.from("individual_research").select("id,plan_status").in("id", ids),
        supabase.from("research_reports").select("entity_id,status").eq("entity_type", "individual").in("entity_id", ids),
      ]);
      for (const p of (plans ?? []) as { id: string; plan_status: string | null }[]) if (p.plan_status) planOf[p.id] = p.plan_status;
      for (const r of (reports ?? []) as { entity_id: string; status: string }[]) reportOf[r.entity_id] = r.status;
    }),
    ...chunk(refs.map((r) => r.id), IN_CHUNK).map(async (ids) => {
      const rows = await readAll<LogRow>((a, b) => {
        let q = supabase.from("activity_logs").select("entity_id,status").in("entity_id", ids);
        if (opts.authorId) q = q.eq("author_id", opts.authorId);
        return q.range(a, b);
      });
      logs.push(...rows);
    }),
  ]);

  const logAgg: Record<string, { total: number; pending: number; rejected: number; approved: number }> = {};
  for (const l of logs) {
    const a = (logAgg[l.entity_id] ??= { total: 0, pending: 0, rejected: 0, approved: 0 });
    a.total += 1;
    if (l.status === "pending" || l.status === "submitted") a.pending += 1;
    else if (l.status === "rejected") a.rejected += 1;
    else if (l.status === "approved") a.approved += 1;
  }

  return refs.map((r) => {
    const a = logAgg[r.id];
    return {
      id: r.id, kind: r.kind, name: r.name, year: r.year, href: r.href,
      plan: planOf[r.id] ?? null, report: reportOf[r.id] ?? null,
      logTotal: a?.total ?? 0, logPending: a?.pending ?? 0, logRejected: a?.rejected ?? 0, logApproved: a?.approved ?? 0,
    };
  });
}

// ── 실제 제출 일정 ──────────────────────────────────────────────────────────

/** 학생: 기존 fetchStudentSchedule(관리자 "제출 일정 관리"의 적용 범위 규칙 그대로)를 대시보드 표시용으로 옮긴다. */
export async function fetchStudentScheduleViews(userId: string): Promise<ScheduleView[]> {
  const items = await fetchStudentSchedule(userId);
  return items.map((i) => ({ id: i.id, title: i.title, deadline: i.deadline, submissionType: i.submissionType, scopeLabel: i.activityKind }));
}

const ENTITY_TYPE_LABEL: Record<string, string> = { rne: "R&E", club: "동아리", individual: "창의개인연구" };

/**
 * 교사: 학교 전체 공통 일정과 유형별(R&E/동아리/창의개인연구) 일정은 모두 보여주고(교사는 전체 제출물을 조회할 수
 * 있으므로), 특정 연구(entity_id)에만 걸린 일정은 담당 연구일 때만 보여준다. scope "all"(관리자)은 전부.
 */
export async function fetchTeacherScheduleViews(refs: ProjectRef[], scope: "mine" | "all"): Promise<ScheduleView[]> {
  const supabase = createClient();
  const { data } = await supabase.from("report_schedules").select("*").order("deadline", { ascending: true });
  const mine = new Map(refs.map((r) => [r.id, r]));
  const out: ScheduleView[] = [];
  for (const s of (data ?? []) as ReportSchedule[]) {
    let scopeLabel: string;
    if (s.entity_id) {
      const ref = mine.get(s.entity_id);
      if (!ref && scope !== "all") continue;
      scopeLabel = ref ? PROJECT_KIND_LABEL[ref.kind] : (s.entity_type && ENTITY_TYPE_LABEL[s.entity_type]) || "특정 연구";
    } else {
      scopeLabel = s.entity_type ? ENTITY_TYPE_LABEL[s.entity_type] ?? "전체" : "전체";
    }
    out.push({ id: s.id, title: s.title, deadline: s.deadline, submissionType: s.submission_type, scopeLabel });
  }
  return out;
}

// ── 활동 요약/최근 활동 ─────────────────────────────────────────────────────

export interface FeedItem {
  id: string;
  title: string;
  status: ReviewStatus;
  entityType: EntityType;
  logDate: string | null;
  href: string;
}

const FEED_LIMIT = 6;

export async function fetchRecentFeed(params: { refs: ProjectRef[]; authorId?: string; unscoped?: boolean }): Promise<FeedItem[]> {
  const supabase = createClient();
  let q = supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(FEED_LIMIT);
  if (params.authorId) q = q.eq("author_id", params.authorId);
  else if (!params.unscoped) {
    if (params.refs.length === 0) return [];
    q = q.in("entity_id", params.refs.map((r) => r.id).slice(0, 200));
  }
  const { data } = await q;
  const logs = (data ?? []) as ActivityLog[];
  const known = new Map(params.refs.map((r) => [r.id, r]));

  // 내 연구 목록에 없는 활동(기타 활동 등, 관리자 전체 조회)만 제목을 따로 조회한다.
  const unknown = logs.filter((l) => !known.has(l.entity_id));
  const extra: Record<string, { title: string; href: string }> = {};
  const teamIds = unknown.filter((l) => l.entity_type === "team").map((l) => l.entity_id);
  const indivIds = unknown.filter((l) => l.entity_type === "individual").map((l) => l.entity_id);
  const otherIds = unknown.filter((l) => l.entity_type === "other").map((l) => l.entity_id);
  await Promise.all([
    teamIds.length
      ? supabase.from("teams").select("id,name,type").in("id", teamIds).then(({ data: rows }) => {
          for (const t of (rows ?? []) as { id: string; name: string; type: ProjectKind }[]) extra[t.id] = { title: t.name, href: `${ROUTE[t.type]}/${t.id}` };
        })
      : null,
    indivIds.length
      ? supabase.from("individual_research").select("id,title").in("id", indivIds).then(({ data: rows }) => {
          for (const t of (rows ?? []) as { id: string; title: string }[]) extra[t.id] = { title: t.title, href: `/individual/${t.id}` };
        })
      : null,
    otherIds.length
      ? supabase.from("other_activities").select("id,title").in("id", otherIds).then(({ data: rows }) => {
          for (const t of (rows ?? []) as { id: string; title: string }[]) extra[t.id] = { title: t.title, href: `/other/${t.id}` };
        })
      : null,
  ]);

  return logs.map((l) => {
    const ref = known.get(l.entity_id);
    const hit = ref ? { title: ref.name, href: ref.href } : extra[l.entity_id];
    return { id: l.id, title: hit?.title ?? "(제목 없음)", status: l.status, entityType: l.entity_type, logDate: l.log_date, href: hit?.href ?? "/dashboard" };
  });
}

export async function countHead(table: "other_activities" | "awards", studentId?: string): Promise<number> {
  const supabase = createClient();
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (studentId) q = q.eq("student_id", studentId);
  const { count } = await q;
  return count ?? 0;
}
