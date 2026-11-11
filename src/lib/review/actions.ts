import { createClient } from "@/lib/supabase";
import { markLatestSnapshotReviewed, type SnapshotSourceTable } from "@/lib/submissions/snapshot";

/**
 * 이 앱은 전역 상태 관리 라이브러리(React Query 등)를 쓰지 않고 각 화면이 직접
 * `onChanged`/`load()`로 자기 자신을 다시 불러오는 방식이다. 검토 배지 숫자는
 * 라우트 이동 시 재계산되지만, "같은 화면에 머무른 채 승인"한 경우까지 즉시
 * 반영하려면 화면 간에 알려줄 방법이 필요하다 — 새 상태 관리 도구를 들이는 대신
 * 가벼운 브라우저 커스텀 이벤트로 "검토 상태가 바뀌었다"만 알린다.
 */
const REVIEW_CHANGED_EVENT = "scilog:review-changed";

/** 학생의 제출/재제출 화면(PlanSection/ReportSection/JournalTimeline)도 제출 직후 이 이벤트를 쏴서, 사이드바의 "제출물" 배지가 새로고침 없이 즉시 갱신되게 한다. */
export function notifyReviewChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REVIEW_CHANGED_EVENT));
}

export function onReviewChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEW_CHANGED_EVENT, handler);
  return () => window.removeEventListener(REVIEW_CHANGED_EVENT, handler);
}

// 교사 검토(승인/수정요청) 공용 mutation — 왼쪽 "검토" Inbox(ReviewClient)와
// 학생/팀 R&E 페이지(PlanSection/ReportSection/JournalTimeline)가 동일하게 호출한다.
// 제출/검토 상태의 source of truth는 새 테이블이 아니라 기존 테이블 그대로다:
//   - individual_research.plan_status / plan_feedback / plan_reviewed_at (창의개인 계획서)
//   - research_plans.status / feedback / reviewed_at (팀 계획서 + 개인 계획서 미러 행)
//   - research_reports.status / feedback / reviewed_at (팀/개인 결과보고서)
//   - activity_logs.status / teacher_feedback (연구일지)

export type ReviewDbTable = "individual_research" | "research_plans" | "activity_logs" | "research_reports";

export interface ReviewTarget {
  table: ReviewDbTable;
  id: string;
  /**
   * individual_research 승인/수정요청 시 함께 갱신해야 하는 미러 research_plans.id.
   * PlanSection의 handleSave가 제출 시 이 미러 행을 만들어두므로, 검토 결과도 항상
   * 두 곳에 같이 반영해야 두 화면(검토 Inbox / 팀·개인 페이지)이 어긋나지 않는다.
   */
  linkedPlanId?: string | null;
}

export type ReviewPhase = "draft" | "submitted" | "resubmitted" | "approved" | "revision_requested";

/**
 * 화면에 보여줄 검토 단계를 계산한다. 별도의 "재제출" 상태 컬럼이 없으므로,
 * "제출됨 + 이전 피드백이 남아있음"을 재제출(재검토 필요) 신호로 재사용한다 —
 * 승인 시에는 피드백을 건드리지 않는 기존 동작(ReviewClient) 때문에 approved 상태에서는
 * 이 값을 검사하지 않으므로 오탐이 없다.
 */
export function deriveReviewPhase(status: string, feedback: string | null | undefined): ReviewPhase {
  const norm = status === "pending" ? "submitted" : status;
  if (norm === "draft") return "draft";
  if (norm === "approved") return "approved";
  if (norm === "rejected") return "revision_requested";
  return feedback ? "resubmitted" : "submitted";
}

/**
 * 학생 화면(제출물 허브 등)에서 활동 종류와 무관하게 통일해서 쓰는 상태 표기.
 * 교사용 ReviewActionButtons의 "재검토 필요"(교사가 할 일)와 달리, 학생 쪽은
 * "재검토 중"(내가 할 일은 끝났고 기다리는 중)으로 관점이 달라 별도 라벨을 둔다.
 */
