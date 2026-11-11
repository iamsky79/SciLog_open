"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { OTHER_ACTIVITY_SUBTYPE_LABEL, otherActivitySemesterSortPriority } from "@/lib/other-activity";
import { fmtDate } from "@/lib/export/common";
import type { OtherActivity } from "@/lib/database.types";

/** 학년도(없으면 activity_date/created_at) → 1학기 → 2학기 → 학기 구분 없음 → 날짜 → 활동 제목 오름차순. */
function sortActivities(activities: OtherActivity[]): OtherActivity[] {
  return [...activities].sort((a, b) => {
    const yearOf = (act: OtherActivity) =>
      act.academic_year ?? (act.activity_date ? new Date(act.activity_date).getFullYear() : new Date(act.created_at).getFullYear());
    const yearDiff = yearOf(a) - yearOf(b);
    if (yearDiff !== 0) return yearDiff;
    const semDiff = otherActivitySemesterSortPriority(a.semester) - otherActivitySemesterSortPriority(b.semester);
    if (semDiff !== 0) return semDiff;
    const dateDiff = (a.activity_date ?? "").localeCompare(b.activity_date ?? "");
    if (dateDiff !== 0) return dateDiff;
    return a.title.localeCompare(b.title, "ko");
  });
}

/** 학년도/학기 그룹 헤딩 — academic_year가 없는 기존 레코드는 "학년도 미정"으로 묶는다. */
function groupHeading(activity: OtherActivity): { year: string; semester: string } {
  const year =
    activity.academic_year != null
      ? `${activity.academic_year}학년도`
      : activity.activity_date
        ? `${new Date(activity.activity_date).getFullYear()}학년도`
        : "학년도 미정";
  const semester = activity.semester === "1" ? "1학기" : activity.semester === "2" ? "2학기" : "학기 구분 없음";
  return { year, semester };
}

export default function OtherPage() {
  const { profile, loading: authLoading } = useAuth();
  const [activities, setActivities] = useState<OtherActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("other_activities")
        .select("*")
        .order("activity_date", { ascending: false });
      setActivities((data as OtherActivity[]) ?? []);
      setLoading(false);
    }

    load();
  }, [authLoading]);

  const sorted = sortActivities(activities);

  // 학년도 → 학기로 그룹핑(같은 그룹이 연속될 때만 헤딩을 한 번씩만 표시).
  const groups: { year: string; semester: string; items: OtherActivity[] }[] = [];
  for (const activity of sorted) {
    const { year, semester } = groupHeading(activity);
    const last = groups[groups.length - 1];
    if (last && last.year === year && last.semester === semester) {
      last.items.push(activity);
    } else {
      groups.push({ year, semester, items: [activity] });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">기타 활동</h1>
          <p className="mt-1 text-sm text-slate-500">유형별 활동 기록을 확인하세요.</p>
        </div>
        {profile?.role === "student" && (
          <Link
            href="/other/new"
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-600"
          >
            <Plus className="h-4 w-4" />
            활동 추가
          </Link>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : activities.length === 0 ? (
        <p className="text-sm text-slate-400">등록된 활동이 없습니다.</p>
      ) : (
        <div className="space-y-8">
          {groups.map((group, gi) => (
            <div key={`${group.year}-${group.semester}-${gi}`} className="space-y-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{group.year}</h2>
                <p className="text-sm text-slate-500">{group.semester}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((activity) => (
                  <Link key={activity.id} href={`/other/${activity.id}`}>
                    <Card className="h-full transition-shadow hover:shadow-md">
                      <p className="text-xs font-medium text-sky-600">{OTHER_ACTIVITY_SUBTYPE_LABEL[activity.subtype]}</p>
                      <h3 className="mt-1 text-base font-semibold text-slate-900">{activity.title}</h3>
                      {activity.activity_date && <p className="mt-2 text-sm text-slate-500">{fmtDate(activity.activity_date)}</p>}
                      {activity.organizer && <p className="mt-1 text-sm text-slate-400">{activity.organizer}</p>}
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
