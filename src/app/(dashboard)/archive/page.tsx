"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { summarizeMemberNames } from "@/lib/members";
import { approveSubmission, bulkApproveSubmissions, requestRevision, undoApproval } from "@/lib/review/actions";
import { RevisionRequestModal } from "@/components/RevisionRequestModal";
import { UndoApprovalDialog } from "@/components/submissions/UndoApprovalDialog";
import { BulkApproveDialog } from "@/components/submissions/BulkApproveDialog";
import {
  fetchTeacherSubmissionArchive,
  latestAttachmentsOf,
  type HubActivityKind,
  type HubDocType,
  type TeacherArchiveItem,
} from "@/lib/submissions/hub";
import {
  PHASE_UI,
  fmtDate,
  firstPreviewText,
  AttachmentCell,
  SubmissionContent,
  Pagination,
  SubmissionDownloadMenu,
} from "@/components/submissions/shared";
import { SubmissionExportDialog } from "@/components/submissions/ExportDialog";
import {
  sortSubmissions,
  useSubmissionListQuery,
  SORTABLE_COLUMNS,
  type SubmissionSortKey,
  type SubmissionSortOrder,
} from "@/lib/submissions/listParams";

// 교사 "제출물 관리" — 예전에 따로 있던 "검토"(/review, /admin/review)와
// "제출물 보관함"(/archive)을 하나로 합쳤다. 데이터는 항상 같은 소스
// (fetchTeacherSubmissionArchive → research_plans/research_reports/activity_logs +
// review/actions.ts의 phase 계산)이고, 위에서 고르는 view(검토 필요/학생 수정 중/
// 전체 제출물)는 그 데이터를 status 기준으로 다르게 필터링할 뿐이다 — 새 검토
// 시스템이나 새 아카이브 데이터를 만들지 않는다.

type View = "review" | "revision" | "all";

const EMPTY_IDS: Set<string> = new Set();

/** 일괄 승인 대상 — 내가 review 가능한(canReview) 제출물 중 지금 승인 가능한 상태(검토 중/재검토)만. */
const isApprovable = (item: TeacherArchiveItem) => item.canReview && (item.phase === "submitted" || item.phase === "resubmitted");
const VALID_VIEWS: View[] = ["review", "revision", "all"];

const ACTIVITY_KINDS: HubActivityKind[] = ["R&E", "동아리", "창의개인연구"];
const DOC_TYPES: HubDocType[] = ["연구계획서", "연구일지", "결과보고서"];

const SORT_LABEL: Record<SubmissionSortKey, string> = {
  activityKind: "유형",
  schoolYear: "학년도",
  docType: "종류",
  submittedAt: "제출일",
  status: "상태",
};