export const STUDENT_PHASE_LABEL: Record<ReviewPhase, string> = {
  draft: "작성 중",
  submitted: "검토 중",
  resubmitted: "재검토 중",
  revision_requested: "수정 요청",
  approved: "승인 완료",
};

async function setStatus(
  target: ReviewTarget,
  status: "approved" | "rejected" | "submitted" | "draft",
  feedback: string | null | undefined
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const now = new Date().toISOString();

  // 검토 결과(승인/수정요청)를 "가장 최근 제출 스냅샷"에도 남긴다 — 그래야
  // 재제출로 원본 행이 덮어써진 뒤에도 "1차 제출이 반려당했었다"는 사실이 남는다.
  // 스냅샷이 아예 없는 문서(과거 데이터, 또는 activity_logs)는 조용히 스킵된다.
  // "승인 취소"(status==="submitted"/"draft")는 원래 approved/rejected 중 무엇이었는지 알 수
  // 없으므로 스냅샷 쪽은 건드리지 않는다(승인/수정요청일 때만 기록).
  const recordsReview = status === "approved" || status === "rejected";
  const markSnapshot = (sourceTable: SnapshotSourceTable, sourceId: string) =>
    markLatestSnapshotReviewed(sourceTable, sourceId, status as "approved" | "rejected", feedback);

  if (target.table === "individual_research") {
    const patch: Record<string, unknown> = { plan_status: status, plan_reviewed_at: now };
    if (feedback !== undefined) patch.plan_feedback = feedback;
    const { error } = await supabase.from("individual_research").update(patch).eq("id", target.id);
    if (error) return { error: error.message };
    if (target.linkedPlanId) {
      const mirrorPatch: Record<string, unknown> = { status, reviewed_at: now, updated_at: now };
      if (feedback !== undefined) mirrorPatch.feedback = feedback;
      const { error: mirrorError } = await supabase.from("research_plans").update(mirrorPatch).eq("id", target.linkedPlanId);
      if (mirrorError) return { error: `검토 결과가 일부만 반영되었습니다: ${mirrorError.message}` };
    }
    if (recordsReview) await markSnapshot("individual_research", target.id);
    return { error: null };
  }

  if (target.table === "research_plans") {
    const patch: Record<string, unknown> = { status, reviewed_at: now, updated_at: now };
    if (feedback !== undefined) patch.feedback = feedback;
    const { error } = await supabase.from("research_plans").update(patch).eq("id", target.id);
    if (!error && recordsReview) await markSnapshot("research_plans", target.id);
    return { error: error?.message ?? null };
  }

  if (target.table === "activity_logs") {
    // activity_logs.status에는 'submitted' 값이 없다 — "검토 대기"는 DB상 'pending'으로 저장된다.
    const dbStatus = status === "submitted" ? "pending" : status;
    const patch: Record<string, unknown> = { status: dbStatus };
    if (feedback !== undefined) patch.teacher_feedback = feedback;
    const { error } = await supabase.from("activity_logs").update(patch).eq("id", target.id);
    return { error: error?.message ?? null };
  }

  // research_reports
  const patch: Record<string, unknown> = { status, reviewed_at: now, updated_at: now };
  if (feedback !== undefined) patch.feedback = feedback;
  const { error } = await supabase.from("research_reports").update(patch).eq("id", target.id);
  if (!error && recordsReview) await markSnapshot("research_reports", target.id);
  return { error: error?.message ?? null };
}

export async function approveSubmission(target: ReviewTarget): Promise<{ error: string | null }> {
  const result = await setStatus(target, "approved", undefined);
  if (!result.error) notifyReviewChanged();
  return result;
}

export async function requestRevision(target: ReviewTarget, reason: string): Promise<{ error: string | null }> {
  const trimmed = reason.trim();
  if (!trimmed) return { error: "수정 요청 사유를 입력해주세요." };
  const result = await setStatus(target, "rejected", trimmed);
  if (!result.error) notifyReviewChanged();
  return result;
}

