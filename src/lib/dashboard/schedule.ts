import type { JourneyStage } from "@/lib/dashboard/journey";

/** 대시보드에 보여줄 "실제 제출 일정" 한 건 — 관리자가 등록한 report_schedules 행을 그대로 옮긴 것이다(가공/추정 없음). */
export interface ScheduleView {
  id: string;
  title: string;
  deadline: string;
  /** report_schedules.submission_type — 과거 행은 NULL일 수 있다. */
  submissionType: string | null;
  /** 적용 범위 표시 — R&E/동아리/창의개인연구/전체. */
  scopeLabel: string;
}

export const SCHEDULE_TYPE_LABEL: Record<string, string> = {
  report: "결과보고서",
  plan: "계획서",
  note: "연구노트",
  registration: "등록 기간",
  competition: "대회·공모전",
};

export function scheduleTypeLabel(type: string | null): string {
  return (type && SCHEDULE_TYPE_LABEL[type]) || "일정";
}

function calendarDayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
}

export type DeadlineTone = "today" | "soon" | "normal" | "past";

export interface DeadlineState {
  label: string;
  tone: DeadlineTone;
  isPast: boolean;
  /** 마감일까지 남은 달력상 일수(오늘이면 0, 지났으면 음수). */
  days: number;
}

/** 달력 날짜 기준 D-day(시간이 아니라 날짜로 센다). 같은 날이라도 마감 시각이 지났으면 "마감됨". */
export function deadlineState(deadline: string, now: Date = new Date()): DeadlineState {
  const d = new Date(deadline);
  const days = calendarDayNumber(d) - calendarDayNumber(now);
  const isPast = d.getTime() < now.getTime();
  if (isPast) return { label: "마감됨", tone: "past", isPast: true, days };
  if (days === 0) return { label: "오늘 마감", tone: "today", isPast: false, days };
  return { label: `D-${days}`, tone: days <= 7 ? "soon" : "normal", isPast: false, days };
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** "10월 20일 (화)" */
export function formatMonthDay(deadline: string): string {
  const d = new Date(deadline);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`;
}

export function formatTime(deadline: string): string {
  const d = new Date(deadline);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 아직 지나지 않은 일정만, 마감이 가까운 순서로. */
export function upcomingSchedules(items: ScheduleView[], now: Date = new Date()): ScheduleView[] {
  return items.filter((s) => new Date(s.deadline).getTime() >= now.getTime()).sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
}

export function recentPastSchedules(items: ScheduleView[], limit: number, now: Date = new Date()): ScheduleView[] {
  return items
    .filter((s) => new Date(s.deadline).getTime() < now.getTime())
    .sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime())
    .slice(0, limit);
}

/** 이 여정 단계에 대응하는 유형(submission_type)의 가장 가까운 "다가오는" 일정 — 없으면 null(날짜를 지어내지 않는다). */
export function nextScheduleForStage(stage: JourneyStage, items: ScheduleView[], now: Date = new Date()): ScheduleView | null {
  if (stage.scheduleTypes.length === 0) return null;
  return upcomingSchedules(items.filter((s) => s.submissionType && stage.scheduleTypes.includes(s.submissionType)), now)[0] ?? null;
}
