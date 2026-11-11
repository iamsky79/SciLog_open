import { createClient } from "@/lib/supabase";
import { deriveReviewPhase, type ReviewPhase, type ReviewTarget } from "@/lib/review/actions";
import { fetchSnapshotsFor, type SnapshotContent, type SnapshotSourceTable } from "@/lib/submissions/snapshot";
import { fileNameFromUrl, submittedFileBaseName, extOf } from "@/lib/export/common";
import { reportDisplayFields, hasReportContent as hasReportContentFields } from "@/lib/report-fields";
import {
  ACTIVITY_ROLE_LABEL,
  type ActivityLog,
  type ActivityLogParticipant,
  type IndividualResearch,
  type ResearchPlan,
  type ResearchReport,
  type Team,
} from "@/lib/database.types";

// "제출물" 허브 — 학생의 여러 활동(R&E/동아리/창의개인연구/기타활동)에 흩어진
// 제출 상태를 한곳에서 보여주는 조회 전용 계층. 새 테이블을 만들지 않고
// 기존 research_plans/research_reports/individual_research/activity_logs를
// 그대로 조회한다 — 교사 검토 시스템(src/lib/review/actions.ts)과 동일한
// source of truth, 동일한 phase 계산(deriveReviewPhase)을 재사용한다.
//
// "제출 당시 내용"은 별도의 submission_snapshots 테이블(제출/재제출 순간에만 기록)에서
// 가져온다. 그 스냅샷이 없는 문서(과거 데이터, 아직 한 번도 제출 안 한 문서)는
// currentContent(현재 원본)로 폴백하고, 그 사실을 화면에서 숨기지 않는다.

export type HubDocType = "연구계획서" | "연구일지" | "결과보고서";
export type HubActivityKind = "R&E" | "동아리" | "창의개인연구" | "기타 활동";
/** "작성 전"은 아직 아무 행도 없는 상태 — deriveReviewPhase의 대상이 아니라 허브 전용으로 앞에 추가한다. */
export type HubPhase = ReviewPhase | "not_started";

export interface SnapshotView {
  submittedAt: string;
  status: string;
  feedback: string | null;
  content: SnapshotContent;
}

export interface HubItem {
  id: string;
  activityKind: HubActivityKind;
  /** 팀은 team.school_year, 창의개인연구는 research.year, 기타활동은 활동일 연도로 채운다. */
  schoolYear: string | null;
  projectName: string;
  docType: HubDocType;
  title: string | null;
  phase: HubPhase;
  feedback: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  href: string;
  /** 현재(최신) 원본 내용 — snapshot이 없을 때 폴백, 또는 "현재 원본 보기"용. 필드 구성은 docType마다 다르다. */
  currentContent: Record<string, unknown> | null;
  currentAttachments: { name: string; url: string }[];
  /** 제출 당시 스냅샷들(오래된 순, 즉 [0]이 1차 제출). 연구일지는 행 자체가 불변이라 항상 빈 배열. */
  snapshots: SnapshotView[];
}

/** 구성 중에만 쓰는 내부 타입 — 스냅샷을 어떤 (table,id)에서 가져와야 하는지만 들고 있다가 마지막에 벗겨낸다. */
interface HubItemDraft extends HubItem {
  snapshotKey: string | null;
}

const TEAM_ROUTE: Record<"rne" | "club", string> = { rne: "rne", club: "club" };
const TEAM_KIND: Record<"rne" | "club", HubActivityKind> = { rne: "R&E", club: "동아리" };

function hasPlanContent(motivation: string | null, method: string | null, expected: string | null): boolean {
  return !!(motivation || method || expected);
}
function attachmentsFrom(urls: (string | null | undefined)[]): { name: string; url: string }[] {
  return urls.filter((u): u is string => !!u).map((u) => ({ name: fileNameFromUrl(u), url: u }));
}

/** 결과보고서의 currentContent — 제목 + (서론/결론/연구 요약(기존 데이터)) 공유 순서/라벨. */
function reportCurrentContent(report: ResearchReport | null): Record<string, unknown> | null {
  if (!report) return null;
  const fields: Record<string, string | null> = { 제목: report.title };
  for (const f of reportDisplayFields(report)) fields[f.label] = f.value;
  return fields;
}

/**
 * 결과보고서의 "제출 원본 파일" 하나 — 검토/제출물 관리 화면의 "학생 제출 보고서
 * PDF" 다운로드(submission-export.ts의 downloadSubmittedPdf)와 정확히 같은
 * 이름 규칙(submittedFileBaseName)을 쓴다. 예전에는 여기서 report.original_file_name/
 * file_name(원본 또는 storage 파일명)을 그대로 보여줬는데, 같은 파일이 화면마다
 * 다른 이름으로 다운로드되는 문제의 원인이었다 — extra_file_urls(부가 첨부)는
 * 사용자가 붙인 이름 그대로 두는 게 맞아 여기서 건드리지 않는다.
 */
function submittedReportAttachment(
  report: ResearchReport | null,
  params: { schoolYear: string | null; activityKind: HubActivityKind; who: string }
): { name: string; url: string } | null {
  if (!report?.file_url) return null;
  const base = submittedFileBaseName({ schoolYear: params.schoolYear, activityKind: params.activityKind, who: params.who, docType: "결과보고서" });
  return { name: `${base}_제출파일${extOf(report.file_url)}`, url: report.file_url };
}

