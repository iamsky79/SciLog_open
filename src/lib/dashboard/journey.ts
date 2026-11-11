/**
 * 연간 연구 여정 — "연구가 1년 동안 어떤 순서로 진행되는지"를 보여주는 고정된 process view.
 * 관리자가 등록한 실제 일정(report_schedules)과는 별개의 개념이다: 여기에는 월/날짜/D-day를 넣지 않고,
 * 단계 이름과 설명만 둔다. 실제 날짜는 일정 데이터가 있을 때만 단계 아래에 따로 덧붙여 보여준다.
 */

export type StageKey = "register" | "plan" | "checkpoint" | "research" | "report" | "finish";

export interface JourneyStage {
  key: StageKey;
  label: string;
  hint: string;
  /**
   * 일반적인 진행 시기(대략적인 월) — 학교 연간 흐름을 이해하기 위한 안내일 뿐 실제 마감일이 아니다.
   * 실제 날짜는 관리자가 등록한 제출 일정(report_schedules)만 쓰고, 그 값은 이 시기와 별개로 표시한다.
   */
  period: string;
  /** 이 단계에 대응하는 report_schedules.submission_type — 있을 때만 "다음 일정"을 이 단계 아래에 보여준다. */
  scheduleTypes: string[];
}

export const JOURNEY_STAGES: JourneyStage[] = [
  { key: "register", label: "연구 등록", hint: "연구 주제 탐색과 팀 구성", period: "3–4월", scheduleTypes: ["registration"] },
  { key: "plan", label: "계획서 제출", hint: "계획서 작성·제출·검토", period: "5월", scheduleTypes: ["plan"] },
  { key: "checkpoint", label: "중간 점검", hint: "연구 방향 점검", period: "7월", scheduleTypes: [] },
  { key: "research", label: "연구 수행", hint: "연구일지 기록", period: "8–10월", scheduleTypes: ["note"] },
  { key: "report", label: "결과보고", hint: "결과보고서 제출·검토", period: "11월", scheduleTypes: ["report"] },
  { key: "finish", label: "발표·심사", hint: "승인 완료, 대회·발표", period: "12월", scheduleTypes: ["competition"] },
];

export type ProjectKind = "rne" | "club" | "individual";

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = { rne: "R&E", club: "동아리", individual: "창의개인연구" };

export interface ProjectProgress {
  id: string;
  kind: ProjectKind;
  name: string;
  year: string | null;
  href: string;
  /** 계획서 상태 — 행이 없으면 null. */
  plan: string | null;
  /** 결과보고서 상태 — 행이 없으면 null. */
  report: string | null;
  logTotal: number;
  logPending: number;
  logRejected: number;
  logApproved: number;
}

/**
 * 프로젝트 하나가 지금 어느 단계에 있는지 — 실제 상태(status)로만 판단한다.
 * 과거 기록(historical)으로 잠긴 프로젝트는 live workflow가 아니므로 단계에 속하지 않는다(null).
 */
export function stageOfProject(p: Pick<ProjectProgress, "plan" | "report" | "logTotal">): StageKey | null {
  if (p.plan === "historical" || p.report === "historical") return null;
  if (p.report === "approved") return "finish";
  if (p.report === "submitted" || p.report === "rejected") return "report";
  if (p.plan === "approved") return "research";
  if (p.plan === "submitted" || p.plan === "rejected") return "plan";
  // 계획서가 없거나 임시저장 — 이미 연구일지나 보고서 초안이 있으면 연구를 수행 중인 것으로 본다(계획서가 없는 동아리 등).
  if (p.logTotal > 0 || p.report === "draft") return "research";
  return "plan";
}

export function projectsByStage(projects: ProjectProgress[]): Record<StageKey, ProjectProgress[]> {
  const out: Record<StageKey, ProjectProgress[]> = { register: [], plan: [], checkpoint: [], research: [], report: [], finish: [] };
  for (const p of projects) {
    const s = stageOfProject(p);
    if (s) out[s].push(p);
  }
  return out;
}
