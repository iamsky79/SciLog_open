"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/Badge";
import { PHASE_UI, Pagination } from "@/components/submissions/shared";
import {
  fetchSubmissionStatusOverview,
  fetchScheduleTargetDetails,
  fetchSubmissionFilterOptions,
  type ScheduleStatusRow,
  type ScheduleTargetDetail,
  type SubmissionFilterOptions,
} from "@/lib/admin/submissionStatus";
import type { ReportSchedule } from "@/lib/database.types";

// 관리자 "제출 관리 > 제출 현황". 예전 "전체 검토"(교사 검토 UI를 그대로 가져온
// 화면)를 대체한다 — 관리자의 목적은 submission을 직접 승인하는 게 아니라 "누가
// 제출해야 하고, 실제로 어떻게 진행되고 있는지" 전체를 관리하는 것이라 schedule
// 단위 현황 table을 중심으로 한다. 새 count용 테이블/캐시를 만들지 않고 매번
// report_schedules + research_plans/reports + submission_snapshots에서 계산한다.
//
// academicYear/activity/submissionType/teacher는 메인 table의 필터(URL 유지),
// status/search는 [상세] drawer 안의 필터(URL 유지 — drawer를 다시 열 때 마지막
// 값을 그대로 이어받는다. drawer 자체가 열려있었는지는 새로고침 시 복원하지 않는다
// — 일시적인 UI 상태이지 "조회 조건"은 아니기 때문).

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDateTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const SUBMISSION_TYPE_LABEL: Record<string, string> = {
  plan: "연구계획서",
  report: "결과보고서",
  note: "연구노트",
  registration: "등록 기간",
  competition: "대회/공모전/학술발표",
};
const SUBMISSION_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  not_submitted: { label: "미제출", className: "text-slate-400" },
  on_time: { label: "기한 내 제출", className: "text-emerald-600" },
  late: { label: "지각 제출", className: "text-amber-600" },
};

export default function AdminSubmissionStatusPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">불러오는 중...</p>}>
      <AdminSubmissionStatusPageInner />
    </Suspense>
  );
}

