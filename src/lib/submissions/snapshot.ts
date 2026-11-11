import { createClient } from "@/lib/supabase";

// 제출 당시 내용 스냅샷 — research_plans/research_reports/individual_research는
// "행 1개를 계속 덮어쓰는" 구조라 재제출하면 이전 내용이 사라진다. 이 모듈은
// 제출/재제출이 "성공한 순간"에만(임시저장 때는 X) 그 내용을 별도 테이블에 追加 기록한다.
// source_table 값은 검토 시스템(src/lib/review/actions.ts)의 ReviewDbTable과 동일한
// 문자열을 그대로 쓴다 — 검토 Inbox가 다루는 대상과 항상 같은 것을 가리키기 위함.

export type SnapshotSourceTable = "research_plans" | "research_reports" | "individual_research";

/** 스냅샷 content의 공통 모양 — 텍스트 필드(fields)와 첨부파일(attachments)을 분리해서
 * 허브 화면이 문서 종류와 무관하게 같은 방식으로 렌더링할 수 있게 한다. */
export interface SnapshotContent {
  fields: Record<string, string | null>;
  attachments: { name: string; url: string }[];
}

export function buildSnapshotContent(
  fields: Record<string, string | null>,
  attachments: { name: string; url: string }[] = []
): SnapshotContent {
  return { fields, attachments };
}

export interface SubmissionSnapshot {
  id: string;
  source_table: SnapshotSourceTable;
  source_id: string;
  status: string;
  feedback: string | null;
  submitted_by: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  content: SnapshotContent;
}

/** 제출/재제출이 성공했을 때만 호출한다 — 임시저장에는 호출하지 않는다. */
export async function recordSubmissionSnapshot(params: {
  sourceTable: SnapshotSourceTable;
  sourceId: string;
  submittedBy: string;
  content: SnapshotContent;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("submission_snapshots").insert({
    source_table: params.sourceTable,
    source_id: params.sourceId,
    submitted_by: params.submittedBy,
    content: params.content,
    status: "submitted",
  });
  if (error) console.error("제출 스냅샷 저장 실패(제출 자체는 정상 처리됨):", error);
}

/**
 * 교사가 승인/수정요청할 때, 그 시점의 "가장 최근 제출 스냅샷"에도 결과를 같이 남긴다.
 * (원본 행의 status/feedback은 다음 제출 때 다시 덮어써지므로, 이 스냅샷에 남겨두지
 * 않으면 "1차 제출이 반려당했다"는 사실 자체가 재제출 후 사라진다.)
 * 실패해도 검토 자체(원본 행 갱신)는 이미 끝난 뒤라 조용히 로그만 남긴다.
 */
export async function markLatestSnapshotReviewed(
  sourceTable: SnapshotSourceTable,
  sourceId: string,
  status: "approved" | "rejected",
  feedback: string | null | undefined
): Promise<void> {
  const supabase = createClient();
  const { data: latest } = await supabase
    .from("submission_snapshots")
    .select("id")
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return; // 이 문서엔 스냅샷이 없음(과거 데이터) — 조용히 스킵
  const patch: Record<string, unknown> = { status, reviewed_at: new Date().toISOString() };
  if (feedback !== undefined) patch.feedback = feedback;
  const { error } = await supabase.from("submission_snapshots").update(patch).eq("id", latest.id);
  if (error) console.error("제출 스냅샷 검토 결과 반영 실패:", error);
}

export async function fetchSnapshotsFor(
  targets: { sourceTable: SnapshotSourceTable; sourceId: string }[]
): Promise<Record<string, SubmissionSnapshot[]>> {
  const byTable: Record<SnapshotSourceTable, string[]> = { research_plans: [], research_reports: [], individual_research: [] };
  for (const t of targets) byTable[t.sourceTable].push(t.sourceId);

  const supabase = createClient();
  const results: SubmissionSnapshot[] = [];
  for (const sourceTable of Object.keys(byTable) as SnapshotSourceTable[]) {
    const ids = byTable[sourceTable];
    if (ids.length === 0) continue;
    const { data } = await supabase
      .from("submission_snapshots")
      .select("*")
      .eq("source_table", sourceTable)
      .in("source_id", ids)
      .order("submitted_at", { ascending: true });
    results.push(...((data as SubmissionSnapshot[]) ?? []));
  }

  const grouped: Record<string, SubmissionSnapshot[]> = {};
  for (const s of results) {
    const key = `${s.source_table}:${s.source_id}`;
    (grouped[key] ??= []).push(s);
  }
  return grouped;
}