/**
 * 승인을 취소한다 — 계획서/결과보고서는 draft(학생이 즉시 수정·재제출), 연구일지는 pending(기존 그대로).
 * reviewed_at은 취소 시각으로 갱신되고 feedback/submitted_at/스냅샷은 건드리지 않는다.
 * 상태 변경은 기존과 같은 setStatus를 그대로 쓰고, 실행 직전에 권한/상태를 DB에서 다시 확인한다:
 * admin이거나 해당 문서의 담당 교사일 때만, 현재 approved일 때만 진행한다(화면의 canReview를 믿지 않는다).
 * RLS가 막은 UPDATE는 에러 없이 0행이므로 실행 후 상태를 다시 읽어 실제로 되돌려졌는지도 확인한다.
 */
export async function undoApproval(target: ReviewTarget): Promise<{ error: string | null }> {
  const resolved = await resolveReviewRows([target]);
  if (resolved.kind === "denied") return { error: "승인을 취소할 권한이 없습니다." };
  if (resolved.kind === "error") return { error: "제출물 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." };
  const { uid, isAdmin, rows, mirrorByIndiv } = resolved;

  const row = rows.get(`${target.table}:${target.id}`);
  if (!row) return { error: "제출물을 찾을 수 없습니다." };
  if (!isAdmin && (row.owner == null || row.owner !== uid)) return { error: "담당 교사만 승인을 취소할 수 있습니다." };
  if (row.status !== "approved") return { error: "승인 완료 상태가 아니어서 취소할 수 없습니다." };

  // 개인연구 미러 plan id도 클라이언트 값이 아니라 방금 조회한 값으로 쓴다.
  const safeTarget: ReviewTarget =
    target.table === "individual_research" ? { table: target.table, id: target.id, linkedPlanId: mirrorByIndiv.get(target.id) ?? null } : { table: target.table, id: target.id };
  // 계획서/결과보고서는 draft로 돌려 학생이 바로 수정·재제출할 수 있게 한다(수정 요청=rejected와 구분).
  // 연구일지는 pending이 이미 학생 수정 가능 상태라 기존 그대로 pending(setStatus의 "submitted"가 pending으로 저장됨).
  const result = await setStatus(safeTarget, target.table === "activity_logs" ? "submitted" : "draft", undefined);
  if (result.error) return result;

  const col = target.table === "individual_research" ? "plan_status" : "status";
  const { data } = await createClient().from(target.table).select(`id,${col}`).in("id", [target.id]);
  if (((data ?? []) as unknown as Record<string, string>[]).some((r) => r[col] === "approved")) return { error: "승인 취소가 반영되지 않았습니다. 권한을 확인해주세요." };

  notifyReviewChanged();
  return { error: null };
}

/**
 * 검토 Inbox의 "일괄 승인/수정요청" — 여러 건을 테이블별로 묶어 한 번에 처리한다.
 * 개별 처리(approveSubmission/requestRevision)와 다른 함수이지만, 같은 컬럼/같은 미러링
 * 규칙을 따르는 동일 mutation의 대량 버전이다(별도 승인 로직이 아님).
 */
