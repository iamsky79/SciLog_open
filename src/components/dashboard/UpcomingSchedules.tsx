"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  deadlineState,
  formatMonthDay,
  formatTime,
  recentPastSchedules,
  scheduleTypeLabel,
  upcomingSchedules,
  type DeadlineTone,
  type ScheduleView,
} from "@/lib/dashboard/schedule";

const TONE_CLASS: Record<DeadlineTone, string> = {
  today: "bg-orange-100 text-orange-700",
  soon: "bg-amber-50 text-amber-700",
  normal: "bg-sky-50 text-sky-700",
  past: "bg-slate-100 text-slate-500",
};

function ScheduleCard({ item }: { item: ScheduleView }) {
  const state = deadlineState(item.deadline);
  return (
    <li className={cn("flex items-center gap-3 rounded-xl border px-4 py-3", state.isPast ? "border-slate-100 bg-slate-50/60" : "border-slate-200 bg-white")}>
      <div className="w-[88px] shrink-0">
        <p className={cn("text-sm font-semibold", state.isPast ? "text-slate-400" : "text-slate-800")}>{formatMonthDay(item.deadline)}</p>
        <p className="text-[11px] text-slate-400">{formatTime(item.deadline)} 마감</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", state.isPast ? "text-slate-400" : "text-slate-800")}>{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {scheduleTypeLabel(item.submissionType)} · {item.scopeLabel}
        </p>
      </div>
      <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", TONE_CLASS[state.tone])}>{state.label}</span>
    </li>
  );
}

/** 관리자가 등록한 실제 제출 일정. 일정이 없으면 안내 문구만 보이고, 임의의 일정은 만들지 않는다. */
export function UpcomingSchedules({ items, loading, limit = 6 }: { items: ScheduleView[]; loading?: boolean; limit?: number }) {
  const [showPast, setShowPast] = useState(false);
  const upcoming = upcomingSchedules(items);
  const past = recentPastSchedules(items, 3);

  return (
    <Card>
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-sky-600" />
        <h2 className="text-base font-semibold text-slate-900">다가오는 제출 일정</h2>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
      ) : upcoming.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
          <p className="text-sm font-medium text-slate-600">등록된 제출 일정이 없습니다.</p>
          <p className="mt-1 text-xs text-slate-400">관리자가 제출 일정을 등록하면 이곳에 표시됩니다.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {upcoming.slice(0, limit).map((item) => (
            <ScheduleCard key={item.id} item={item} />
          ))}
          {upcoming.length > limit && <li className="px-1 text-xs text-slate-400">그 외 {upcoming.length - limit}개의 일정이 더 있어요.</li>}
        </ul>
      )}
      {!loading && past.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowPast((v) => !v)} className="text-xs font-medium text-slate-400 hover:text-slate-600">
            {showPast ? "지난 일정 숨기기" : "지난 일정 보기"}
          </button>
          {showPast && (
            <ul className="mt-2 space-y-2">
              {past.map((item) => (
                <ScheduleCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
