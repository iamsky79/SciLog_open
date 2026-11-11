import { createClient } from "@/lib/supabase";
import { ACTIVITY_ROLE_CODES } from "@/lib/database.types";
import type {
  ActivityLog,
  ActivityLogParticipant,
  ActivityRoleCode,
  IndividualResearch,
  PersonalRecord,
  Reference,
  ResearchPlan,
  ResearchReport,
} from "@/lib/database.types";
import { fileNameFromUrl, isImageUrl } from "./common";
import type {
  EntityKind,
  JournalExportPayload,
  PlanExportPayload,
  PortfolioExportPayload,
  ReferencesExportPayload,
  ReportExportPayload,
} from "./types";

/** rne/club → activity_logs.entity_type은 둘 다 "team"(entity_id로 구분), individual은 "individual". */
const activityLogsEntityType = (kind: EntityKind) => (kind === "individual" ? "individual" : "team");

export interface ExportContext {
  entityKind: EntityKind;
  /** research_plans/research_reports/references/personal_records의 entity_id (team.id 또는 individual_research.id) */
  entityId: string;
  entityName: string;
  /** rne/club은 team.id, individual은 null */
  teamId: string | null;
  periodLabel?: string | null;
  teacherId?: string | null;
  /** rne/club 팀원 표시 이름 */
  memberNames?: string[];
  /** individual 학생 표시 이름 */
  studentName?: string;
}

