"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { HubActivityKind, HubDocType, HubPhase } from "@/lib/submissions/hub";

// 학생 "제출물"과 교사 "제출물 관리"가 공유하는 정렬/필터/URL 상태 로직.
// 두 화면은 표시 내용(프로젝트/팀명 vs 학생/팀명)과 목적은 다르지만, "유형·학년도·
// 종류·상태로 정렬하고, 그 상태를 URL query에 유지한다"는 규칙은 완전히 같다 —
// 여기 한 곳에서만 구현해서 두 화면이 같은 코드를 쓰게 한다.

// ─── 정렬 순서 매핑 (문자열 가나다순이 아니라 실제 업무 흐름 순서) ──────────────

export const ACTIVITY_TYPE_ORDER: Record<HubActivityKind, number> = {
  "R&E": 0,
  동아리: 1,
  창의개인연구: 2,
  "기타 활동": 3,
};

export const SUBMISSION_TYPE_ORDER: Record<HubDocType, number> = {
  연구계획서: 0,
  연구일지: 1,
  결과보고서: 2,
};

/** 오름차순 기준: 수정 요청 → 재검토 필요(재제출됨) → 검토 중 → 승인 완료. */
export const SUBMISSION_STATUS_ORDER: Record<HubPhase, number> = {
  revision_requested: 0,
  resubmitted: 1,
  submitted: 2,
  approved: 3,
  draft: 4,
  not_started: 5,
};

export type SubmissionSortKey = "activityKind" | "schoolYear" | "docType" | "submittedAt" | "status";
export type SubmissionSortOrder = "asc" | "desc";

export const SORTABLE_COLUMNS: SubmissionSortKey[] = ["activityKind", "schoolYear", "docType", "submittedAt", "status"];
const VALID_ORDERS: SubmissionSortOrder[] = ["asc", "desc"];

export const DEFAULT_SORT: SubmissionSortKey = "submittedAt";
export const DEFAULT_ORDER: SubmissionSortOrder = "desc";

export interface SortableSubmission {
  activityKind: HubActivityKind;
  docType: HubDocType;
  schoolYear: string | null;
  submittedAt: string | null;
  phase: HubPhase;
}

/** 유형/학년도/종류/상태로 정렬 시, 같은 값끼리는 항상 제출일 최신순으로 2차 정렬한다. */
export function sortSubmissions<T extends SortableSubmission>(items: T[], sortKey: SubmissionSortKey, order: SubmissionSortOrder): T[] {
  const dir = order === "asc" ? 1 : -1;
  const submittedAtMs = (i: T) => (i.submittedAt ? new Date(i.submittedAt).getTime() : 0);

  return [...items].sort((a, b) => {
    if (sortKey === "submittedAt") return (submittedAtMs(a) - submittedAtMs(b)) * dir;

    let primary = 0;
    if (sortKey === "activityKind") primary = ACTIVITY_TYPE_ORDER[a.activityKind] - ACTIVITY_TYPE_ORDER[b.activityKind];
    else if (sortKey === "docType") primary = SUBMISSION_TYPE_ORDER[a.docType] - SUBMISSION_TYPE_ORDER[b.docType];
    else if (sortKey === "status") primary = SUBMISSION_STATUS_ORDER[a.phase] - SUBMISSION_STATUS_ORDER[b.phase];
    else if (sortKey === "schoolYear") primary = (parseInt(a.schoolYear ?? "0", 10) || 0) - (parseInt(b.schoolYear ?? "0", 10) || 0);

    if (primary !== 0) return primary * dir;
    return submittedAtMs(b) - submittedAtMs(a); // 2차 정렬: 항상 제출일 최신순
  });
}

// ─── URL query 상태 ─────────────────────────────────────────────────────────

export interface SubmissionListQuery {
  sort: SubmissionSortKey;
  order: SubmissionSortOrder;
  page: number;
  search: string;
  /** null = 전체 학년도 */
  academicYear: string | null;
  /** null = 전체 */
  activityType: string | null;
  submissionType: string | null;
  status: string | null;
  /** 교사 "제출물 관리"에서만 쓰는 view(review/revision/all). 학생 페이지는 항상 null. */
  view: string | null;
}

function parseIntSafe(v: string | null, fallback: number, min = 1): number {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function parseEnumSafe<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** 잘못된/알 수 없는 query 값은 화면이 깨지지 않도록 항상 안전한 기본값으로 폴백한다. */
export function parseSubmissionListQuery(params: URLSearchParams): SubmissionListQuery {
  return {
    sort: parseEnumSafe(params.get("sort"), SORTABLE_COLUMNS, DEFAULT_SORT),
    order: parseEnumSafe(params.get("order"), VALID_ORDERS, DEFAULT_ORDER),
    page: parseIntSafe(params.get("page"), 1),
    search: params.get("search") ?? "",
    academicYear: params.get("academicYear") || null,
    activityType: params.get("activityType") || null,
    submissionType: params.get("submissionType") || null,
    status: params.get("status") || null,
    view: params.get("view") || null,
  };
}

export function serializeSubmissionListQuery(query: Partial<SubmissionListQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (query.view) params.set("view", query.view);
  if (query.academicYear) params.set("academicYear", query.academicYear);
  if (query.activityType) params.set("activityType", query.activityType);
  if (query.submissionType) params.set("submissionType", query.submissionType);
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  const isDefaultSort = (query.sort ?? DEFAULT_SORT) === DEFAULT_SORT && (query.order ?? DEFAULT_ORDER) === DEFAULT_ORDER;
  if (!isDefaultSort) {
    if (query.sort) params.set("sort", query.sort);
    if (query.order) params.set("order", query.order);
  }
  if (query.page && query.page !== 1) params.set("page", String(query.page));
  return params;
}

/**
 * 정렬/필터/검색/page를 URL query와 동기화하는 공용 hook. 새로고침·뒤로가기 시에도
 * 그대로 복원되고(= URL이 유일한 source of truth), 필터·정렬을 바꾸면 자동으로
 * page=1로 초기화한다. 검색처럼 타이핑마다 바뀌는 값은 호출부에서 debounce한 뒤
 * replace:true로 넘기면 history가 쌓이지 않는다.
 */
export function useSubmissionListQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => parseSubmissionListQuery(searchParams), [searchParams]);

  const update = useCallback(
    (patch: Partial<SubmissionListQuery>, opts: { resetPage?: boolean; replace?: boolean } = {}) => {
      const current = parseSubmissionListQuery(searchParams);
      const next: SubmissionListQuery = { ...current, ...patch };
      if (opts.resetPage !== false && Object.keys(patch).some((k) => k !== "page")) {
        next.page = 1;
      }
      if (opts.resetPage === true) next.page = 1;
      const qs = serializeSubmissionListQuery(next).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const toggleSort = useCallback(
    (key: SubmissionSortKey) => {
      const current = parseSubmissionListQuery(searchParams);
      if (current.sort !== key) {
        update({ sort: key, order: "asc" });
      } else if (current.order === "asc") {
        update({ sort: key, order: "desc" });
      } else {
        update({ sort: DEFAULT_SORT, order: DEFAULT_ORDER });
      }
    },
    [searchParams, update]
  );

  return { query, update, toggleSort };
}
