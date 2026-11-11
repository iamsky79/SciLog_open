import type { ProjectProgress } from "@/lib/dashboard/journey";
import { deadlineState, scheduleTypeLabel, upcomingSchedules, type ScheduleView } from "@/lib/dashboard/schedule";

// 대시보드 핵심 카드/다음 할 일 계산 — 별도 TODO/집계 테이블 없이 연구별 status와 실제 일정만으로 계산한다.
// 제출물 = 계획서 + 결과보고서 + 연구일지. 과거 기록(historical)은 live workflow가 아니라 세지 않는다.

/** 검토 대기 중인 제출물 수 — 계획서/보고서 submitted + 연구일지 pending. */
export function reviewNeeded(p: ProjectProgress): number {
  return (p.plan === "submitted" ? 1 : 0) + (p.report === "submitted" ? 1 : 0) + p.logPending;
}

/** 수정 요청된 제출물 수 — 계획서/보고서 rejected + 연구일지 rejected. */
export function revisionRequested(p: ProjectProgress): number {
  return (p.plan === "rejected" ? 1 : 0) + (p.report === "rejected" ? 1 : 0) + p.logRejected;
}

export interface SubmissionTotals {
  /** 임시저장 중인 계획서·결과보고서(연구일지의 임시저장은 제외). */
  draft: number;
  reviewing: number;
  revision: number;
  approved: number;
  logTotal: number;
}

export function submissionTotals(projects: ProjectProgress[]): SubmissionTotals {
  const t: SubmissionTotals = { draft: 0, reviewing: 0, revision: 0, approved: 0, logTotal: 0 };
  for (const p of projects) {
    t.logTotal += p.logTotal;
    t.reviewing += reviewNeeded(p);
    t.revision += revisionRequested(p);
    t.approved += (p.plan === "approved" ? 1 : 0) + (p.report === "approved" ? 1 : 0) + p.logApproved;
    t.draft += (p.plan === "draft" ? 1 : 0) + (p.report === "draft" ? 1 : 0);
  }
  return t;
}

export interface NextAction {
  key: string;
  kind: "revision" | "due" | "draft";
  label: string;
  detail: string;
  href: string;
}

const DUE_SOON_DAYS = 14;
const MAX_ACTIONS = 6;

/** 학생의 "다음 할 일" — 수정 요청 → 마감 임박 일정 → 임시저장 순. 실제 status와 일정으로만 만든다. */
export function studentNextActions(projects: ProjectProgress[], schedules: ScheduleView[], now: Date = new Date()): NextAction[] {
  const revision: NextAction[] = [];
  const drafts: NextAction[] = [];
  for (const p of projects) {
    if (p.plan === "historical" || p.report === "historical") continue;
    if (p.plan === "rejected") revision.push({ key: `rp-${p.id}`, kind: "revision", label: "계획서 수정 요청", detail: p.name, href: `${p.href}?tab=plan` });
    if (p.report === "rejected") revision.push({ key: `rr-${p.id}`, kind: "revision", label: "결과보고서 수정 요청", detail: p.name, href: `${p.href}?tab=report` });
    if (p.logRejected > 0) revision.push({ key: `rl-${p.id}`, kind: "revision", label: `연구일지 ${p.logRejected}건 수정 요청`, detail: p.name, href: `${p.href}?tab=logs` });
    if (p.plan === "draft") drafts.push({ key: `dp-${p.id}`, kind: "draft", label: "임시저장 중인 계획서", detail: p.name, href: `${p.href}?tab=plan` });
    if (p.report === "draft") drafts.push({ key: `dr-${p.id}`, kind: "draft", label: "임시저장 중인 결과보고서", detail: p.name, href: `${p.href}?tab=report` });
  }
  const due: NextAction[] = upcomingSchedules(schedules, now)
    .map((s) => ({ s, st: deadlineState(s.deadline, now) }))
    .filter(({ st }) => st.days <= DUE_SOON_DAYS)
    .map(({ s, st }) => ({ key: `due-${s.id}`, kind: "due" as const, label: `${scheduleTypeLabel(s.submissionType)} 마감 ${st.label}`, detail: s.title, href: "/submissions" }));
  return [...revision, ...due, ...drafts].slice(0, MAX_ACTIONS);
}

export interface ReviewQueueRow {
  project: ProjectProgress;
  needs: number;
  revision: number;
}

/** 교사가 지금 처리할 수 있는 검토 대기열 — 담당 연구 중 검토할 제출물이 있는 연구를 많은 순으로. */
export function reviewQueue(projects: ProjectProgress[]): ReviewQueueRow[] {
  return projects
    .map((project) => ({ project, needs: reviewNeeded(project), revision: revisionRequested(project) }))
    .filter((r) => r.needs > 0)
    .sort((a, b) => b.needs - a.needs);
}