function AdminSubmissionStatusPageInner() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<ScheduleStatusRow[]>([]);
  const [filterOptions, setFilterOptions] = useState<SubmissionFilterOptions>({ teachers: [], academicYears: [] });
  const [loading, setLoading] = useState(true);
  const [detailSchedule, setDetailSchedule] = useState<ReportSchedule | null>(null);
  const [pageSize, setPageSize] = useState(20);

  const activityFilter = searchParams.get("activity") ?? "all";
  const submissionTypeFilter = searchParams.get("submissionType") ?? "all";
  const academicYearFilter = searchParams.get("academicYear");
  const teacherFilter = searchParams.get("teacher");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  function updateQuery(patch: Record<string, string | null>, opts: { resetPage?: boolean } = {}) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "" || v === "all") params.delete(k);
      else params.set(k, v);
    }
    if (opts.resetPage !== false) params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    if (!authLoading && profile && !profile.is_admin) router.replace("/dashboard");
  }, [authLoading, profile, router]);

  useEffect(() => {
    if (authLoading || !profile?.is_admin) return;
    fetchSubmissionFilterOptions().then(setFilterOptions);
  }, [authLoading, profile]);

  useEffect(() => {
    if (authLoading || !profile?.is_admin) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchSubmissionStatusOverview({ teacherId: teacherFilter, academicYear: academicYearFilter }).then((data) => {
      if (cancelled) return;
      setRows(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, profile, teacherFilter, academicYearFilter]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (activityFilter !== "all" && r.activityLabel !== activityFilter) return false;
        if (submissionTypeFilter !== "all" && (r.schedule.submission_type ?? "") !== submissionTypeFilter) return false;
        return true;
      }),
    [rows, activityFilter, submissionTypeFilter]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (authLoading || loading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (!profile?.is_admin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">제출 현황</h1>
        <p className="mt-1 text-sm text-slate-500">제출 일정 기준으로 전체 제출·검토 진행 상황을 확인합니다.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {["all", "R&E", "동아리", "창의개인연구", "전체"].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => updateQuery({ activity: k === "all" ? null : k })}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              activityFilter === k ? "bg-sky-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {k === "all" ? "전체 유형" : k}
          </button>
        ))}
        <Link href="/admin/report-schedule" className="ml-auto text-sm font-medium text-sky-600 hover:underline">
          제출 일정 관리 →
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={submissionTypeFilter}
          onChange={(e) => updateQuery({ submissionType: e.target.value === "all" ? null : e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="all">제출 항목 전체</option>
          {Object.entries(SUBMISSION_TYPE_LABEL).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={academicYearFilter ?? "all"}
          onChange={(e) => updateQuery({ academicYear: e.target.value === "all" ? null : e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="all">학년도 전체</option>
          {filterOptions.academicYears.map((y) => (
            <option key={y} value={y}>
              {y}학년도
            </option>
          ))}
        </select>
        <select
          value={teacherFilter ?? "all"}
          onChange={(e) => updateQuery({ teacher: e.target.value === "all" ? null : e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="all">지도교사 전체</option>
          {filterOptions.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-400">조건에 맞는 제출 일정이 없습니다.</p>
          <Link href="/admin/report-schedule" className="mt-2 inline-block text-sm font-medium text-sky-600 hover:underline">
            제출 일정 등록하러 가기
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">활동</th>
                <th className="px-4 py-2.5 font-medium">제출 항목</th>
                <th className="px-4 py-2.5 font-medium">마감</th>
                <th className="px-4 py-2.5 font-medium">대상</th>
                <th className="px-4 py-2.5 font-medium">기한 내 제출</th>
                <th className="px-4 py-2.5 font-medium">지각 제출</th>
                <th className="px-4 py-2.5 font-medium">미제출</th>
                <th className="px-4 py-2.5 font-medium">검토 대기</th>
                <th className="px-4 py-2.5 font-medium">수정 중</th>
                <th className="px-4 py-2.5 font-medium">승인</th>
                <th className="px-4 py-2.5 text-right font-medium">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageItems.map((row) => (
                <tr key={row.schedule.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{row.activityLabel}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{row.schedule.title}</p>
                    <p className="text-xs text-slate-400">
                      {row.schedule.submission_type ? SUBMISSION_TYPE_LABEL[row.schedule.submission_type] ?? row.schedule.submission_type : "유형 미지정"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(row.schedule.deadline)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.targetCount}{row.activityLabel === "창의개인연구" ? "명" : row.activityLabel === "전체" ? "건" : "팀"}</td>
                  {row.trackable ? (
                    <>
                      <td className="px-4 py-3 text-emerald-600">{row.onTime}</td>
                      <td className="px-4 py-3 text-amber-600">{row.late}</td>
                      <td className="px-4 py-3 text-slate-400">{row.missing}</td>
                      <td className="px-4 py-3 text-sky-600">{row.reviewPending}</td>
                      <td className="px-4 py-3 text-red-500">{row.revisionRequested}</td>
                      <td className="px-4 py-3 text-slate-600">{row.approved}</td>
                    </>
                  ) : (
                    <td colSpan={6} className="px-4 py-3 text-xs text-slate-400">
                      이 제출 유형은 팀/학생당 1건으로 집계되지 않아 진행 현황을 계산하지 않습니다.
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    {row.trackable && (
                      <button type="button" onClick={() => setDetailSchedule(row.schedule)} className="text-sm font-medium text-sky-600 hover:text-sky-800">
                        상세
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={safePage}
        pageCount={pageCount}
        pageSize={pageSize}
        total={filtered.length}
        onPageChange={(p) => updateQuery({ page: p === 1 ? null : String(p) }, { resetPage: false })}
        onPageSizeChange={(s) => setPageSize(s)}
      />

      {detailSchedule && (
        <ScheduleDetailDrawer
          schedule={detailSchedule}
          teacherFilter={teacherFilter}
          onClose={() => setDetailSchedule(null)}
          statusFilter={searchParams.get("status") ?? "all"}
          searchQuery={searchParams.get("search") ?? ""}
          onStatusFilterChange={(v) => updateQuery({ status: v === "all" ? null : v })}
          onSearchQueryChange={(v) => updateQuery({ search: v || null })}
        />
      )}
    </div>
  );
}

function ScheduleDetailDrawer({
  schedule,
  teacherFilter,
  onClose,
  statusFilter,
  searchQuery,
  onStatusFilterChange,
  onSearchQueryChange,
}: {
  schedule: ReportSchedule;
  teacherFilter: string | null;
  onClose: () => void;
  statusFilter: string;
  searchQuery: string;
  onStatusFilterChange: (v: string) => void;
  onSearchQueryChange: (v: string) => void;
}) {
  const [details, setDetails] = useState<ScheduleTargetDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(searchQuery);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchScheduleTargetDetails(schedule, { teacherId: teacherFilter }).then((data) => {
      if (!cancelled) {
        setDetails(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [schedule, teacherFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== searchQuery) onSearchQueryChange(searchInput);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const filtered = details.filter((d) => {
    if (statusFilter !== "all" && d.submissionStatus !== statusFilter) return false;
    if (searchQuery.trim() && !d.targetLabel.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs text-slate-500">마감 {fmtDate(schedule.deadline)}</p>
            <p className="text-base font-semibold text-slate-900">{schedule.title}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
            <option value="all">제출 상태 전체</option>
            <option value="not_submitted">미제출</option>
            <option value="on_time">기한 내 제출</option>
            <option value="late">지각 제출</option>
          </select>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="학생/팀 검색"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-400">불러오는 중...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-400">조건에 맞는 대상이 없습니다.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">학생/팀</th>
                  <th className="py-2 pr-3 font-medium">지도교사</th>
                  <th className="py-2 pr-3 font-medium">제출 상태</th>
                  <th className="py-2 pr-3 font-medium">최초 제출</th>
                  <th className="py-2 font-medium">지도교사 검토</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((d) => {
                  const statusUi = SUBMISSION_STATUS_LABEL[d.submissionStatus];
                  return (
                    <tr key={d.targetKey}>
                      <td className="py-2.5 pr-3 font-medium text-slate-800">{d.targetLabel}</td>
                      <td className="py-2.5 pr-3 text-slate-500">{d.teacherName}</td>
                      <td className={`py-2.5 pr-3 font-medium ${statusUi.className}`}>{statusUi.label}</td>
                      <td className="py-2.5 pr-3 text-slate-500">{fmtDateTime(d.firstSubmittedAt)}</td>
                      <td className="py-2.5">{d.reviewPhase ? <Badge tone={PHASE_UI[d.reviewPhase].tone}>{PHASE_UI[d.reviewPhase].label}</Badge> : <span className="text-slate-300">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
