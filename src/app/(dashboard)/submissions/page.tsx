"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { fetchStudentSubmissionHub, latestAttachmentsOf, type HubActivityKind, type HubItem } from "@/lib/submissions/hub";
import {
  PHASE_UI,
  fmtDate,
  firstPreviewText,
  AttachmentCell,
  SubmissionContent,
  Pagination,
  SubmissionDownloadMenu,
} from "@/components/submissions/shared";
import {
  sortSubmissions,
  useSubmissionListQuery,
  SORTABLE_COLUMNS,
  type SubmissionSortKey,
  type SubmissionSortOrder,
} from "@/lib/submissions/listParams";

type RecordFilter = "all" | "submitted" | "revision_requested" | "approved";
type ActivityFilter = "all" | HubActivityKind;

const ACTIVITY_KINDS: HubActivityKind[] = ["R&E", "동아리", "창의개인연구", "기타 활동"];

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

/** "내용 보기"를 누르면 페이지를 벗어나지 않고 여기서 제출 당시 내용을 확인한다. */
function DetailDrawer({ item, onClose }: { item: HubItem | null; onClose: () => void }) {
  if (!item) return null;
  const isRevision = item.phase === "revision_requested";
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
              {item.activityKind} · {item.projectName}
            </p>
            <p className="truncate text-base font-semibold text-slate-900">
              {item.docType}
              {item.title ? ` · ${item.title}` : ""}
            </p>
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

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-3">
          <Link href={item.href} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            원본에서 보기
          </Link>
          {isRevision && (
            <Link href={item.href} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">
              수정하러 가기
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionItemCard({ item, onOpenDetail }: { item: HubItem; onOpenDetail: () => void }) {
  const ui = PHASE_UI[item.phase];
  const isRevision = item.phase === "revision_requested";
  return (
    <Card className={isRevision ? "border-red-200 bg-red-50/40" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Badge tone={ui.tone}>{ui.label}</Badge>
          <p className="text-xs text-slate-500">
            {item.activityKind} · {item.projectName}
          </p>
          <p className="text-sm font-semibold text-slate-800">
            {item.docType}
            {item.title ? ` · ${item.title}` : ""}
          </p>
          {isRevision && item.feedback && <p className="mt-1 line-clamp-2 text-sm text-red-700">&ldquo;{item.feedback}&rdquo;</p>}
          {item.phase === "draft" && fmtDate(item.updatedAt) && <p className="text-xs text-slate-400">최근 저장 {fmtDate(item.updatedAt)}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Link
            href={item.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              isRevision ? "bg-red-500 text-white hover:bg-red-600" : "bg-sky-500 text-white hover:bg-sky-600"
            }`}
          >
            {ui.action}
          </Link>
          {isRevision && (
            <button type="button" onClick={onOpenDetail} className="text-xs font-medium text-slate-500 underline hover:text-slate-700">
              제출 당시 내용 보기
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** 액션 버튼 — "내용 보기"는 drawer를 열고, 그 외(작성하기/이어쓰기/제출·수정하러 가기)는 원본 화면으로 이동한다. 여기서 submit mutation을 직접 호출하지 않는다. */
function RowActions({ item, onOpenDetail }: { item: HubItem; onOpenDetail: () => void }) {
  const ui = PHASE_UI[item.phase];
  const canViewContent = item.phase !== "not_started" && item.phase !== "draft";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canViewContent && (
        <button type="button" onClick={onOpenDetail} className="text-sm font-medium text-sky-600 hover:text-sky-800">
          내용 보기
        </button>
      )}
      <Link
        href={item.href}
        className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-medium ${
          item.phase === "revision_requested"
            ? "bg-red-500 text-white hover:bg-red-600"
            : canViewContent
            ? "text-slate-500 hover:text-slate-700"
            : "bg-sky-500 text-white hover:bg-sky-600"
        }`}
      >
        {canViewContent ? (item.phase === "revision_requested" ? ui.action : "원본에서 보기") : ui.action}
      </Link>
    </div>
  );
}

/** 데스크톱: 표. 한 줄에 한 submission — 제출물이 많아도 한눈에 훑어볼 수 있게 한다. */
function RecordsTable({
  items,
  onOpenDetail,
  sort,
  order,
  onToggleSort,
}: {
  items: HubItem[];
  onOpenDetail: (item: HubItem) => void;
  sort: SubmissionSortKey;
  order: SubmissionSortOrder;
  onToggleSort: (col: SubmissionSortKey) => void;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2.5">
              <SortHeader col="activityKind" sort={sort} order={order} onClick={() => onToggleSort("activityKind")} />
            </th>
            <th className="px-4 py-2.5">
              <SortHeader col="schoolYear" sort={sort} order={order} onClick={() => onToggleSort("schoolYear")} />
            </th>
            <th className="px-4 py-2.5">
              <SortHeader col="docType" sort={sort} order={order} onClick={() => onToggleSort("docType")} />
            </th>
            <th className="px-4 py-2.5 font-medium">프로젝트/팀명</th>
            <th className="px-4 py-2.5 font-medium">제목</th>
            <th className="px-4 py-2.5">
              <SortHeader col="submittedAt" sort={sort} order={order} onClick={() => onToggleSort("submittedAt")} />
            </th>
            <th className="px-4 py-2.5">
              <SortHeader col="status" sort={sort} order={order} onClick={() => onToggleSort("status")} />
            </th>
            <th className="px-4 py-2.5 font-medium">첨부</th>
            <th className="px-4 py-2.5 font-medium text-right">액션</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => {
            const ui = PHASE_UI[item.phase];
            const preview = firstPreviewText(item.snapshots.at(-1)?.content.fields ?? item.currentContent);
            const attachments = latestAttachmentsOf(item);
            return (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{item.activityKind}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{item.schoolYear ?? "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">{item.docType}</td>
                <td className="max-w-[140px] truncate px-4 py-3 text-slate-700" title={item.projectName}>
                  {item.projectName}
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
                    <RowActions item={item} onOpenDetail={() => onOpenDetail(item)} />
                    {item.phase !== "not_started" && item.phase !== "draft" && <SubmissionDownloadMenu item={item} />}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 모바일: 표 대신 압축 리스트 — 상태/유형/종류/제목/제출일/액션 우선순위 정보만. */
function RecordsMobileList({
  items,
  onOpenDetail,
  sort,
  order,
  onChangeSort,
}: {
  items: HubItem[];
  onOpenDetail: (item: HubItem) => void;
  sort: SubmissionSortKey;
  order: SubmissionSortOrder;
  onChangeSort: (sort: SubmissionSortKey, order: SubmissionSortOrder) => void;
}) {
  return (
    <div className="space-y-2 sm:hidden">
      <select
        value={`${sort}:${order}`}
        onChange={(e) => {
          const [s, o] = e.target.value.split(":") as [SubmissionSortKey, SubmissionSortOrder];
          onChangeSort(s, o);
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
      {items.map((item) => {
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
                <p className="text-xs text-slate-400">{fmtDate(item.submittedAt) ?? "미제출"}</p>
              </div>
              <Badge tone={ui.tone}>{ui.label}</Badge>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
              <AttachmentCell attachments={attachments} />
              <div className="flex items-center gap-2">
                <RowActions item={item} onOpenDetail={() => onOpenDetail(item)} />
                {item.phase !== "not_started" && item.phase !== "draft" && <SubmissionDownloadMenu item={item} />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SubmissionsHubPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">불러오는 중...</p>}>
      <SubmissionsHubPageInner />
    </Suspense>
  );
}

function SubmissionsHubPageInner() {
  const { userId, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const { query, update, toggleSort } = useSubmissionListQuery();
  const [items, setItems] = useState<HubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState<number>(10);
  const [detailItem, setDetailItem] = useState<HubItem | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);

  const recordFilter = (query.status ?? "all") as RecordFilter;
  const activityFilter = (query.activityType ?? "all") as ActivityFilter;
  const yearFilter = query.academicYear ?? "all";

  useEffect(() => {
    if (authLoading || !profile) return;
    if (profile.role !== "student") {
      router.replace("/dashboard");
    }
  }, [authLoading, profile, router]);

  useEffect(() => {
    if (authLoading || !userId || profile?.role !== "student") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchStudentSubmissionHub(userId).then((data) => {
      if (!cancelled) {
        setItems(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, profile]);

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

  const actionItems = useMemo(() => {
    const revisions = items.filter((i) => i.phase === "revision_requested");
    const drafts = items.filter((i) => i.phase === "draft");
    const byRecency = (a: HubItem, b: HubItem) => {
      const da = new Date(a.updatedAt ?? a.submittedAt ?? 0).getTime();
      const db = new Date(b.updatedAt ?? b.submittedAt ?? 0).getTime();
      return db - da;
    };
    return [...revisions.sort(byRecency), ...drafts.sort(byRecency)];
  }, [items]);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const i of items) if (i.schoolYear) years.add(i.schoolYear);
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [items]);

  const filteredRecords = useMemo(() => {
    let list = items.filter((i) => i.phase !== "not_started" && i.phase !== "draft");
    if (recordFilter === "submitted") list = list.filter((i) => i.phase === "submitted" || i.phase === "resubmitted");
    else if (recordFilter === "revision_requested") list = list.filter((i) => i.phase === "revision_requested");
    else if (recordFilter === "approved") list = list.filter((i) => i.phase === "approved");
    if (activityFilter !== "all") list = list.filter((i) => i.activityKind === activityFilter);
    if (yearFilter !== "all") list = list.filter((i) => i.schoolYear === yearFilter);
    if (query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (i) => i.projectName.toLowerCase().includes(q) || (i.title ?? "").toLowerCase().includes(q) || i.docType.toLowerCase().includes(q)
      );
    }
    return sortSubmissions(list, query.sort, query.order);
  }, [items, recordFilter, activityFilter, yearFilter, query.search, query.sort, query.order]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(query.page, pageCount);
  const pageItems = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (authLoading || loading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (profile?.role !== "student") return null;

  const statusChips: { value: RecordFilter; label: string }[] = [
    { value: "all", label: "전체" },
    { value: "submitted", label: "검토 중" },
    { value: "revision_requested", label: "수정 요청" },
    { value: "approved", label: "승인 완료" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900">제출물</h1>
        <p className="mt-1 text-sm text-slate-500">
          작성·수정·제출은 각 연구/활동 화면에서 하고, 여기서는 해야 할 일과 제출 당시 내용을 한눈에 확인합니다.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">해야 할 일</h2>
          <span className="text-sm text-slate-500">{actionItems.length}건</span>
        </div>
        {actionItems.length === 0 ? (
          <Card className="text-sm text-slate-400">지금 처리해야 할 제출물이 없습니다.</Card>
        ) : (
          <div className="space-y-3">
            {actionItems.map((item) => (
              <ActionItemCard key={item.id} item={item} onOpenDetail={() => setDetailItem(item)} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">내 제출 기록</h2>

        <div className="flex flex-wrap items-center gap-2">
          {statusChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => update({ status: chip.value === "all" ? null : chip.value })}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                recordFilter === chip.value ? "bg-sky-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activityFilter}
            onChange={(e) => update({ activityType: e.target.value === "all" ? null : e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="all">활동 유형 전체</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {yearOptions.length > 0 && (
            <select
              value={yearFilter}
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
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="제목 / 프로젝트·팀명 / 종류 검색"
              className="w-56 rounded-lg border border-slate-300 py-1.5 pl-7 pr-3 text-sm"
            />
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <Card className="text-sm text-slate-400">해당하는 제출 기록이 없습니다.</Card>
        ) : (
          <>
            <RecordsTable
              items={pageItems}
              onOpenDetail={setDetailItem}
              sort={query.sort}
              order={query.order}
              onToggleSort={toggleSort}
            />
            <RecordsMobileList
              items={pageItems}
              onOpenDetail={setDetailItem}
              sort={query.sort}
              order={query.order}
              onChangeSort={(s, o) => update({ sort: s, order: o })}
            />
            <Pagination
              page={safePage}
              pageCount={pageCount}
              pageSize={pageSize}
              total={filteredRecords.length}
              onPageChange={(p) => update({ page: p }, { resetPage: false })}
              onPageSizeChange={(s) => {
                setPageSize(s);
                update({}, { resetPage: true });
              }}
            />
          </>
        )}
      </div>

      <DetailDrawer item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}