export async function bulkReview(
  targets: ReviewTarget[],
  status: "approved" | "rejected",
  feedback?: string
): Promise<{ error: string | null }> {
  const trimmedFeedback = feedback?.trim();
  if (status === "rejected" && !trimmedFeedback) return { error: "수정 요청 사유를 입력해주세요." };

  const supabase = createClient();
  const now = new Date().toISOString();
  const groups: Record<ReviewDbTable, string[]> = { individual_research: [], research_plans: [], activity_logs: [], research_reports: [] };
  const mirrorIds: string[] = [];
  for (const t of targets) {
    groups[t.table].push(t.id);
    if (t.table === "individual_research" && t.linkedPlanId) mirrorIds.push(t.linkedPlanId);
  }

  const errors: string[] = [];

  if (groups.individual_research.length > 0) {
    const patch: Record<string, unknown> = { plan_status: status, plan_reviewed_at: now };
    if (trimmedFeedback !== undefined) patch.plan_feedback = trimmedFeedback;
    const { error } = await supabase.from("individual_research").update(patch).in("id", groups.individual_research);
    if (error) errors.push(error.message);
  }
  const planIds = [...groups.research_plans, ...mirrorIds];
  if (planIds.length > 0) {
    const patch: Record<string, unknown> = { status, reviewed_at: now, updated_at: now };
    if (trimmedFeedback !== undefined) patch.feedback = trimmedFeedback;
    const { error } = await supabase.from("research_plans").update(patch).in("id", planIds);
    if (error) errors.push(error.message);
  }
  if (groups.activity_logs.length > 0) {
    const patch: Record<string, unknown> = { status };
    if (trimmedFeedback !== undefined) patch.teacher_feedback = trimmedFeedback;
    const { error } = await supabase.from("activity_logs").update(patch).in("id", groups.activity_logs);
    if (error) errors.push(error.message);
  }
  if (groups.research_reports.length > 0) {
    const patch: Record<string, unknown> = { status, reviewed_at: now, updated_at: now };
    if (trimmedFeedback !== undefined) patch.feedback = trimmedFeedback;
    const { error } = await supabase.from("research_reports").update(patch).in("id", groups.research_reports);
    if (error) errors.push(error.message);
  }

  // 개별 처리(setStatus)와 동일하게, 각 문서의 가장 최근 제출 스냅샷에도 검토 결과를 남긴다.
  if (errors.length === 0) {
    await Promise.all([
      ...groups.individual_research.map((id) => markLatestSnapshotReviewed("individual_research", id, status, trimmedFeedback)),
      ...planIds.map((id) => markLatestSnapshotReviewed("research_plans", id, status, trimmedFeedback)),
      ...groups.research_reports.map((id) => markLatestSnapshotReviewed("research_reports", id, status, trimmedFeedback)),
    ]);
  }

  if (errors.length === 0) notifyReviewChanged();
  return { error: errors.length > 0 ? errors.join("; ") : null };
}

type ReviewRow = { id: string; status: string | null; owner: string | null | undefined };

type ResolvedReviewRows =
  | { kind: "denied" }
  | { kind: "error" }
  | { kind: "ok"; uid: string; isAdmin: boolean; rows: Map<string, ReviewRow>; mirrorByIndiv: Map<string, string> };

/**
 * 대상 문서들의 "현재 DB 상태 + 담당 교사"를 서버(DB)에서 다시 읽는다 — 화면의 canReview/상태 값은 믿지 않는다.
 * 호출자의 role/is_admin도 DB에서 직접 조회한다. 학생/비로그인은 denied, 조회 오류는 error.
 * 일괄 승인과 승인 취소가 같은 판단 기준을 쓰도록 공용으로 둔다.
 */