export async function fetchStudentSubmissionHub(userId: string): Promise<HubItem[]> {
  const supabase = createClient();

  const [{ data: memberRows }, { data: indivRows }] = await Promise.all([
    supabase.from("team_members").select("team_id").eq("student_id", userId),
    supabase.from("individual_research").select("*").eq("student_id", userId),
  ]);
  const teamIds = ((memberRows ?? []) as { team_id: string }[]).map((r) => r.team_id);
  const individuals = (indivRows ?? []) as IndividualResearch[];
  const individualIds = individuals.map((r) => r.id);

  const [{ data: teamRows }, { data: teamPlanRows }, { data: teamReportRows }, { data: indivReportRows }, { data: logRows }] =
    await Promise.all([
      teamIds.length > 0
        ? supabase.from("teams").select("id,type,name,teacher_id,school_year").in("id", teamIds)
        : Promise.resolve({ data: [] as Team[] }),
      teamIds.length > 0
        ? supabase.from("research_plans").select("*").in("team_id", teamIds)
        : Promise.resolve({ data: [] as ResearchPlan[] }),
      teamIds.length > 0
        ? supabase.from("research_reports").select("*").in("team_id", teamIds)
        : Promise.resolve({ data: [] as ResearchReport[] }),
      individualIds.length > 0
        ? supabase.from("research_reports").select("*").eq("entity_type", "individual").in("entity_id", individualIds)
        : Promise.resolve({ data: [] as ResearchReport[] }),
      supabase.from("activity_logs").select("*").eq("author_id", userId).neq("log_type", "personal").order("log_date", { ascending: false, nullsFirst: false }),
    ]);

  const teamMap: Record<string, { type: "rne" | "club"; name: string; schoolYear: string | null }> = {};
  for (const t of (teamRows ?? []) as { id: string; type: string; name: string; school_year: string | null }[]) {
    if (t.type === "rne" || t.type === "club") teamMap[t.id] = { type: t.type, name: t.name, schoolYear: t.school_year };
  }
  const individualMap: Record<string, IndividualResearch> = {};
  for (const r of individuals) individualMap[r.id] = r;

  const logs = (logRows ?? []) as ActivityLog[];
  const logIds = logs.map((l) => l.id);
  const participantsByLog: Record<string, ActivityLogParticipant[]> = {};
  let userNames: Record<string, string> = {};
  if (logIds.length > 0) {
    const { data: pData } = await supabase.from("activity_log_participants").select("*").in("log_id", logIds);
    const participants = (pData as ActivityLogParticipant[]) ?? [];
    for (const p of participants) (participantsByLog[p.log_id] ??= []).push(p);
    const nameIds = [...new Set(participants.map((p) => p.student_id))];
    if (nameIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id,name").in("id", nameIds);
      userNames = Object.fromEntries(((users ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    }
  }

  const items: HubItemDraft[] = [];

  // ── 팀(R&E/동아리) 연구계획서 ──────────────────────────────────────────
  for (const teamId of teamIds) {
    const team = teamMap[teamId];
    if (!team) continue;
    const plan = ((teamPlanRows ?? []) as ResearchPlan[]).find((p) => p.team_id === teamId) ?? null;
    const route = TEAM_ROUTE[team.type];
    const status = plan?.status ?? "draft";
    if (status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    const content = hasPlanContent(plan?.motivation ?? null, plan?.method ?? null, plan?.expected_result ?? null);
    items.push({
      id: `plan-team-${teamId}`,
      activityKind: TEAM_KIND[team.type],
      schoolYear: team.schoolYear,
      projectName: team.name,
      docType: "연구계획서",
      title: plan?.title ?? null,
      phase: status === "draft" && !content ? "not_started" : deriveReviewPhase(status, plan?.feedback),
      feedback: plan?.feedback ?? null,
      submittedAt: plan?.submitted_at ?? null,
      updatedAt: plan?.reviewed_at ?? plan?.updated_at ?? null,
      href: `/${route}/${teamId}?tab=plan`,
      currentContent: plan
        ? { 연구제목: plan.title, "연구 동기 및 목적": plan.motivation, "연구 방법": plan.method, "기대 결과": plan.expected_result }
        : null,
      currentAttachments: [],
      snapshots: [],
      
      snapshotKey: plan ? `research_plans:${plan.id}` : null,
    });
  }

  // ── 팀(R&E/동아리) 결과보고서 ──────────────────────────────────────────
  for (const teamId of teamIds) {
    const team = teamMap[teamId];
    if (!team) continue;
    const report = ((teamReportRows ?? []) as ResearchReport[]).find((r) => r.team_id === teamId) ?? null;
    const route = TEAM_ROUTE[team.type];
    const status = report?.status ?? "draft";
    if (status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    const content = report != null && hasReportContentFields(report, report.file_url);
    const primaryAttachment = submittedReportAttachment(report, { schoolYear: team.schoolYear, activityKind: TEAM_KIND[team.type], who: team.name });
    items.push({
      id: `report-team-${teamId}`,
      activityKind: TEAM_KIND[team.type],
      schoolYear: team.schoolYear,
      projectName: team.name,
      docType: "결과보고서",
      title: report?.title ?? null,
      phase: status === "draft" && !content ? "not_started" : deriveReviewPhase(status, report?.feedback),
      feedback: report?.feedback ?? null,
      submittedAt: report?.submitted_at ?? null,
      updatedAt: report?.reviewed_at ?? report?.updated_at ?? null,
      href: `/${route}/${teamId}?tab=report`,
      currentContent: reportCurrentContent(report),
      currentAttachments: report
        ? [...(primaryAttachment ? [primaryAttachment] : []), ...attachmentsFrom(report.extra_file_urls ?? [])]
        : [],
      snapshots: [],

      snapshotKey: report ? `research_reports:${report.id}` : null,
    });
  }

  // ── 창의개인연구 연구계획서 ────────────────────────────────────────────
  for (const research of individuals) {
    const content = hasPlanContent(research.plan_motivation, research.plan_method, research.plan_expected);
    const status = research.plan_status ?? "draft";
    if (status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    items.push({
      id: `plan-indiv-${research.id}`,
      activityKind: "창의개인연구",
      schoolYear: research.year != null ? String(research.year) : null,
      projectName: research.title,
      docType: "연구계획서",
      title: null,
      phase: status === "draft" && !content ? "not_started" : deriveReviewPhase(status, research.plan_feedback),
      feedback: research.plan_feedback ?? null,
      submittedAt: research.plan_submitted_at ?? null,
      updatedAt: research.plan_reviewed_at ?? null,
      href: `/individual/${research.id}?tab=plan`,
      currentContent: {
        "연구 동기 및 목적": research.plan_motivation,
        "연구 방법": research.plan_method,
        "기대 결과": research.plan_expected,
      },
      currentAttachments: attachmentsFrom(research.plan_file_urls ?? []),
      snapshots: [],
      
      snapshotKey: `individual_research:${research.id}`,
    });
  }

  // ── 창의개인연구 결과보고서 ────────────────────────────────────────────
  for (const research of individuals) {
    const report = ((indivReportRows ?? []) as ResearchReport[]).find((r) => r.entity_id === research.id) ?? null;
    const status = report?.status ?? "draft";
    if (status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    const content = report != null && hasReportContentFields(report, report.file_url);
    const primaryAttachment = submittedReportAttachment(report, {
      schoolYear: research.year != null ? String(research.year) : null,
      activityKind: "창의개인연구",
      who: research.title,
    });
    items.push({
      id: `report-indiv-${research.id}`,
      activityKind: "창의개인연구",
      schoolYear: research.year != null ? String(research.year) : null,
      projectName: research.title,
      docType: "결과보고서",
      title: report?.title ?? null,
      phase: status === "draft" && !content ? "not_started" : deriveReviewPhase(status, report?.feedback),
      feedback: report?.feedback ?? null,
      submittedAt: report?.submitted_at ?? null,
      updatedAt: report?.reviewed_at ?? report?.updated_at ?? null,
      href: `/individual/${research.id}?tab=report`,
      currentContent: reportCurrentContent(report),
      currentAttachments: report
        ? [...(primaryAttachment ? [primaryAttachment] : []), ...attachmentsFrom(report.extra_file_urls ?? [])]
        : [],
      snapshots: [],

      snapshotKey: report ? `research_reports:${report.id}` : null,
    });
  }

  // ── 연구일지(본인이 작성한 것만) — 팀/개인/기타활동 전부 포함 ───────────
  // activity_logs는 검토(rejected) 후 다시 수정할 UI 경로가 없어(제출됨/승인/반려 후 불변),
  // 행 자체가 이미 "제출 당시 내용"이다 — 별도 스냅샷이 필요 없다.
  for (const log of logs) {
    if (log.status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    let activityKind: HubActivityKind;
    let projectName: string;
    let href: string;
    let schoolYear: string | null;
    if (log.entity_type === "team") {
      const team = teamMap[log.entity_id];
      if (!team) continue; // 이미 탈퇴 등으로 접근 불가한 팀 — 목록에서 제외
      activityKind = TEAM_KIND[team.type];
      projectName = team.name;
      schoolYear = team.schoolYear;
      href = log.status === "draft" ? `/${TEAM_ROUTE[team.type]}/${log.entity_id}?tab=logs&compose=1` : `/${TEAM_ROUTE[team.type]}/${log.entity_id}?tab=logs&log=${log.id}`;
    } else if (log.entity_type === "individual") {
      const research = individualMap[log.entity_id];
      if (!research) continue;
      activityKind = "창의개인연구";
      projectName = research.title;
      schoolYear = research.year != null ? String(research.year) : null;
      href = log.status === "draft" ? `/individual/${log.entity_id}?tab=logs&compose=1` : `/individual/${log.entity_id}?tab=logs&log=${log.id}`;
    } else {
      activityKind = "기타 활동";
      projectName = "기타 활동";
      // 기타활동은 별도 학년도 필드가 없어, 활동일(log_date) 연도로 대신한다.
      schoolYear = log.log_date ? String(new Date(log.log_date).getFullYear()) : null;
      href = `/other/${log.entity_id}`;
    }

    const participants = participantsByLog[log.id] ?? [];
    const mine = participants.find((p) => p.student_id === userId);
    const content: Record<string, unknown> = {};
    if (log.goal) content["오늘의 목표"] = log.goal;
    const activityText = log.experiment ?? log.free_memo ?? log.activity_content;
    if (activityText) content["오늘의 연구 활동"] = activityText;
    if (log.result) content["주요 결과 및 관찰"] = log.result;
    if (log.interpretation) content["해석 및 판단"] = log.interpretation;
    if (log.conclusion) content["문제점 / 특이사항"] = log.conclusion;
    if (log.next_plan) content["다음 활동과 그 이유"] = log.next_plan;
    if (log.achievement) content["성과 및 소감"] = log.achievement;
    if (participants.length > 0) {
      content["참여자"] = participants.map((p) => ({
        name: userNames[p.student_id] ?? (p.student_id === userId ? "나" : "알 수 없음"),
        roles: (p.roles ?? []).map((r) => ACTIVITY_ROLE_LABEL[r]),
        description: p.role_description,
      }));
    }
    if (mine) {
      content["나의 역할"] = (mine.roles ?? []).map((r) => ACTIVITY_ROLE_LABEL[r]).join(" / ") || "역할 미입력";
      if (mine.role_description) content["구체적으로 한 일"] = mine.role_description;
    }

    items.push({
      id: `log-${log.id}`,
      activityKind,
      schoolYear,
      projectName,
      docType: "연구일지",
      title: log.title,
      phase: deriveReviewPhase(log.status, log.teacher_feedback),
      feedback: log.teacher_feedback ?? null,
      submittedAt: log.status === "draft" ? null : log.log_date,
      updatedAt: log.created_at,
      href,
      currentContent: Object.keys(content).length > 0 ? content : null,
      currentAttachments: attachmentsFrom(log.file_urls ?? []),
      snapshots: [],
      
      snapshotKey: null,
    });
  }

  // ── 스냅샷 일괄 조회 & 부착 ────────────────────────────────────────────
  const snapshotTargets: { sourceTable: SnapshotSourceTable; sourceId: string }[] = [];
  for (const item of items) {
    if (!item.snapshotKey) continue;
    const [sourceTable, sourceId] = item.snapshotKey.split(":") as [SnapshotSourceTable, string];
    snapshotTargets.push({ sourceTable, sourceId });
  }
  const snapshotMap = snapshotTargets.length > 0 ? await fetchSnapshotsFor(snapshotTargets) : {};

  return items.map(({ snapshotKey, ...item }): HubItem => {
    const raw = snapshotKey ? snapshotMap[snapshotKey] ?? [] : [];
    return {
      ...item,
      snapshots: raw.map((s) => ({ submittedAt: s.submitted_at, status: s.status, feedback: s.feedback, content: s.content })),
    };
  });
}

/**
 * 이 항목의 "제출 시점" 첨부파일 — 스냅샷이 있으면 가장 최근 제출의 첨부(제출 당시 버전),
 * 없으면 현재 원본 첨부로 폴백한다(그 경우도 실제로는 최신 파일이라 거짓 표시가 아니다).
 */
export function latestAttachmentsOf(item: HubItem): { name: string; url: string }[] {
  return item.snapshots.at(-1)?.content.attachments ?? item.currentAttachments;
}

/** 사이드바 배지 — "지금 학생이 행동해야 하는" 항목만 센다(수정 요청만; 초안은 근거 데이터가 없어 제외). */
export async function fetchActionableSubmissionCount(userId: string): Promise<number> {
  const items = await fetchStudentSubmissionHub(userId);
  return items.filter((i) => i.phase === "revision_requested").length;
}

// ─── 교사 "제출물 보관함" ─────────────────────────────────────────────────
// 학생 허브와 동일한 source of truth(research_plans/research_reports/
// individual_research/activity_logs + submission_snapshots)를 그대로 재사용하되,
// 스코프를 "학생 허브"에서 교사/관리자 관점으로 바꾸고, 제출자 이름을 붙인다.
// 조회 범위는 "연구 단위 ownership"이다: 교사는 본인이 담당(teacher_id)하는 팀(R&E/동아리)과
// 창의개인연구의 제출물만, 관리자는 학교 전체를 본다. 학생 단위로 거르지 않는다 — 같은 학생의
// R&E는 교사 A가, 동아리는 교사 B가 담당하면 각자 자기 연구의 제출물만 보인다.
// (034의 "교사는 전체 읽기" RLS는 학생 포트폴리오용이라 그대로 두고, 이 화면의 범위는 아래 쿼리가 정한다.)
// 기타 활동(entity_type이 team/individual이 아닌 로그)은 기존 archive 페이지에서도
// 교사에게 노출된 적이 없다 — 특정 교사에게 귀속되는 구조가 아니기 때문에 그대로 제외한다.

export interface TeacherArchiveItem extends HubItem {
  /** 팀 제출물은 팀원 전체, 개인연구는 학생 1명, 연구일지는 그 회차의 실제 참여자(없으면 작성자). */
  studentNames: string[];
  /** 승인/수정요청 시 src/lib/review/actions.ts의 기존 mutation을 그대로 재사용하기 위한 대상. */
  reviewTarget: ReviewTarget;
  /** 이 제출물에 review action을 할 수 있는지 — admin이거나 해당 팀/개인연구의 담당 교사일 때만 true. */
  canReview: boolean;
}

interface TeacherArchiveItemDraft extends TeacherArchiveItem {
  snapshotKey: string | null;
}

export async function fetchTeacherSubmissionArchive(userId: string, isAdmin: boolean): Promise<TeacherArchiveItem[]> {
  const supabase = createClient();

  // 모든 하위 조회(계획서/보고서/연구일지/참여자/스냅샷)가 아래 두 목록의 id에서 파생되므로,
  // 여기서 담당 연구로 한정하면 전체/검토 필요/수정 요청/승인 완료 탭, 검색·필터·페이지, 일괄 승인,
  // 다운로드·이력·내보내기가 모두 같은 범위를 쓴다. 관리자는 기존처럼 전체.
  let teamQuery = supabase.from("teams").select("id,type,name,teacher_id,school_year");
  let indivQuery = supabase.from("individual_research").select("*");
  if (!isAdmin) {
    teamQuery = teamQuery.eq("teacher_id", userId);
    indivQuery = indivQuery.eq("teacher_id", userId);
  }
  const [{ data: teamRows }, { data: indivRows }] = await Promise.all([teamQuery, indivQuery]);

  const teamMap: Record<string, { type: "rne" | "club"; name: string; teacherId: string | null; schoolYear: string | null }> = {};
  const teamIds: string[] = [];
  for (const t of (teamRows ?? []) as { id: string; type: string; name: string; teacher_id: string | null; school_year: string | null }[]) {
    if (t.type !== "rne" && t.type !== "club") continue;
    teamMap[t.id] = { type: t.type, name: t.name, teacherId: t.teacher_id, schoolYear: t.school_year };
    teamIds.push(t.id);
  }
  const individuals = (indivRows ?? []) as IndividualResearch[];
  const individualMap: Record<string, IndividualResearch> = {};
  for (const r of individuals) individualMap[r.id] = r;
  const individualIds = individuals.map((r) => r.id);

  // review action은 admin 또는 해당 프로젝트의 담당 교사만 — 쓰기 RLS(032)와 같은 기준이다.
  // 조회 범위가 이미 담당 연구로 한정돼 교사 화면의 항목은 모두 true지만, 방어적으로 그대로 둔다.
  const canReviewTeam = (teamId: string) => isAdmin || teamMap[teamId]?.teacherId === userId;
  const canReviewIndividual = (research: IndividualResearch) => isAdmin || research.teacher_id === userId;

  const orParts: string[] = [];
  if (teamIds.length > 0) orParts.push(`and(entity_type.eq.team,entity_id.in.(${teamIds.join(",")}))`);
  if (individualIds.length > 0) orParts.push(`and(entity_type.eq.individual,entity_id.in.(${individualIds.join(",")}))`);

  const [{ data: teamPlanRows }, { data: teamReportRows }, { data: indivReportRows }, { data: logRows }, { data: memberRows }] =
    await Promise.all([
      teamIds.length > 0 ? supabase.from("research_plans").select("*").in("team_id", teamIds) : Promise.resolve({ data: [] as ResearchPlan[] }),
      teamIds.length > 0 ? supabase.from("research_reports").select("*").in("team_id", teamIds) : Promise.resolve({ data: [] as ResearchReport[] }),
      individualIds.length > 0
        ? supabase.from("research_reports").select("*").eq("entity_type", "individual").in("entity_id", individualIds)
        : Promise.resolve({ data: [] as ResearchReport[] }),
      orParts.length > 0
        ? supabase.from("activity_logs").select("*").neq("log_type", "personal").or(orParts.join(",")).order("log_date", { ascending: false, nullsFirst: false })
        : Promise.resolve({ data: [] as ActivityLog[] }),
      teamIds.length > 0
        ? supabase.from("team_members").select("team_id,student_id").in("team_id", teamIds)
        : Promise.resolve({ data: [] as { team_id: string; student_id: string }[] }),
    ]);

  const teamMemberIds: Record<string, string[]> = {};
  for (const m of (memberRows ?? []) as { team_id: string; student_id: string }[]) {
    (teamMemberIds[m.team_id] ??= []).push(m.student_id);
  }

  const logs = (logRows ?? []) as ActivityLog[];
  const logIds = logs.map((l) => l.id);
  const participantsByLog: Record<string, ActivityLogParticipant[]> = {};
  if (logIds.length > 0) {
    const { data: pData } = await supabase.from("activity_log_participants").select("*").in("log_id", logIds);
    for (const p of (pData as ActivityLogParticipant[]) ?? []) (participantsByLog[p.log_id] ??= []).push(p);
  }

  // 이름 해석에 필요한 모든 user id를 한 번에 모아 한 번만 조회한다.
  const nameIds = new Set<string>();
  for (const ids of Object.values(teamMemberIds)) for (const id of ids) nameIds.add(id);
  for (const r of individuals) nameIds.add(r.student_id);
  for (const l of logs) nameIds.add(l.author_id);
  for (const ps of Object.values(participantsByLog)) for (const p of ps) nameIds.add(p.student_id);
  let userNames: Record<string, string> = {};
  if (nameIds.size > 0) {
    const { data: users } = await supabase.from("users").select("id,name").in("id", [...nameIds]);
    userNames = Object.fromEntries(((users ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  }
  const nameOf = (id: string) => userNames[id] ?? "알 수 없음";
  const teamStudentNames = (teamId: string): string[] => (teamMemberIds[teamId] ?? []).map(nameOf);

  // 창의개인연구 계획서 승인/수정요청 시 함께 갱신해야 하는 미러 research_plans.id
  // (review/actions.ts의 기존 ReviewTarget.linkedPlanId 규약 — ReviewClient와 동일하게 재사용).
  const linkedPlanIdByIndivId: Record<string, string> = {};
  if (individualIds.length > 0) {
    const { data: mirrorRows } = await supabase
      .from("research_plans")
      .select("id,entity_id")
      .eq("entity_type", "individual")
      .in("entity_id", individualIds);
    for (const m of (mirrorRows ?? []) as { id: string; entity_id: string }[]) linkedPlanIdByIndivId[m.entity_id] = m.id;
  }

  const items: TeacherArchiveItemDraft[] = [];

  // ── 팀 연구계획서 ──────────────────────────────────────────────────────
  for (const teamId of teamIds) {
    const team = teamMap[teamId];
    const plan = ((teamPlanRows ?? []) as ResearchPlan[]).find((p) => p.team_id === teamId) ?? null;
    const route = TEAM_ROUTE[team.type];
    const status = plan?.status ?? "draft";
    if (status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    if (status === "draft") continue; // 아직 제출 전(작성 중/미작성)인 문서는 "보관함"에 표시할 대상이 아니다.
    items.push({
      id: `plan-team-${teamId}`,
      activityKind: TEAM_KIND[team.type],
      schoolYear: team.schoolYear,
      projectName: team.name,
      docType: "연구계획서",
      title: plan?.title ?? null,
      phase: deriveReviewPhase(status, plan?.feedback),
      feedback: plan?.feedback ?? null,
      submittedAt: plan?.submitted_at ?? null,
      updatedAt: plan?.reviewed_at ?? plan?.updated_at ?? null,
      href: `/${route}/${teamId}?tab=plan`,
      currentContent: plan
        ? { 연구제목: plan.title, "연구 동기 및 목적": plan.motivation, "연구 방법": plan.method, "기대 결과": plan.expected_result }
        : null,
      currentAttachments: [],
      snapshots: [],
      studentNames: teamStudentNames(teamId),
      reviewTarget: { table: "research_plans", id: plan!.id },
      canReview: canReviewTeam(teamId),
      snapshotKey: plan ? `research_plans:${plan.id}` : null,
    });
  }

  // ── 팀 결과보고서 ──────────────────────────────────────────────────────
  for (const teamId of teamIds) {
    const team = teamMap[teamId];
    const report = ((teamReportRows ?? []) as ResearchReport[]).find((r) => r.team_id === teamId) ?? null;
    const route = TEAM_ROUTE[team.type];
    const status = report?.status ?? "draft";
    if (status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    if (status === "draft") continue;
    const teamNames = teamStudentNames(teamId);
    const primaryAttachment = submittedReportAttachment(report, {
      schoolYear: team.schoolYear,
      activityKind: TEAM_KIND[team.type],
      who: teamNames.length > 0 ? teamNames.join(", ") : team.name,
    });
    items.push({
      id: `report-team-${teamId}`,
      activityKind: TEAM_KIND[team.type],
      schoolYear: team.schoolYear,
      projectName: team.name,
      docType: "결과보고서",
      title: report?.title ?? null,
      phase: deriveReviewPhase(status, report?.feedback),
      feedback: report?.feedback ?? null,
      submittedAt: report?.submitted_at ?? null,
      updatedAt: report?.reviewed_at ?? report?.updated_at ?? null,
      href: `/${route}/${teamId}?tab=report`,
      currentContent: reportCurrentContent(report),
      currentAttachments: report
        ? [...(primaryAttachment ? [primaryAttachment] : []), ...attachmentsFrom(report.extra_file_urls ?? [])]
        : [],
      snapshots: [],
      studentNames: teamNames,
      reviewTarget: { table: "research_reports", id: report!.id },
      canReview: canReviewTeam(teamId),
      snapshotKey: report ? `research_reports:${report.id}` : null,
    });
  }

  // ── 창의개인연구 연구계획서 ────────────────────────────────────────────
  for (const research of individuals) {
    const status = research.plan_status ?? "draft";
    if (status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    if (status === "draft") continue;
    items.push({
      id: `plan-indiv-${research.id}`,
      activityKind: "창의개인연구",
      schoolYear: research.year != null ? String(research.year) : null,
      projectName: research.title,
      docType: "연구계획서",
      title: null,
      phase: deriveReviewPhase(status, research.plan_feedback),
      feedback: research.plan_feedback ?? null,
      submittedAt: research.plan_submitted_at ?? null,
      updatedAt: research.plan_reviewed_at ?? null,
      href: `/individual/${research.id}?tab=plan`,
      currentContent: {
        "연구 동기 및 목적": research.plan_motivation,
        "연구 방법": research.plan_method,
        "기대 결과": research.plan_expected,
      },
      currentAttachments: attachmentsFrom(research.plan_file_urls ?? []),
      snapshots: [],
      studentNames: [nameOf(research.student_id)],
      reviewTarget: { table: "individual_research", id: research.id, linkedPlanId: linkedPlanIdByIndivId[research.id] ?? null },
      canReview: canReviewIndividual(research),
      snapshotKey: `individual_research:${research.id}`,
    });
  }

  // ── 창의개인연구 결과보고서 ────────────────────────────────────────────
  for (const research of individuals) {
    const report = ((indivReportRows ?? []) as ResearchReport[]).find((r) => r.entity_id === research.id) ?? null;
    const status = report?.status ?? "draft";
    if (status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    if (status === "draft") continue;
    const primaryAttachment = submittedReportAttachment(report, {
      schoolYear: research.year != null ? String(research.year) : null,
      activityKind: "창의개인연구",
      who: nameOf(research.student_id),
    });
    items.push({
      id: `report-indiv-${research.id}`,
      activityKind: "창의개인연구",
      schoolYear: research.year != null ? String(research.year) : null,
      projectName: research.title,
      docType: "결과보고서",
      title: report?.title ?? null,
      phase: deriveReviewPhase(status, report?.feedback),
      feedback: report?.feedback ?? null,
      submittedAt: report?.submitted_at ?? null,
      updatedAt: report?.reviewed_at ?? report?.updated_at ?? null,
      href: `/individual/${research.id}?tab=report`,
      currentContent: reportCurrentContent(report),
      currentAttachments: report
        ? [...(primaryAttachment ? [primaryAttachment] : []), ...attachmentsFrom(report.extra_file_urls ?? [])]
        : [],
      snapshots: [],
      studentNames: [nameOf(research.student_id)],
      reviewTarget: { table: "research_reports", id: report!.id },
      canReview: canReviewIndividual(research),
      snapshotKey: report ? `research_reports:${report.id}` : null,
    });
  }

  // ── 연구일지(팀/개인연구 소속 전체 — 작성자 무관하게 전부) ──────────────
  for (const log of logs) {
    if (log.status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    // 아직 제출 전(draft)인 로그는 "학생이 작성 중"인 상태라 교사 보관함(제출된 것만)의 대상이 아니다.
    if (log.status === "draft") continue;

    let activityKind: HubActivityKind;
    let projectName: string;
    let href: string;
    let schoolYear: string | null;
    let canReview: boolean;
    if (log.entity_type === "team") {
      const team = teamMap[log.entity_id];
      if (!team) continue;
      activityKind = TEAM_KIND[team.type];
      projectName = team.name;
      schoolYear = team.schoolYear;
      canReview = canReviewTeam(log.entity_id);
      href = `/${TEAM_ROUTE[team.type]}/${log.entity_id}?tab=logs&log=${log.id}`;
    } else if (log.entity_type === "individual") {
      const research = individualMap[log.entity_id];
      if (!research) continue;
      activityKind = "창의개인연구";
      projectName = research.title;
      schoolYear = research.year != null ? String(research.year) : null;
      canReview = canReviewIndividual(research);
      href = `/individual/${log.entity_id}?tab=logs&log=${log.id}`;
    } else {
      continue; // 기타 활동은 특정 교사에게 귀속되지 않아 이 보관함의 스코프 밖이다.
    }

    const participants = participantsByLog[log.id] ?? [];
    const content: Record<string, unknown> = {};
    if (log.goal) content["오늘의 목표"] = log.goal;
    const activityText = log.experiment ?? log.free_memo ?? log.activity_content;
    if (activityText) content["오늘의 연구 활동"] = activityText;
    if (log.result) content["주요 결과 및 관찰"] = log.result;
    if (log.interpretation) content["해석 및 판단"] = log.interpretation;
    if (log.conclusion) content["문제점 / 특이사항"] = log.conclusion;
    if (log.next_plan) content["다음 활동과 그 이유"] = log.next_plan;
    if (log.achievement) content["성과 및 소감"] = log.achievement;
    if (participants.length > 0) {
      content["참여자"] = participants.map((p) => ({
        name: nameOf(p.student_id),
        roles: (p.roles ?? []).map((r) => ACTIVITY_ROLE_LABEL[r]),
        description: p.role_description,
      }));
    }

    items.push({
      id: `log-${log.id}`,
      activityKind,
      schoolYear,
      projectName,
      docType: "연구일지",
      title: log.title,
      phase: deriveReviewPhase(log.status, log.teacher_feedback),
      feedback: log.teacher_feedback ?? null,
      submittedAt: log.log_date,
      updatedAt: log.created_at,
      href,
      currentContent: Object.keys(content).length > 0 ? content : null,
      currentAttachments: attachmentsFrom(log.file_urls ?? []),
      snapshots: [],
      // 그 회차에 실제 참여한 학생들 — 참여자 기록이 없으면(과거 데이터 등) 작성자로 폴백.
      studentNames: participants.length > 0 ? participants.map((p) => nameOf(p.student_id)) : [nameOf(log.author_id)],
      reviewTarget: { table: "activity_logs", id: log.id },
      canReview,
      snapshotKey: null,
    });
  }

  // ── 스냅샷 일괄 조회 & 부착 ────────────────────────────────────────────
  const snapshotTargets: { sourceTable: SnapshotSourceTable; sourceId: string }[] = [];
  for (const item of items) {
    if (!item.snapshotKey) continue;
    const [sourceTable, sourceId] = item.snapshotKey.split(":") as [SnapshotSourceTable, string];
    snapshotTargets.push({ sourceTable, sourceId });
  }
  const snapshotMap = snapshotTargets.length > 0 ? await fetchSnapshotsFor(snapshotTargets) : {};

  return items.map(({ snapshotKey, ...item }): TeacherArchiveItem => {
    const raw = snapshotKey ? snapshotMap[snapshotKey] ?? [] : [];
    return {
      ...item,
      snapshots: raw.map((s) => ({ submittedAt: s.submitted_at, status: s.status, feedback: s.feedback, content: s.content })),
    };
  });
}

// ─── 프로젝트(R&E/동아리/창의개인연구) 상세 페이지의 "전체 내보내기" ──────────
// 학생/교사 제출물 화면과 똑같은 선택 내보내기(작성내용/제출PDF/첨부/피드백/이력,
// 통합 PDF 또는 ZIP)를 팀·개인연구 상세 페이지에서도 그대로 쓰기 위한 항목 조회.
// 위 두 함수(학생 허브/교사 보관함)와 같은 source of truth·같은 스냅샷 규약을
// 재사용하되, 스코프를 "이 프로젝트 하나"로 좁힌 버전이다.

export interface ProjectExportContext {
  activityKind: HubActivityKind;
  /** rne/club은 team.id, individual은 null */
  teamId: string | null;
  /** individual은 individual_research.id, rne/club은 null */
  individualId: string | null;
  schoolYear: string | null;
  projectName: string;
  studentNames: string[];
  /** 항목 상세로 이동할 기본 경로 — 예: `/rne/${teamId}` 또는 `/individual/${id}` */
  basePath: string;
}

interface ProjectExportItemDraft extends ExportableSubmissionLike {
  snapshotKey: string | null;
}

/** submissions/hub.ts 밖(export/submission-export.ts)의 ExportableSubmission과 필드가 같아야 하므로 로컬로 그 shape만 정의한다. */
interface ExportableSubmissionLike extends HubItem {
  studentNames?: string[];
}

export async function fetchProjectExportItems(ctx: ProjectExportContext): Promise<ExportableSubmissionLike[]> {
  const supabase = createClient();
  const isTeam = ctx.teamId != null;

  const [{ data: planRow }, { data: individualRow }, { data: reportRow }, { data: logRows }] = await Promise.all([
    isTeam
      ? supabase.from("research_plans").select("*").eq("team_id", ctx.teamId).maybeSingle()
      : Promise.resolve({ data: null }),
    isTeam ? Promise.resolve({ data: null }) : supabase.from("individual_research").select("*").eq("id", ctx.individualId).maybeSingle(),
    isTeam
      ? supabase.from("research_reports").select("*").eq("team_id", ctx.teamId).maybeSingle()
      : supabase.from("research_reports").select("*").eq("entity_type", "individual").eq("entity_id", ctx.individualId).maybeSingle(),
    supabase
      .from("activity_logs")
      .select("*")
      .eq("entity_type", isTeam ? "team" : "individual")
      .eq("entity_id", (isTeam ? ctx.teamId : ctx.individualId) as string)
      .neq("status", "draft")
      .neq("log_type", "personal")
      .order("log_date", { ascending: true }),
  ]);

  const plan = planRow as ResearchPlan | null;
  const individual = individualRow as IndividualResearch | null;
  const report = reportRow as ResearchReport | null;
  const logs = (logRows ?? []) as ActivityLog[];

  const logIds = logs.map((l) => l.id);
  const participantsByLog: Record<string, ActivityLogParticipant[]> = {};
  let userNames: Record<string, string> = {};
  if (logIds.length > 0) {
    const { data: pData } = await supabase.from("activity_log_participants").select("*").in("log_id", logIds);
    const participants = (pData as ActivityLogParticipant[]) ?? [];
    for (const p of participants) (participantsByLog[p.log_id] ??= []).push(p);
    const nameIds = [...new Set(participants.map((p) => p.student_id))];
    if (nameIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id,name").in("id", nameIds);
      userNames = Object.fromEntries(((users ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    }
  }

  const items: ProjectExportItemDraft[] = [];

  // ── 연구계획서 ───────────────────────────────────────────────────────────
  if (isTeam) {
    const status = plan?.status ?? "draft";
    if (status !== "historical" && (status !== "draft" || hasPlanContent(plan?.motivation ?? null, plan?.method ?? null, plan?.expected_result ?? null))) {
      items.push({
        id: `plan-${ctx.teamId}`,
        activityKind: ctx.activityKind,
        schoolYear: ctx.schoolYear,
        projectName: ctx.projectName,
        docType: "연구계획서",
        title: plan?.title ?? null,
        phase: deriveReviewPhase(status, plan?.feedback),
        feedback: plan?.feedback ?? null,
        submittedAt: plan?.submitted_at ?? null,
        updatedAt: plan?.reviewed_at ?? plan?.updated_at ?? null,
        href: `${ctx.basePath}?tab=plan`,
        currentContent: plan
          ? { 연구제목: plan.title, "연구 동기 및 목적": plan.motivation, "연구 방법": plan.method, "기대 결과": plan.expected_result }
          : null,
        currentAttachments: [],
        snapshots: [],
        studentNames: ctx.studentNames,
        snapshotKey: plan ? `research_plans:${plan.id}` : null,
      });
    }
  } else if (individual) {
    const status = individual.plan_status ?? "draft";
    if (status !== "historical" && (status !== "draft" || hasPlanContent(individual.plan_motivation, individual.plan_method, individual.plan_expected))) {
      items.push({
        id: `plan-${ctx.individualId}`,
        activityKind: ctx.activityKind,
        schoolYear: ctx.schoolYear,
        projectName: ctx.projectName,
        docType: "연구계획서",
        title: null,
        phase: deriveReviewPhase(status, individual.plan_feedback),
        feedback: individual.plan_feedback ?? null,
        submittedAt: individual.plan_submitted_at ?? null,
        updatedAt: individual.plan_reviewed_at ?? null,
        href: `${ctx.basePath}?tab=plan`,
        currentContent: {
          "연구 동기 및 목적": individual.plan_motivation,
          "연구 방법": individual.plan_method,
          "기대 결과": individual.plan_expected,
        },
        currentAttachments: attachmentsFrom(individual.plan_file_urls ?? []),
        snapshots: [],
        studentNames: ctx.studentNames,
        snapshotKey: `individual_research:${ctx.individualId}`,
      });
    }
  }

  // ── 결과보고서 ───────────────────────────────────────────────────────────
  {
    const status = report?.status ?? "draft";
    if (status !== "historical" && (status !== "draft" || (report != null && hasReportContentFields(report, report.file_url)))) {
      const primaryAttachment = submittedReportAttachment(report, {
        schoolYear: ctx.schoolYear,
        activityKind: ctx.activityKind,
        who: ctx.studentNames.length > 0 ? ctx.studentNames.join(", ") : ctx.projectName,
      });
      items.push({
        id: `report-${ctx.teamId ?? ctx.individualId}`,
        activityKind: ctx.activityKind,
        schoolYear: ctx.schoolYear,
        projectName: ctx.projectName,
        docType: "결과보고서",
        title: report?.title ?? null,
        phase: deriveReviewPhase(status, report?.feedback),
        feedback: report?.feedback ?? null,
        submittedAt: report?.submitted_at ?? null,
        updatedAt: report?.reviewed_at ?? report?.updated_at ?? null,
        href: `${ctx.basePath}?tab=report`,
        currentContent: reportCurrentContent(report),
        currentAttachments: report
          ? [...(primaryAttachment ? [primaryAttachment] : []), ...attachmentsFrom(report.extra_file_urls ?? [])]
          : [],
        snapshots: [],
        studentNames: ctx.studentNames,
        snapshotKey: report ? `research_reports:${report.id}` : null,
      });
    }
  }

  // ── 연구일지 ─────────────────────────────────────────────────────────────
  for (const log of logs) {
    if (log.status === "historical") continue; // historical(과거 기록)은 제출/검토 workflow 대상이 아니다
    const participants = participantsByLog[log.id] ?? [];
    const content: Record<string, unknown> = {};
    if (log.goal) content["오늘의 목표"] = log.goal;
    const activityText = log.experiment ?? log.free_memo ?? log.activity_content;
    if (activityText) content["오늘의 연구 활동"] = activityText;
    if (log.result) content["주요 결과 및 관찰"] = log.result;
    if (log.interpretation) content["해석 및 판단"] = log.interpretation;
    if (log.conclusion) content["문제점 / 특이사항"] = log.conclusion;
    if (log.next_plan) content["다음 활동과 그 이유"] = log.next_plan;
    if (log.achievement) content["성과 및 소감"] = log.achievement;
    if (participants.length > 0) {
      content["참여자"] = participants.map((p) => ({
        name: userNames[p.student_id] ?? "알 수 없음",
        roles: (p.roles ?? []).map((r) => ACTIVITY_ROLE_LABEL[r]),
        description: p.role_description,
      }));
    }

    items.push({
      id: `log-${log.id}`,
      activityKind: ctx.activityKind,
      schoolYear: ctx.schoolYear,
      projectName: ctx.projectName,
      docType: "연구일지",
      title: log.title,
      phase: deriveReviewPhase(log.status, log.teacher_feedback),
      feedback: log.teacher_feedback ?? null,
      submittedAt: log.log_date,
      updatedAt: log.created_at,
      href: `${ctx.basePath}?tab=logs&log=${log.id}`,
      currentContent: Object.keys(content).length > 0 ? content : null,
      currentAttachments: attachmentsFrom(log.file_urls ?? []),
      snapshots: [],
      studentNames: ctx.studentNames,
      snapshotKey: null,
    });
  }

  // ── 스냅샷 일괄 조회 & 부착 ────────────────────────────────────────────
  const snapshotTargets: { sourceTable: SnapshotSourceTable; sourceId: string }[] = [];
  for (const item of items) {
    if (!item.snapshotKey) continue;
    const [sourceTable, sourceId] = item.snapshotKey.split(":") as [SnapshotSourceTable, string];
    snapshotTargets.push({ sourceTable, sourceId });
  }
  const snapshotMap = snapshotTargets.length > 0 ? await fetchSnapshotsFor(snapshotTargets) : {};

  return items.map(({ snapshotKey, ...item }): ExportableSubmissionLike => {
    const raw = snapshotKey ? snapshotMap[snapshotKey] ?? [] : [];
    return {
      ...item,
      snapshots: raw.map((s) => ({ submittedAt: s.submitted_at, status: s.status, feedback: s.feedback, content: s.content })),
    };
  });
}