async function fetchTeacherName(
  supabase: ReturnType<typeof createClient>,
  teacherId: string | null | undefined
): Promise<string | null> {
  if (!teacherId) return null;
  const { data } = await supabase.from("users").select("name").eq("id", teacherId).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

async function fetchUserNames(
  supabase: ReturnType<typeof createClient>,
  ids: string[]
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await supabase.from("users").select("id, name").in("id", ids);
  return Object.fromEntries(((data as { id: string; name: string }[]) ?? []).map((u) => [u.id, u.name]));
}

export async function fetchPlanPayload(ctx: ExportContext): Promise<PlanExportPayload> {
  const supabase = createClient();
  const teacherName = await fetchTeacherName(supabase, ctx.teacherId);

  if (ctx.entityKind === "individual") {
    const { data } = await supabase.from("individual_research").select("*").eq("id", ctx.entityId).single();
    const r = data as IndividualResearch | null;
    return {
      entityKind: ctx.entityKind,
      entityName: ctx.entityName,
      periodLabel: ctx.periodLabel ?? null,
      teacherName,
      members: ctx.studentName ? [ctx.studentName] : [],
      title: null,
      motivation: r?.plan_motivation ?? null,
      method: r?.plan_method ?? null,
      expectedResult: r?.plan_expected ?? null,
      status: r?.plan_status ?? "draft",
      submittedAt: r?.plan_submitted_at ?? null,
      feedback: r?.plan_feedback ?? null,
      fileUrls: r?.plan_file_urls ?? [],
      generatedAt: new Date().toISOString(),
    };
  }

  const { data } = await supabase
    .from("research_plans")
    .select("*")
    .eq("team_id", ctx.teamId)
    .eq("entity_type", ctx.entityKind)
    .maybeSingle();
  const plan = data as ResearchPlan | null;
  return {
    entityKind: ctx.entityKind,
    entityName: ctx.entityName,
    periodLabel: ctx.periodLabel ?? null,
    teacherName,
    members: ctx.memberNames ?? [],
    title: plan?.title ?? null,
    motivation: plan?.motivation ?? null,
    method: plan?.method ?? null,
    expectedResult: plan?.expected_result ?? null,
    status: plan?.status ?? "draft",
    submittedAt: plan?.submitted_at ?? null,
    feedback: plan?.feedback ?? null,
    fileUrls: [],
    generatedAt: new Date().toISOString(),
  };
}

export async function fetchReportPayload(ctx: ExportContext): Promise<ReportExportPayload> {
  const supabase = createClient();
  const teacherName = await fetchTeacherName(supabase, ctx.teacherId);
  const { data } = await supabase
    .from("research_reports")
    .select("*")
    .eq("entity_type", ctx.entityKind)
    .eq("entity_id", ctx.entityId)
    .maybeSingle();
  const r = data as ResearchReport | null;
  return {
    entityKind: ctx.entityKind,
    entityName: ctx.entityName,
    periodLabel: ctx.periodLabel ?? null,
    teacherName,
    members: ctx.entityKind === "individual" ? (ctx.studentName ? [ctx.studentName] : []) : ctx.memberNames ?? [],
    title: r?.title ?? null,
    introduction: r?.introduction ?? null,
    conclusion: r?.conclusion ?? null,
    summary: r?.summary ?? null,
    status: r?.status ?? "draft",
    submittedAt: r?.submitted_at ?? null,
    feedback: r?.feedback ?? null,
    primaryFile: r?.file_url ? { name: r.original_file_name ?? r.file_name ?? "결과보고서 파일", url: r.file_url } : null,
    extraFiles: (r?.extra_file_urls ?? []).map((u, i) => ({ name: `추가 자료 ${i + 1} (${fileNameFromUrl(u)})`, url: u })),
    generatedAt: new Date().toISOString(),
  };
}

const JOURNAL_FIELD_DEFS: { key: keyof ActivityLog; label: string }[] = [
  { key: "experiment", label: "오늘의 연구 활동" },
  { key: "result", label: "주요 결과 및 관찰" },
  { key: "interpretation", label: "해석 및 판단" },
  { key: "conclusion", label: "문제점 / 특이사항" },
  { key: "next_plan", label: "다음 활동과 그 이유" },
];

export async function fetchJournalPayload(ctx: ExportContext): Promise<JournalExportPayload> {
  const supabase = createClient();
  const logEntityType = activityLogsEntityType(ctx.entityKind);
  const { data: logsData } = await supabase
    .from("activity_logs")
    .select("*")
    .eq("entity_type", logEntityType)
    .eq("entity_id", ctx.entityId)
    .eq("log_type", "team")
    .neq("status", "draft")
    .order("log_date", { ascending: true });
  const logs = (logsData as ActivityLog[]) ?? [];
  const logIds = logs.map((l) => l.id);

  let participants: ActivityLogParticipant[] = [];
  if (logIds.length > 0) {
    const { data } = await supabase.from("activity_log_participants").select("*").in("log_id", logIds);
    participants = (data as ActivityLogParticipant[]) ?? [];
  }
  const byLog: Record<string, ActivityLogParticipant[]> = {};
  for (const p of participants) (byLog[p.log_id] ??= []).push(p);

  const nameIds = Array.from(new Set([...logs.map((l) => l.author_id), ...participants.map((p) => p.student_id)]));
  const names = await fetchUserNames(supabase, nameIds);

  const entries = logs.map((log) => {
    const fields: { label: string; value: string }[] = [];
    if (log.goal) fields.push({ label: "오늘의 목표", value: log.goal });
    for (const { key, label } of JOURNAL_FIELD_DEFS) {
      let val = log[key] as string | null;
      if (!val && key === "experiment") val = log.free_memo ?? log.activity_content ?? null;
      if (val) fields.push({ label, value: val });
    }
    if (log.achievement) fields.push({ label: "성과 및 소감", value: log.achievement });

    const urls = log.file_urls ?? [];
    const images = urls.filter(isImageUrl).map((u) => ({ url: u, name: fileNameFromUrl(u) }));
    const files = urls.filter((u) => !isImageUrl(u)).map((u) => ({ url: u, name: fileNameFromUrl(u) }));
    const parts = (byLog[log.id] ?? []).map((p) => ({
      studentId: p.student_id,
      name: names[p.student_id] ?? "알 수 없음",
      roles: p.roles ?? [],
      roleDescription: p.role_description ?? null,
    }));

    return {
      id: log.id,
      date: log.log_date,
      title: log.title,
      authorName: names[log.author_id] ?? "알 수 없음",
      status: log.status,
      fields,
      images,
      files,
      participants: parts,
      teacherFeedback: log.teacher_feedback ?? null,
    };
  });

  return {
    entityKind: ctx.entityKind,
    entityName: ctx.entityName,
    periodLabel: ctx.periodLabel ?? null,
    entries,
    generatedAt: new Date().toISOString(),
  };
}

export async function fetchReferencesPayload(ctx: ExportContext): Promise<ReferencesExportPayload> {
  const supabase = createClient();
  const { data } = await supabase
    .from("references")
    .select("*")
    .eq("entity_type", ctx.entityKind)
    .eq("entity_id", ctx.entityId)
    .order("created_at", { ascending: true });
  const refs = (data as Reference[]) ?? [];
  const creatorIds = [...new Set(refs.map((r) => r.created_by).filter(Boolean))] as string[];
  const names = await fetchUserNames(supabase, creatorIds);

  return {
    entityKind: ctx.entityKind,
    entityName: ctx.entityName,
    periodLabel: ctx.periodLabel ?? null,
    items: refs.map((r) => ({
      title: r.title,
      authors: r.authors,
      source: r.source,
      url: r.url,
      fileName: r.file_url ? fileNameFromUrl(r.file_url) : null,
      fileUrl: r.file_url,
      memo: r.memo,
      createdByName: r.created_by ? names[r.created_by] ?? null : null,
      createdAt: r.created_at,
    })),
    generatedAt: new Date().toISOString(),
  };
}

export interface PortfolioFetchParams extends ExportContext {
  studentId: string;
  subjectName: string;
  /** personal_records.entity_type — rne/club/individual 그대로 사용 */
  personalRecordEntityKind: EntityKind;
}

export async function fetchPortfolioPayload(ctx: PortfolioFetchParams): Promise<PortfolioExportPayload> {
  const supabase = createClient();
  const logEntityType = activityLogsEntityType(ctx.entityKind);
  const { data: logsData } = await supabase
    .from("activity_logs")
    .select("*")
    .eq("entity_type", logEntityType)
    .eq("entity_id", ctx.entityId)
    .eq("log_type", "team")
    .neq("status", "draft");
  const logs = (logsData as ActivityLog[]) ?? [];
  const logMap = Object.fromEntries(logs.map((l) => [l.id, l]));
  const logIds = logs.map((l) => l.id);

  let rows: ActivityLogParticipant[] = [];
  if (logIds.length > 0) {
    const { data } = await supabase
      .from("activity_log_participants")
      .select("*")
      .eq("student_id", ctx.studentId)
      .in("log_id", logIds);
    rows = (data as ActivityLogParticipant[]) ?? [];
  }

  const { data: prData } = await supabase
    .from("personal_records")
    .select("*")
    .eq("entity_type", ctx.personalRecordEntityKind)
    .eq("entity_id", ctx.entityId)
    .eq("student_id", ctx.studentId)
    .maybeSingle();
  const pr = prData as PersonalRecord | null;

  const roleCounts = Object.fromEntries(ACTIVITY_ROLE_CODES.map((c) => [c, 0])) as Record<ActivityRoleCode, number>;
  const entries = rows
    .map((p) => {
      const log = logMap[p.log_id];
      for (const r of p.roles ?? []) roleCounts[r] = (roleCounts[r] ?? 0) + 1;
      return {
        date: log?.log_date ?? "",
        logTitle: log?.title ?? null,
        teamContentSnippet: log?.experiment ?? log?.free_memo ?? null,
        roles: p.roles ?? [],
        roleDescription: p.role_description ?? null,
      };
    })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return {
    studentName: ctx.subjectName,
    entityName: ctx.entityName,
    periodLabel: ctx.periodLabel ?? null,
    roleCounts,
    totalParticipatedLogs: entries.length,
    entries,
    personalRecord: pr
      ? { motivation: pr.motivation, myRole: pr.my_role, lessonsLearned: pr.lessons_learned, challenges: pr.challenges }
      : null,
    generatedAt: new Date().toISOString(),
  };
}