async function resolveReviewRows(list: ReviewTarget[]): Promise<ResolvedReviewRows> {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData.user?.id;
  if (!uid) return { kind: "denied" };
  const { data: me } = await supabase.from("users").select("role,is_admin").eq("id", uid).single();
  const isAdmin = me?.is_admin === true;
  if (!isAdmin && me?.role !== "teacher") return { kind: "denied" };

  const idsOf = (table: ReviewDbTable) => list.filter((t) => t.table === table).map((t) => t.id);
  const rows = new Map<string, ReviewRow>();

  const [indivR, planR, reportR, logR] = await Promise.all([
    idsOf("individual_research").length ? supabase.from("individual_research").select("id,teacher_id,plan_status").in("id", idsOf("individual_research")) : null,
    idsOf("research_plans").length ? supabase.from("research_plans").select("id,team_id,entity_type,entity_id,status").in("id", idsOf("research_plans")) : null,
    idsOf("research_reports").length ? supabase.from("research_reports").select("id,team_id,entity_type,entity_id,status").in("id", idsOf("research_reports")) : null,
    idsOf("activity_logs").length ? supabase.from("activity_logs").select("id,entity_type,entity_id,status,log_type").in("id", idsOf("activity_logs")) : null,
  ]);
  if (indivR?.error || planR?.error || reportR?.error || logR?.error) return { kind: "error" };

  type Scoped = { id: string; team_id?: string | null; entity_type?: string | null; entity_id?: string | null; status: string | null; log_type?: string | null };
  const plans = (planR?.data ?? []) as Scoped[];
  const reports = (reportR?.data ?? []) as Scoped[];
  const logs = (logR?.data ?? []) as Scoped[];
  const indivRows = (indivR?.data ?? []) as { id: string; teacher_id: string | null; plan_status: string | null }[];

  // 담당 교사 조회에 필요한 팀/개인연구 id를 모아 한 번씩만 조회한다.
  const teamIds = new Set<string>();
  const indivIds = new Set<string>(indivRows.map((r) => r.id));
  for (const r of [...plans, ...reports]) {
    if (r.team_id) teamIds.add(r.team_id);
    else if (r.entity_type === "individual" && r.entity_id) indivIds.add(r.entity_id);
  }
  for (const l of logs) {
    if (l.entity_type === "team" && l.entity_id) teamIds.add(l.entity_id);
    else if (l.entity_type === "individual" && l.entity_id) indivIds.add(l.entity_id);
  }
  const [teamOwnerR, indivOwnerR, mirrorR] = await Promise.all([
    teamIds.size ? supabase.from("teams").select("id,teacher_id").in("id", [...teamIds]) : null,
    indivIds.size ? supabase.from("individual_research").select("id,teacher_id").in("id", [...indivIds]) : null,
    indivRows.length ? supabase.from("research_plans").select("id,entity_id").eq("entity_type", "individual").in("entity_id", indivRows.map((r) => r.id)) : null,
  ]);
  if (teamOwnerR?.error || indivOwnerR?.error || mirrorR?.error) return { kind: "error" };
  const teamOwner = new Map(((teamOwnerR?.data ?? []) as { id: string; teacher_id: string | null }[]).map((t) => [t.id, t.teacher_id]));
  const indivOwner = new Map(((indivOwnerR?.data ?? []) as { id: string; teacher_id: string | null }[]).map((t) => [t.id, t.teacher_id]));
  const mirrorByIndiv = new Map(((mirrorR?.data ?? []) as { id: string; entity_id: string }[]).map((m) => [m.entity_id, m.id]));

  const scopedOwner = (r: Scoped) =>
    r.team_id ? teamOwner.get(r.team_id) : r.entity_type === "individual" && r.entity_id ? indivOwner.get(r.entity_id) : undefined;
  for (const r of indivRows) rows.set(`individual_research:${r.id}`, { id: r.id, status: r.plan_status, owner: r.teacher_id });
  for (const r of plans) rows.set(`research_plans:${r.id}`, { id: r.id, status: r.status, owner: scopedOwner(r) });
  for (const r of reports) rows.set(`research_reports:${r.id}`, { id: r.id, status: r.status, owner: scopedOwner(r) });
  for (const l of logs) {
    const owner = l.entity_type === "team" ? teamOwner.get(l.entity_id ?? "") : l.entity_type === "individual" ? indivOwner.get(l.entity_id ?? "") : undefined;
    // 개인 일지(personal)는 제출 대상이 아니다 — 승인 대상에서 제외한다.
    rows.set(`activity_logs:${l.id}`, { id: l.id, status: l.log_type === "personal" ? null : l.status, owner });
  }

  return { kind: "ok", uid, isAdmin, rows, mirrorByIndiv };
}

export interface BulkApproveResult {
  requested: number;
  approved: number;
  /** 권한이 없거나 이미 승인/수정요청/초안 등 승인 대상이 아니어서 건너뛴 건수. */
  skipped: number;
  /** 승인 시도 중 오류가 났거나 반영이 확인되지 않은 건수. */
  failed: number;
}

/** 승인 가능한 DB 상태 — 플랜/보고서/개인연구는 'submitted', 연구일지는 'pending'(레거시 'submitted'도 방어적으로 허용). */
const APPROVABLE_DB_STATUS = new Set(["submitted", "pending"]);

