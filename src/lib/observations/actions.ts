import { createClient } from "@/lib/supabase";
import type { TeachingActivityKind } from "@/lib/portfolio/teaching";

// 학생별 "교사 관찰 기록" — DB에는 실제 author_teacher_id를 항상 저장하고
// (039_teacher_observations.sql), 익명화는 여기(클라이언트 표시 단계)에서만 한다.
// 즉 "내 기록"/"교사 기록" 구분은 현재 로그인한 교사의 id와 author_teacher_id를
// 비교하는 것뿐이고, 다른 교사의 실명을 아예 조회/전달하지 않는다.

export const OBSERVATION_TAGS = ["주도성", "협업", "문제해결", "탐구과정", "소통"] as const;
export type ObservationTag = (typeof OBSERVATION_TAGS)[number];

export interface TeacherObservation {
  id: string;
  studentId: string;
  authorTeacherId: string;
  activityType: TeachingActivityKind | null;
  activityId: string | null;
  /** 정확한 관찰일 근거가 없는 historical 기록은 null(academicYear로 학년도를 표시). */
  observedAt: string | null;
  /** historical backfill용 학년도(044 migration). live 기록은 null이고 observedAt 연도를 쓴다. */
  academicYear: number | null;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** 현재 로그인한 교사 본인이 작성한 기록인지 — UI가 "내 기록"/"교사 기록"을 이걸로만 구분한다. */
  isMine: boolean;
}

interface ObservationRow {
  id: string;
  student_id: string;
  author_teacher_id: string;
  activity_type: string | null;
  activity_id: string | null;
  observed_at: string | null;
  academic_year?: number | null;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

function toObservation(row: ObservationRow, currentTeacherId: string): TeacherObservation {
  return {
    id: row.id,
    studentId: row.student_id,
    authorTeacherId: row.author_teacher_id,
    activityType: (row.activity_type as TeachingActivityKind) ?? null,
    activityId: row.activity_id,
    observedAt: row.observed_at,
    academicYear: row.academic_year ?? null,
    content: row.content,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isMine: row.author_teacher_id === currentTeacherId,
  };
}

export async function fetchObservations(studentId: string, currentTeacherId: string): Promise<TeacherObservation[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("teacher_observations")
    .select("*")
    .eq("student_id", studentId)
    .order("observed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  return ((data as ObservationRow[]) ?? []).map((r) => toObservation(r, currentTeacherId));
}

/** 학생 목록 화면의 "관찰 기록 N건" 배지용 — 학생별 건수만 한 번에 센다. */
export async function fetchObservationCounts(studentIds: string[]): Promise<Record<string, number>> {
  if (studentIds.length === 0) return {};
  const supabase = createClient();
  const { data } = await supabase.from("teacher_observations").select("student_id").in("student_id", studentIds);
  const counts: Record<string, number> = {};
  for (const row of (data as { student_id: string }[]) ?? []) counts[row.student_id] = (counts[row.student_id] ?? 0) + 1;
  return counts;
}

export async function createObservation(params: {
  studentId: string;
  authorTeacherId: string;
  activityType: TeachingActivityKind | null;
  observedAt: string;
  content: string;
  tags: string[];
}): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.from("teacher_observations").insert({
    student_id: params.studentId,
    author_teacher_id: params.authorTeacherId,
    activity_type: params.activityType,
    observed_at: params.observedAt,
    content: params.content,
    tags: params.tags,
  });
  return { error: error?.message ?? null };
}

export async function updateObservation(
  id: string,
  patch: { content?: string; tags?: string[]; activityType?: TeachingActivityKind | null; observedAt?: string }
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.content !== undefined) dbPatch.content = patch.content;
  if (patch.tags !== undefined) dbPatch.tags = patch.tags;
  if (patch.activityType !== undefined) dbPatch.activity_type = patch.activityType;
  if (patch.observedAt !== undefined) dbPatch.observed_at = patch.observedAt;
  // RLS(authors can update own observations)가 본인 것이 아니면 0 rows로 조용히
  // 걸러낸다 — 여기서 별도 권한 검사를 다시 하지 않는다.
  const { error } = await supabase.from("teacher_observations").update(dbPatch).eq("id", id);
  return { error: error?.message ?? null };
}

export async function deleteObservation(id: string): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.from("teacher_observations").delete().eq("id", id);
  return { error: error?.message ?? null };
}

// ── 포트폴리오 "교사 관찰 기록" section 전용 정렬 ──────────────────────────
// academic_year(044 migration)가 있으면 그 값을, 없으면 observed_at의 연도를 academic year로 취급한다.

export function observationAcademicYear(o: Pick<TeacherObservation, "observedAt"> & { academicYear?: number | null }): number | null {
  if (o.academicYear != null) return o.academicYear;
  const y = parseInt((o.observedAt ?? "").slice(0, 4), 10);
  return Number.isNaN(y) ? null : y;
}

/** academic year(observedAt 연도) 오름차순 → 같은 학년도 안에서는 created_at 오름차순(안정적인 작성 순서).
 * 포트폴리오 화면(TeacherObservationsSection)과 export(render-full-portfolio.ts)가 이 함수 하나를 그대로 같이 쓴다. */
export function sortObservationsForPortfolio(items: TeacherObservation[]): TeacherObservation[] {
  return [...items].sort((a, b) => {
    const ya = observationAcademicYear(a) ?? Number.MAX_SAFE_INTEGER;
    const yb = observationAcademicYear(b) ?? Number.MAX_SAFE_INTEGER;
    if (ya !== yb) return ya - yb;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
