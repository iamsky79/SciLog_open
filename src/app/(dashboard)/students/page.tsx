"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/Badge";
import { fetchStudentDirectory, type StudentDirectoryRow } from "@/lib/portfolio/directory";
import type { TeachingActivityKind } from "@/lib/portfolio/teaching";
import { fetchObservationCounts } from "@/lib/observations/actions";
import { Pagination } from "@/components/submissions/shared";
import { ObservationDrawer } from "@/components/observations/ObservationDrawer";
import { BulkPortfolioExportDialog } from "@/components/portfolio/BulkPortfolioExportDialog";

// 교사 "학생 포트폴리오" — 지도 학생 카드 grid + 전체 학생 table이라는 이중 구조를
// 없애고, 하나의 compact table/list에서 [지도 학생만] ↔ [전체 학생]을 토글한다.
// 학생 수가 많아도(20명 이상) 세로 공간을 과도하게 쓰지 않는 것이 목표.
// 관찰 기록 작성/열람도 이 화면을 벗어나지 않고 row의 drawer에서 처리한다.

const ACTIVITY_KINDS: TeachingActivityKind[] = ["R&E", "동아리", "창의개인연구", "기타 활동"];

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function ActivityBadges({ kinds }: { kinds: TeachingActivityKind[] }) {
  if (kinds.length === 0) return <span className="text-slate-300">-</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {kinds.map((k) => (
        <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
          {k}
        </span>
      ))}
    </span>
  );
}

export default function StudentsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">불러오는 중...</p>}>
      <StudentsPageInner />
    </Suspense>
  );
}