/**
 * 검토 필요 목록의 "선택 항목 승인". 새 승인 로직이 아니라 단일 승인(setStatus)을 항목별로
 * 그대로 재사용하는 래퍼다 — status/reviewed_at, 개인연구 미러 plan 갱신, 제출 스냅샷 기록이 모두 같다.
 *
 * 화면의 canReview/선택 상태를 믿지 않고 실행 시점에 다시 확인한다:
 *  1. 호출자의 role/is_admin을 DB에서 직접 조회(클라이언트가 넘긴 값 사용 안 함)
 *  2. 각 문서의 현재 상태와 담당 교사(팀/개인연구)를 재조회 — 승인 대상이 아니거나
 *     admin이 아닌데 담당 교사가 아니면 건너뛴다
 *  3. 승인 후 상태를 다시 읽어 실제 반영 여부를 확인한다(RLS가 막은 UPDATE는 에러 없이 0행이라)
 * 서로 다른 테이블을 다루므로 전체 트랜잭션은 없다 — 성공한 건은 되돌리지 않고 건수만 구분해 돌려준다.
 */
export async function bulkApproveSubmissions(targets: ReviewTarget[]): Promise<BulkApproveResult> {
  const unique = new Map<string, ReviewTarget>();
  for (const t of targets) unique.set(`${t.table}:${t.id}`, t);
  const list = [...unique.values()];
  const result: BulkApproveResult = { requested: list.length, approved: 0, skipped: 0, failed: 0 };
  if (list.length === 0) return result;

  const supabase = createClient();
  const resolved = await resolveReviewRows(list);
  if (resolved.kind === "denied") return { ...result, skipped: list.length };
  if (resolved.kind === "error") return { ...result, failed: list.length };
  const { uid, isAdmin, rows, mirrorByIndiv } = resolved;

  const eligible: ReviewTarget[] = [];
  for (const t of list) {
    const row = rows.get(`${t.table}:${t.id}`);
    const allowed = row != null && (isAdmin || (row.owner != null && row.owner === uid));
    if (!row || !allowed || !row.status || !APPROVABLE_DB_STATUS.has(row.status)) {
      result.skipped += 1;
      continue;
    }
    // 개인연구 미러 plan id도 클라이언트 값이 아니라 방금 조회한 값으로 쓴다.
    eligible.push(t.table === "individual_research" ? { table: t.table, id: t.id, linkedPlanId: mirrorByIndiv.get(t.id) ?? null } : { table: t.table, id: t.id });
  }

  // 단일 승인과 같은 setStatus를 항목별로 호출한다(소규모 병렬). notifyReviewChanged는 마지막에 한 번만.
  const attempted: ReviewTarget[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const chunk = eligible.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(chunk.map((t) => setStatus(t, "approved", undefined)));
    outcomes.forEach((o, k) => {
      if (o.error) result.failed += 1;
      else attempted.push(chunk[k]);
    });
  }

  // RLS가 막은 UPDATE는 에러 없이 0행이므로, 실제로 approved가 됐는지 다시 읽어 확인한다.
  if (attempted.length > 0) {
    const verify = async (table: ReviewDbTable, col: string) => {
      const ids = attempted.filter((t) => t.table === table).map((t) => t.id);
      if (ids.length === 0) return;
      const { data } = await supabase.from(table).select(`id,${col}`).in("id", ids);
      const approved = new Set(((data ?? []) as unknown as Record<string, string>[]).filter((r) => r[col] === "approved").map((r) => r.id));
      for (const id of ids) {
        if (approved.has(id)) result.approved += 1;
        else result.failed += 1;
      }
    };
    await Promise.all([
      verify("individual_research", "plan_status"),
      verify("research_plans", "status"),
      verify("research_reports", "status"),
      verify("activity_logs", "status"),
    ]);
  }

  if (result.approved > 0) notifyReviewChanged();
  return result;
}