function SortHeader({
  col,
  sort,
  order,
  onClick,
}: {
  col: SubmissionSortKey;
  sort: SubmissionSortKey;
  order: SubmissionSortOrder;
  onClick: () => void;
}) {
  const active = sort === col;
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-0.5 font-medium ${active ? "text-slate-900" : "text-slate-500"}`}>
      {SORT_LABEL[col]}
      <span className={active ? "text-sky-500" : "text-slate-300"}>{active ? (order === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}

function StudentNamesCell({ names }: { names: string[] }) {
  const { summary, full } = summarizeMemberNames(names);
  if (!summary) return <span className="text-slate-300">-</span>;
  return (
    <span className="text-slate-700" title={full !== summary ? full : undefined}>
      {summary}
    </span>
  );
}

function DetailDrawer({
  item,
  onClose,
  onApprove,
  onRequestRevision,
  onUndoApproval,
  busy,
}: {
  item: TeacherArchiveItem | null;
  onClose: () => void;
  onApprove: (item: TeacherArchiveItem) => void;
  onRequestRevision: (item: TeacherArchiveItem) => void;
  onUndoApproval: (item: TeacherArchiveItem) => void;
  busy: boolean;
}) {
  if (!item) return null;
  // review action은 담당 교사·관리자만 — canReview가 아니면 버튼을 렌더하지 않는다(쓰기 RLS와 같은 기준).
  // 교사 목록은 담당 연구로 한정돼 있어 보통 항상 true다.
  const pendingReview = item.canReview && (item.phase === "submitted" || item.phase === "resubmitted");
  const { full: studentNamesFull } = summarizeMemberNames(item.studentNames, 999);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              {item.activityKind} · {item.schoolYear ? `${item.schoolYear}학년도 · ` : ""}
              {studentNamesFull || item.projectName}
            </p>
            <p className="truncate text-base font-semibold text-slate-900">
              {item.docType}
              {item.title ? ` · ${item.title}` : ""}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-400">{item.projectName}</p>
            <div className="mt-1">
              <Badge tone={PHASE_UI[item.phase].tone}>{PHASE_UI[item.phase].label}</Badge>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <SubmissionContent item={item} />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Link href={item.href} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            원본에서 보기
          </Link>
          {item.canReview && item.phase === "approved" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUndoApproval(item)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              승인 취소
            </button>
          )}
          {pendingReview && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRequestRevision(item)}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
              >
                수정 요청
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onApprove(item)}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                승인
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SubmissionManagementPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">불러오는 중...</p>}>
      <SubmissionManagementPageInner />
    </Suspense>
  );
}

function SubmissionManagementPageInner() {
  const { userId, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const { query, update, toggleSort } = useSubmissionListQuery();

  const [items, setItems] = useState<TeacherArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailItem, setDetailItem] = useState<TeacherArchiveItem | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<{ tone: "success" | "warn"; text: string } | null>(null);
  const [revisionItem, setRevisionItem] = useState<TeacherArchiveItem | null>(null);
  const [undoItem, setUndoItem] = useState<TeacherArchiveItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState(query.search);

  const isAdmin = profile?.is_admin === true;
  const isTeacher = profile?.role === "teacher" || isAdmin;
  const view: View = VALID_VIEWS.includes(query.view as View) ? (query.view as View) : "review";

  // 선택은 "탭 + 필터 + 검색" 범위에 묶는다 — 이 범위가 바뀌면 이전 선택은 자동으로 무효가 되어
  // 화면에서 사라진 row가 몰래 선택된 채 남지 않는다(별도 effect 없이 파생값으로 처리).
  const scopeKey = [view, query.status, query.activityType, query.submissionType, query.academicYear, query.search].join("|");
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: EMPTY_IDS });
  const selectedIds = selection.key === scopeKey ? selection.ids : EMPTY_IDS;
  const setSelectedIds = (next: Set<string> | ((prev: Set<string>) => Set<string>)) =>
    setSelection((s) => {
      const base = s.key === scopeKey ? s.ids : EMPTY_IDS;
      return { key: scopeKey, ids: typeof next === "function" ? next(base) : next };
    });

  useEffect(() => {
    if (authLoading || !profile) return;
    if (profile.role === "student" && !profile.is_admin) {
      router.replace("/submissions");
      return;
    }
    if (!isTeacher) router.replace("/dashboard");
  }, [authLoading, profile, isTeacher, router]);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const data = await fetchTeacherSubmissionArchive(userId, isAdmin);
    setItems(data);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || !userId || !isTeacher) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, userId, isTeacher, isAdmin]);

  // 뒤로가기 등 외부에서 URL의 search가 바뀌면 입력창도 맞춰준다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(query.search);
  }, [query.search]);

  // 검색은 타이핑마다 URL push하면 history가 쌓이므로 debounce + replace를 쓴다.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== query.search) update({ search: searchInput }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // 목록 자체가 "내가 담당하는 연구"(관리자는 전체)로 한정돼 있다 — 모든 탭이 그 범위 안에서
  // 상태만 다르게 거른다. canReview 조건은 방어적으로 유지한다(admin은 모든 항목이 canReview).
  const counts = useMemo(
    () => ({
      review: items.filter((i) => i.canReview && (i.phase === "submitted" || i.phase === "resubmitted")).length,
      revision: items.filter((i) => i.canReview && i.phase === "revision_requested").length,
      all: items.length,
    }),
    [items]
  );

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const i of items) if (i.schoolYear) years.add(i.schoolYear);
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [items]);

  const setView = (v: View) => update({ view: v === "review" ? null : v, status: null });

  const filtered = useMemo(() => {
    let list = items;
    if (view === "review") list = list.filter((i) => i.canReview && (i.phase === "submitted" || i.phase === "resubmitted"));
    else if (view === "revision") list = list.filter((i) => i.canReview && i.phase === "revision_requested");
    else if (query.status) {
      if (query.status === "submitted") list = list.filter((i) => i.phase === "submitted" || i.phase === "resubmitted");
      else if (query.status === "revision_requested") list = list.filter((i) => i.phase === "revision_requested");
      else if (query.status === "approved") list = list.filter((i) => i.phase === "approved");
    }
    if (query.activityType) list = list.filter((i) => i.activityKind === query.activityType);
    if (query.submissionType) list = list.filter((i) => i.docType === query.submissionType);
    if (query.academicYear) list = list.filter((i) => i.schoolYear === query.academicYear);
    if (query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.projectName.toLowerCase().includes(q) ||
          (i.title ?? "").toLowerCase().includes(q) ||
          i.studentNames.some((n) => n.toLowerCase().includes(q))
      );
    }
    return list;
  }, [items, view, query.status, query.activityType, query.submissionType, query.academicYear, query.search]);

  // view별 기본 정렬 — URL에 사용자가 명시적으로 sort를 지정했으면 그걸 우선한다.
  const explicitSort = rawSearchParams.has("sort");
  const explicitOrder = rawSearchParams.has("order");
  const effectiveSort: SubmissionSortKey = explicitSort ? query.sort : "submittedAt";
  const effectiveOrder: SubmissionSortOrder = explicitOrder ? query.order : view === "review" ? "asc" : "desc";

  const sorted = useMemo(() => sortSubmissions(filtered, effectiveSort, effectiveOrder), [filtered, effectiveSort, effectiveOrder]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(query.page, pageCount);
  const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (authLoading || loading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (!isTeacher) return null;

  async function runAction(fn: () => Promise<{ error?: string | null }>, onDone?: () => void) {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result.error) {
      alert("처리 실패: " + result.error);
      return;
    }
    onDone?.();
    await load();
  }

  const handleApprove = (item: TeacherArchiveItem) =>
    runAction(() => approveSubmission(item.reviewTarget), () => setDetailItem(null));
  // 승인 취소는 실수 방지를 위해 확인 dialog를 거친다(row/card/drawer 공통).
  const handleUndoApproval = () => {
    if (!undoItem) return;
    runAction(
      () => undoApproval(undoItem.reviewTarget),
      () => {
        setUndoItem(null);
        setDetailItem(null);
      }
    );
  };
  const handleRequestRevision = (reason: string) => {
    if (!revisionItem) return;
    runAction(
      () => requestRevision(revisionItem.reviewTarget, reason),
      () => {
        setRevisionItem(null);
        setDetailItem(null);
      }
    );
  };

  const selectedItems = pageItems.filter((i) => selectedIds.has(i.id));
  // 검토 필요 탭의 전체 선택은 "현재 화면(필터 결과)에서 승인 가능한 제출물"만 대상으로 한다.
  const selectablePageItems = view === "review" ? pageItems.filter(isApprovable) : pageItems;
  const allPageChecked = selectablePageItems.length > 0 && selectablePageItems.every((i) => selectedIds.has(i.id));
  const approvableSelected = view === "review" ? sorted.filter((i) => selectedIds.has(i.id) && isApprovable(i)) : [];

  const handleBulkApprove = async () => {
    if (approvableSelected.length === 0) return;
    setBusy(true);
    const result = await bulkApproveSubmissions(approvableSelected.map((i) => i.reviewTarget));
    setBusy(false);
    setConfirmBulk(false);
    setSelectedIds(new Set());
    const notProcessed = result.requested - result.approved;
    setBulkNotice(
      notProcessed === 0
        ? { tone: "success", text: `${result.approved}건을 승인했습니다.` }
        : { tone: "warn", text: `${result.requested}건 중 ${result.approved}건을 승인했습니다. ${notProcessed}건은 상태 또는 권한이 변경되어 처리되지 않았습니다.` }
    );
    await load();
  };

  const viewChips: { value: View; label: string; count: number }[] = [
    { value: "review", label: "검토 필요", count: counts.review },
    { value: "revision", label: "학생 수정 중", count: counts.revision },
    { value: "all", label: "전체 제출물", count: counts.all },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">제출물 관리</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isAdmin ? "학교 전체 제출물을 확인하고 검토하세요." : "내가 담당하는 연구의 제출물입니다. 검토가 필요한 제출물을 확인하세요."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {viewChips.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setView(c.value)}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
              view === c.value ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {c.label} <span className="ml-1 font-bold">{c.count}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {yearOptions.length > 0 && (
          <select
            value={query.academicYear ?? "all"}
            onChange={(e) => update({ academicYear: e.target.value === "all" ? null : e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="all">학년도 전체</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        )}
        <select
          value={query.activityType ?? "all"}
          onChange={(e) => update({ activityType: e.target.value === "all" ? null : e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="all">유형 전체</option>
          {ACTIVITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          value={query.submissionType ?? "all"}
          onChange={(e) => update({ submissionType: e.target.value === "all" ? null : e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="all">종류 전체</option>
          {DOC_TYPES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {view === "all" && (
          <select
            value={query.status ?? "all"}
            onChange={(e) => update({ status: e.target.value === "all" ? null : e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="all">상태 전체</option>
            <option value="submitted">검토 중</option>
            <option value="revision_requested">수정 요청</option>
            <option value="approved">승인 완료</option>
          </select>
        )}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="학생명 / 팀명 / 프로젝트명 / 제목 검색"
            className="w-64 rounded-lg border border-slate-300 py-1.5 pl-7 pr-3 text-sm"
          />
        </div>
      </div>

      {bulkNotice && (
        <div
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            bulkNotice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <span>{bulkNotice.text}</span>
          <button type="button" onClick={() => setBulkNotice(null)} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="알림 닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{selectedIds.size}건 선택됨</span>
          {view === "review" && approvableSelected.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmBulk(true)}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
            >
              선택 항목 승인 ({approvableSelected.length})
            </button>
          )}
          <button type="button" onClick={() => setShowExport(true)} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            선택 내보내기
          </button>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="text-sm text-slate-500 hover:underline">
            선택 해제
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <Card className="text-sm text-slate-400">
          {view === "review" ? "현재 검토할 제출물이 없습니다." : "조건에 맞는 제출물이 없습니다."}
          {view === "review" && (
            <button type="button" onClick={() => setView("all")} className="ml-2 font-medium text-sky-600 hover:underline">
              전체 제출물 보기
            </button>
          )}
        </Card>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="w-8 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={allPageChecked}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          for (const i of selectablePageItems) {
                            if (checked) next.add(i.id);
                            else next.delete(i.id);
                          }
                          return next;
                        });
                      }}
                    />
                  </th>
                  <th className="px-4 py-2.5">
                    <SortHeader col="activityKind" sort={effectiveSort} order={effectiveOrder} onClick={() => toggleSort("activityKind")} />
                  </th>
                  <th className="px-4 py-2.5">
                    <SortHeader col="schoolYear" sort={effectiveSort} order={effectiveOrder} onClick={() => toggleSort("schoolYear")} />
                  </th>
                  <th className="px-4 py-2.5">
                    <SortHeader col="docType" sort={effectiveSort} order={effectiveOrder} onClick={() => toggleSort("docType")} />
                  </th>
                  <th className="px-4 py-2.5 font-medium">학생/팀명</th>
                  <th className="px-4 py-2.5 font-medium">제목</th>
                  <th className="px-4 py-2.5">
                    <SortHeader col="submittedAt" sort={effectiveSort} order={effectiveOrder} onClick={() => toggleSort("submittedAt")} />
                  </th>
                  <th className="px-4 py-2.5">
                    <SortHeader col="status" sort={effectiveSort} order={effectiveOrder} onClick={() => toggleSort("status")} />
                  </th>
                  <th className="px-4 py-2.5 font-medium">첨부</th>
                  <th className="px-4 py-2.5 text-right font-medium">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.map((item) => {
                  const ui = PHASE_UI[item.phase];
                  const preview = firstPreviewText(item.snapshots.at(-1)?.content.fields ?? item.currentContent);
                  const attachments = latestAttachmentsOf(item);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          disabled={view === "review" && !isApprovable(item)}
                          onChange={(e) =>
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{item.activityKind}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{item.schoolYear ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{item.docType}</td>
                      <td className="max-w-[160px] px-4 py-3 font-medium">
                        <StudentNamesCell names={item.studentNames} />
                      </td>
                      <td className="max-w-[220px] px-4 py-3">
                        {item.title && <p className="truncate font-medium text-slate-800">{item.title}</p>}
                        {preview && <p className="line-clamp-1 text-xs text-slate-400">{preview}</p>}
                        {!item.title && !preview && <span className="text-slate-300">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(item.submittedAt) ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge tone={ui.tone}>{ui.label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <AttachmentCell attachments={attachments} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" onClick={() => setDetailItem(item)} className="text-sm font-medium text-sky-600 hover:text-sky-800">
                            내용 보기
                          </button>
                          {item.canReview && item.phase === "approved" && (
                            <button type="button" disabled={busy} onClick={() => setUndoItem(item)} className="text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-60">
                              승인 취소
                            </button>
                          )}
                          <SubmissionDownloadMenu item={item} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 모바일: compact list — 정렬은 select control로 제공 */}
          <div className="space-y-2 sm:hidden">
            <select
              value={`${effectiveSort}:${effectiveOrder}`}
              onChange={(e) => {
                const [s, o] = e.target.value.split(":") as [SubmissionSortKey, SubmissionSortOrder];
                update({ sort: s, order: o });
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            >
              {SORTABLE_COLUMNS.flatMap((c) => [
                <option key={`${c}:asc`} value={`${c}:asc`}>
                  {SORT_LABEL[c]} 오름차순
                </option>,
                <option key={`${c}:desc`} value={`${c}:desc`}>
                  {SORT_LABEL[c]} 내림차순
                </option>,
              ])}
            </select>
            {pageItems.map((item) => {
              const ui = PHASE_UI[item.phase];
              const attachments = latestAttachmentsOf(item);
              return (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-400">
                        {item.activityKind}
                        {item.schoolYear ? ` · ${item.schoolYear}` : ""} · {item.docType}
                      </p>
                      <p className="truncate text-sm font-semibold text-slate-800">{item.title ?? item.projectName}</p>
                      <p className="truncate text-xs text-slate-500">
                        <StudentNamesCell names={item.studentNames} />
                      </p>
                      <p className="text-xs text-slate-400">{fmtDate(item.submittedAt) ?? "-"}</p>
                    </div>
                    <Badge tone={ui.tone}>{ui.label}</Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                    <AttachmentCell attachments={attachments} />
                    <div className="flex items-center gap-3">
                      {item.canReview && item.phase === "approved" && (
                        <button type="button" disabled={busy} onClick={() => setUndoItem(item)} className="text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-60">
                          승인 취소
                        </button>
                      )}
                      <button type="button" onClick={() => setDetailItem(item)} className="text-sm font-medium text-sky-600 hover:text-sky-800">
                        내용 보기
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Pagination
            page={safePage}
            pageCount={pageCount}
            pageSize={pageSize}
            total={sorted.length}
            onPageChange={(p) => update({ page: p }, { resetPage: false })}
            onPageSizeChange={(s) => {
              setPageSize(s);
              update({}, { resetPage: true });
            }}
          />
        </>
      )}

      <DetailDrawer
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onApprove={handleApprove}
        onRequestRevision={(item) => setRevisionItem(item)}
        onUndoApproval={(item) => setUndoItem(item)}
        busy={busy}
      />

      <UndoApprovalDialog open={undoItem != null} submitting={busy} onCancel={() => setUndoItem(null)} onConfirm={handleUndoApproval} />

      <RevisionRequestModal open={revisionItem != null} onCancel={() => setRevisionItem(null)} onSubmit={handleRequestRevision} submitting={busy} />

      <BulkApproveDialog open={confirmBulk} count={approvableSelected.length} submitting={busy} onCancel={() => setConfirmBulk(false)} onConfirm={handleBulkApprove} />

      {showExport && <SubmissionExportDialog items={selectedItems} onClose={() => setShowExport(false)} />}
    </div>
  );
}
