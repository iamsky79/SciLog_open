"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { statusLabel, statusTone } from "@/lib/status";
import type { IndividualResearch, ReportSchedule, ReviewStatus } from "@/lib/database.types";

const termLabel: Record<string, string> = {
  "1-2": "1학년 2학기",
  "2-1": "2학년 1학기",
  "2-2": "2학년 2학기",
  "3-1": "3학년 1학기",
};

interface ResearchCardInfo extends IndividualResearch {
  studentName: string;
  latestStatus: ReviewStatus | null;
}

function getYear(row: IndividualResearch): string {
  const dateStr = row.start_date ?? row.created_at;
  return dateStr ? new Date(dateStr).getFullYear().toString() : "연도 미상";
}

function PlanStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    draft: { label: "작성 중", cls: "bg-slate-100 text-slate-500" },
    submitted: { label: "검토 대기", cls: "bg-amber-100 text-amber-700" },
    teacher_approved: { label: "1차 승인", cls: "bg-blue-100 text-blue-700" },
    approved: { label: "승인됨", cls: "bg-green-100 text-green-700" },
    rejected: { label: "반려됨", cls: "bg-red-100 text-red-700" },
  };
  const c = config[status] ?? config.draft;
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}

export default function IndividualPage() {
  const { userId, profile, loading: authLoading } = useAuth();
  const [researches, setResearches] = useState<ResearchCardInfo[]>([]);
  const [regSchedule, setRegSchedule] = useState<ReportSchedule | null>(null);
  const [regScheduleError, setRegScheduleError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [years, setYears] = useState<string[]>([]);

  useEffect(() => {
    if (authLoading || !userId) return;

    async function load() {
      const supabase = createClient();
      const isTeacherOrAdmin = profile?.role === "teacher" || profile?.is_admin === true;
      let resQuery = supabase
        .from("individual_research")
        .select("*")
        .order("created_at", { ascending: false });
      if (isTeacherOrAdmin) {
        resQuery = resQuery.eq("teacher_id", userId);
      } else {
        resQuery = resQuery.eq("student_id", userId);
      }
      const [{ data }, { data: schedData, error: schedErr }] = await Promise.all([
        resQuery,
        supabase.from("report_schedules").select("*").eq("submission_type", "registration").order("deadline", { ascending: false }),
      ]);
      // "등록 기간이 설정되지 않음"과 "조회 자체가 실패함"은 학생에게 완전히 다른
      // 의미다 — 후자를 전자처럼 조용히 삼키면 "새 연구 등록" 버튼이 이유 설명 없이
      // 계속 비활성 상태로 보인다. 실패는 구분해서 표시한다.
      if (schedErr) {
        console.error("등록 기간 일정 조회 실패:", schedErr);
        setRegScheduleError(true);
      } else {
        const regSchedules = (schedData ?? []) as ReportSchedule[];
        const byType = regSchedules.find((s) => s.entity_type === "individual" && !s.entity_id);
        const globalSched = regSchedules.find((s) => !s.entity_type && !s.entity_id);
        setRegSchedule(byType ?? globalSched ?? null);
      }

      const rows = (data as IndividualResearch[]) ?? [];
      const studentIds = Array.from(new Set(rows.map((row) => row.student_id)));
      const researchIds = rows.map((row) => row.id);

      let studentNameMap: Record<string, string> = {};
      if (studentIds.length > 0) {
        const { data: students } = await supabase
          .from("users")
          .select("id, name")
          .in("id", studentIds);
        studentNameMap = Object.fromEntries((students ?? []).map((s) => [s.id, s.name]));
      }

      const latestStatusMap: Record<string, ReviewStatus> = {};
      if (researchIds.length > 0) {
        const { data: logs } = await supabase
          .from("activity_logs")
          .select("entity_id, status, created_at")
          .eq("entity_type", "individual")
          .in("entity_id", researchIds)
          .order("created_at", { ascending: false });
        for (const log of logs ?? []) {
          if (!(log.entity_id in latestStatusMap)) {
            latestStatusMap[log.entity_id] = log.status;
          }
        }
      }

      const mapped = rows.map((row) => ({
        ...row,
        studentName: studentNameMap[row.student_id] ?? "알 수 없음",
        latestStatus: latestStatusMap[row.id] ?? null,
      }));

      setResearches(mapped);

      if (isTeacherOrAdmin) {
        const uniqueYears = [...new Set(mapped.map(getYear))].sort((a, b) =>
          b.localeCompare(a)
        );
        setYears(uniqueYears);
        if (uniqueYears.length > 0) setSelectedYear(uniqueYears[0]);
      }

      setLoading(false);
    }

    load();
  }, [authLoading, userId, profile]);

  const isTeacherOrAdmin = profile?.role === "teacher" || profile?.is_admin === true;
  const filteredResearches = isTeacherOrAdmin
    ? researches.filter((r) => getYear(r) === selectedYear)
    : researches;

  const regActive = !!regSchedule && new Date() <= new Date(regSchedule.deadline);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">창의개인연구</h1>
          <p className="mt-1 text-sm text-slate-500">개인 연구 활동을 확인하세요.</p>
        </div>
        {profile?.role === "student" && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {regActive ? (
              <Link
                href="/individual/new"
                className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-600"
              >
                <Plus className="h-4 w-4" />
                새 창의개인연구 등록
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-400"
              >
                <Plus className="h-4 w-4" />
                새 창의개인연구 등록
              </button>
            )}
            {regScheduleError ? (
              <p className="text-xs text-red-500">등록 기간 정보를 불러오지 못했습니다. 관리자에게 문의하세요.</p>
            ) : !regActive && regSchedule ? (
              <p className="text-xs text-slate-400">등록 기간이 아닙니다</p>
            ) : !regActive && !regSchedule ? (
              <p className="text-xs text-slate-400">등록 기간이 설정되지 않았습니다</p>
            ) : null}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : isTeacherOrAdmin ? (
        <div className="flex gap-8">
          {/* 좌측 학년도 사이드바 */}
          <aside className="sticky top-0 h-fit w-36 shrink-0 space-y-1">
            <h2 className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              학년도
            </h2>
            {years.length === 0 ? (
              <p className="px-3 text-xs text-slate-400">없음</p>
            ) : (
              years.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => setSelectedYear(year)}
                  className={`block w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                    selectedYear === year
                      ? "bg-sky-100 text-sky-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {year}학년도
                </button>
              ))
            )}
          </aside>

          {/* 메인 카드 그리드 */}
          <div className="min-w-0 flex-1">
            {selectedYear && (
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900">{selectedYear}학년도</h2>
              </div>
            )}
            {filteredResearches.length === 0 ? (
              <p className="text-sm text-slate-400">등록된 연구가 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredResearches.map((research) => (
                  <Link key={research.id} href={`/individual/${research.id}`}>
                    <Card className="transition-shadow hover:shadow-md">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-base font-semibold text-slate-900">{research.title}</h3>
                        <PlanStatusBadge status={research.plan_status ?? "draft"} />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{research.studentName}</p>
                      {research.field && (
                        <p className="mt-1 text-sm text-slate-400">{research.field}</p>
                      )}
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : researches.length === 0 ? (
        <p className="text-sm text-slate-400">등록된 연구가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {researches.map((research) => (
            <Link key={research.id} href={`/individual/${research.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{research.title}</h3>
                  {research.latestStatus && (
                    <Badge tone={statusTone[research.latestStatus]}>
                      {statusLabel[research.latestStatus]}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-500">{research.studentName}</p>
                {research.semester && (
                  <p className="mt-1 text-xs font-medium text-sky-600">
                    {termLabel[research.semester] ?? research.semester}
                  </p>
                )}
                {research.field && (
                  <p className="mt-1 text-sm text-slate-500">{research.field}</p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