function StudentsPageInner() {
  const { userId, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<StudentDirectoryRow[]>([]);
  const [yearOptions, setYearOptions] = useState<string[]>([]);
  const [observationCounts, setObservationCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [observationTarget, setObservationTarget] = useState<{ id: string; name: string } | null>(null);
  const [showBulkExport, setShowBulkExport] = useState(false);
  const [pageSize, setPageSize] = useState(20);

  const guided = searchParams.get("guided") !== "false"; // 기본값: 지도 학생만
  const academicYear = searchParams.get("academicYear");
  const activityType = (searchParams.get("activityType") as TeachingActivityKind | null) ?? "all";
  const grade = searchParams.get("grade") ?? "all";
  const klass = searchParams.get("class") ?? "all";
  const searchQuery = searchParams.get("search") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const [searchInput, setSearchInput] = useState(searchQuery);

  const isTeacherOrAdmin = profile != null && (profile.is_admin || profile.role === "teacher");
  // 039_teacher_observations.sql의 RLS: SELECT/INSERT는 is_supervising_teacher(student_id)
  // 또는 is_admin_or_viewer()를 허용한다. 관리자는 지도 관계와 무관하게 예외이므로,
  // teachingActivityKinds(지도 여부)만으로 게이팅하면 관리자만 부당하게 막히게 된다.
  const canWriteObservation = (row: StudentDirectoryRow) => row.teachingActivityKinds.length > 0 || profile?.is_admin === true;

  function updateQuery(patch: Record<string, string | null>, opts: { resetPage?: boolean; replace?: boolean } = {}) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "" || v === "all") params.delete(k);
      else params.set(k, v);
    }
    if (opts.resetPage !== false) params.delete("page");
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (opts.replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }

  useEffect(() => {
    if (authLoading || !isTeacherOrAdmin || !userId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchStudentDirectory({ teacherId: userId, academicYear }).then(async ({ rows, yearOptions }) => {
      if (cancelled) return;
      setRows(rows);
      setYearOptions(yearOptions);
      const counts = await fetchObservationCounts(rows.map((r) => r.id));
      if (!cancelled) {
        setObservationCounts(counts);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isTeacherOrAdmin, userId, academicYear]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== searchQuery) updateQuery({ search: searchInput || null }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const query = searchInput.trim().toLowerCase();
  const searchMatches = (row: StudentDirectoryRow) =>
    !query || row.name.toLowerCase().includes(query) || (row.username ?? "").toLowerCase().includes(query);

  const guidedRows = useMemo(() => rows.filter((r) => r.teachingActivityKinds.length > 0), [rows]);

  const gradeOptions = useMemo(() => [...new Set(rows.map((r) => r.grade).filter((g): g is number => g != null))].sort((a, b) => a - b), [rows]);
  const classOptions = useMemo(() => [...new Set(rows.map((r) => r.class).filter((c): c is string => !!c))].sort(), [rows]);

  const filteredAll = useMemo(() => {
    let list = guided ? guidedRows : rows;
    list = list.filter(searchMatches);
    if (grade !== "all") list = list.filter((r) => String(r.grade) === grade);
    if (klass !== "all") list = list.filter((r) => r.class === klass);
    if (activityType !== "all") list = list.filter((r) => r.activityKinds.includes(activityType));
    return [...list].sort((a, b) => {
      if (a.grade !== b.grade) return (a.grade ?? 0) - (b.grade ?? 0);
      if (a.class !== b.class) return (a.class ?? "").localeCompare(b.class ?? "");
      return (a.number ?? 0) - (b.number ?? 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, guidedRows, guided, query, grade, klass, activityType]);

  const pageCount = Math.max(1, Math.ceil(filteredAll.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageItems = filteredAll.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (authLoading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (!isTeacherOrAdmin) return <p className="text-sm text-slate-500">교사 또는 관리자만 접근 가능합니다.</p>;

  const selectedRows = rows.filter((r) => selectedIds.has(r.id));
  const allPageChecked = pageItems.length > 0 && pageItems.every((r) => selectedIds.has(r.id));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">학생 포트폴리오</h1>
          <p className="mt-1 text-sm text-slate-500">
            지도 학생 {guidedRows.length}명 · 전체 학생 {rows.length}명
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowBulkExport(true)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          포트폴리오 일괄 내보내기
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={guided} onChange={(e) => updateQuery({ guided: e.target.checked ? null : "false" })} />
          지도 학생만
        </label>
        {yearOptions.length > 0 && (
          <select
            value={academicYear ?? "all"}
            onChange={(e) => updateQuery({ academicYear: e.target.value === "all" ? null : e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="all">학년도 전체</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}학년도
              </option>
            ))}
          </select>
        )}
        <select
          value={activityType}
          onChange={(e) => updateQuery({ activityType: e.target.value === "all" ? null : e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="all">활동 전체</option>
          {ACTIVITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {gradeOptions.length > 0 && (
          <select
            value={grade}
            onChange={(e) => updateQuery({ grade: e.target.value === "all" ? null : e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="all">학년 전체</option>
            {gradeOptions.map((g) => (
              <option key={g} value={String(g)}>
                {g}학년
              </option>
            ))}
          </select>
        )}
        {classOptions.length > 0 && (
          <select
            value={klass}
            onChange={(e) => updateQuery({ class: e.target.value === "all" ? null : e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="all">반 전체</option>
            {classOptions.map((c) => (
              <option key={c} value={c}>
                {c}반
              </option>
            ))}
          </select>
        )}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이름 / 학번 검색"
            className="w-52 rounded-lg border border-slate-300 py-1.5 pl-7 pr-3 text-sm"
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{selectedIds.size}명 선택됨</span>
          <button type="button" onClick={() => setShowBulkExport(true)} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            선택 포트폴리오 내보내기
          </button>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="text-sm text-slate-500 hover:underline">
            선택 해제
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : filteredAll.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">조건에 맞는 학생이 없습니다.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
            <table className="w-full min-w-[820px] text-left text-sm">
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
                          for (const r of pageItems) {
                            if (checked) next.add(r.id);
                            else next.delete(r.id);
                          }
                          return next;
                        });
                      }}
                    />
                  </th>
                  <th className="px-4 py-2.5 font-medium">학생</th>
                  <th className="px-4 py-2.5 font-medium">학년·반</th>
                  <th className="px-4 py-2.5 font-medium">지도 활동</th>
                  <th className="px-4 py-2.5 font-medium">최근 활동</th>
                  <th className="px-4 py-2.5 font-medium">관찰 기록</th>
                  <th className="px-4 py-2.5 text-right font-medium">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-800">{row.name}</span>
                        {row.teachingActivityKinds.length > 0 && <Badge tone="blue">지도</Badge>}
                      </div>
                      <p className="text-xs text-slate-400">{row.username ?? "-"}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {row.grade != null ? `${row.grade}학년` : "-"}
                      {row.class && ` ${row.class}반`}
                    </td>
                    <td className="px-4 py-3">
                      <ActivityBadges kinds={row.teachingActivityKinds.length > 0 ? row.teachingActivityKinds : row.activityKinds} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(row.recentActivityAt)}</td>
                    <td className="px-4 py-3">
                      <span className="text-slate-600">{observationCounts[row.id] ?? 0}건</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {canWriteObservation(row) ? (
                          <button
                            type="button"
                            onClick={() => setObservationTarget({ id: row.id, name: row.name })}
                            className="text-sm font-medium text-sky-600 hover:text-sky-800"
                          >
                            + 기록
                          </button>
                        ) : (
                          <span className="text-sm text-slate-300" title="지도 관계가 있는 학생만 관찰 기록을 남길 수 있습니다">
                            + 기록
                          </span>
                        )}
                        <Link href={`/student/${row.id}`} className="text-sm font-medium text-slate-600 hover:text-slate-800">
                          포트폴리오
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 모바일: compact card */}
          <div className="space-y-2 sm:hidden">
            {pageItems.map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                    />
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                        {row.name}
                        {row.teachingActivityKinds.length > 0 && <Badge tone="blue">지도</Badge>}
                      </p>
                      <p className="text-xs text-slate-400">
                        {row.grade != null ? `${row.grade}학년` : "-"}
                        {row.class && ` ${row.class}반`}
                        {row.username && ` · ${row.username}`}
                      </p>
                    </div>
                  </label>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                  <ActivityBadges kinds={row.teachingActivityKinds.length > 0 ? row.teachingActivityKinds : row.activityKinds} />
                  <span>최근 {fmtDate(row.recentActivityAt)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">관찰 기록 {observationCounts[row.id] ?? 0}건</span>
                  <div className="flex items-center gap-3">
                    {canWriteObservation(row) ? (
                      <button type="button" onClick={() => setObservationTarget({ id: row.id, name: row.name })} className="text-sm font-medium text-sky-600 hover:underline">
                        + 기록
                      </button>
                    ) : (
                      <span className="text-sm text-slate-300">+ 기록</span>
                    )}
                    <Link href={`/student/${row.id}`} className="text-sm font-medium text-slate-600 hover:underline">
                      포트폴리오
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Pagination
            page={safePage}
            pageCount={pageCount}
            pageSize={pageSize}
            total={filteredAll.length}
            onPageChange={(p) => updateQuery({ page: p === 1 ? null : String(p) }, { resetPage: false })}
            onPageSizeChange={(s) => setPageSize(s)}
          />
        </>
      )}

      {observationTarget && userId && (
        <ObservationDrawer
          studentId={observationTarget.id}
          studentName={observationTarget.name}
          currentTeacherId={userId}
          onClose={() => setObservationTarget(null)}
          onCountChange={(id, count) => setObservationCounts((prev) => ({ ...prev, [id]: count }))}
        />
      )}

      {showBulkExport && userId && (
        <BulkPortfolioExportDialog
          guidedStudents={guidedRows}
          filteredStudents={filteredAll}
          selectedStudents={selectedRows}
          academicYear={academicYear}
          currentTeacherId={userId}
          onClose={() => setShowBulkExport(false)}
        />
      )}
    </div>
  );
}
