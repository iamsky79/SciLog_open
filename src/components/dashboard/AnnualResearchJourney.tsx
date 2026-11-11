import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { JOURNEY_STAGES, type ProjectProgress, type StageKey } from "@/lib/dashboard/journey";
import { deadlineState, formatMonthDay, nextScheduleForStage, type ScheduleView } from "@/lib/dashboard/schedule";

/**
 * 연간 연구 여정 — 1년 동안 연구가 어떤 순서로 진행되는지 보여주는 고정된 process view.
 * 단계 이름은 항상 보이고(일정이 없어도), 아래의 두 가지만 실제 데이터가 있을 때 덧붙인다.
 *  - 지금 이 단계에 있는 연구 수: 계획서/보고서/연구일지의 실제 상태로 계산한다(진행률 %는 만들지 않는다).
 *  - 이 단계에 대응하는 유형의 다가오는 실제 제출 일정: 관리자가 등록한 날짜만 쓴다.
 */
export function AnnualResearchJourney({
  byStage,
  schedules,
  ownerLabel,
  loading,
}: {
  byStage: Record<StageKey, ProjectProgress[]>;
  schedules: ScheduleView[];
  ownerLabel: string;
  loading?: boolean;
}) {
  // "현재 단계" 문구는 규칙이 분명할 때만 — 활성 연구가 모두 같은 한 단계에 있을 때.
  const activeStages = loading ? [] : JOURNEY_STAGES.filter((s) => byStage[s.key].length > 0);
  const currentStage = activeStages.length === 1 ? activeStages[0] : null;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">연간 연구 여정</h2>
          <p className="mt-0.5 text-xs text-slate-500">등록부터 발표·심사까지, 연구가 한 해 동안 거치는 단계예요. 강조된 단계에 {ownerLabel}가 있어요.</p>
        </div>
        {currentStage && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-sky-700">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            현재: {currentStage.label} 단계
          </span>
        )}
      </div>

      <div className="mt-5 overflow-x-auto pb-1">
        <ol className="grid min-w-[760px] grid-cols-6 gap-2">
          {JOURNEY_STAGES.map((stage, idx) => {
            const projects = byStage[stage.key];
            const active = !loading && projects.length > 0;
            const next = nextScheduleForStage(stage, schedules);
            const nextState = next ? deadlineState(next.deadline) : null;
            return (
              <li key={stage.key} className="relative">
                {idx < JOURNEY_STAGES.length - 1 && (
                  <span aria-hidden className="absolute left-[calc(50%+16px)] right-[calc(-50%+16px)] top-4 h-0.5 bg-slate-200" />
                )}
                <div className="relative flex flex-col items-center text-center">
                  <span
                    className={cn(
                      "z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ring-4 ring-white",
                      active ? "bg-sky-500 text-white" : "bg-slate-200 text-slate-500"
                    )}
                  >
                    {idx + 1}
                  </span>
                  <p className={cn("mt-2 text-sm font-semibold", active ? "text-sky-700" : "text-slate-700")}>{stage.label}</p>
                  <p className={cn("mt-0.5 text-xs font-medium", active ? "text-sky-500" : "text-slate-400")}>{stage.period}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{stage.hint}</p>
                  {active ? (
                    <span
                      title={projects.map((p) => p.name).join("\n")}
                      className="mt-2 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700"
                    >
                      {ownerLabel} {projects.length}개
                    </span>
                  ) : (
                    <span className="mt-2 h-5" />
                  )}
                  {next && nextState && (
                    <span className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] leading-tight text-slate-600">
                      <span className="block font-medium text-slate-700">{formatMonthDay(next.deadline)}</span>
                      <span className="block text-slate-500">{nextState.label}</span>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">단계 아래의 월은 일반적인 진행 시기예요. 실제 마감일은 아래 &lsquo;다가오는 제출 일정&rsquo;을 따릅니다.</p>
    </Card>
  );
}
