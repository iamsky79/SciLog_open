"use client";

export type SummaryTabValue = "plan" | "logs" | "report" | "docs" | "mine";

interface SummaryTabBarProps {
  activeTab: SummaryTabValue;
  onChange: (tab: SummaryTabValue) => void;
  planStatusText: string;
  planDate?: string;
  logCount: number;
  recentDate?: string;
  reportStatusText: string;
  reportDate?: string;
  refCount: number;
}

export function SummaryTabBar({
  activeTab, onChange, planStatusText, planDate, logCount, recentDate, reportStatusText, reportDate, refCount,
}: SummaryTabBarProps) {
  const tabCls = (tab: SummaryTabValue) =>
    `flex shrink-0 flex-col border-b-2 px-4 py-2 text-left transition-colors ${
      activeTab === tab ? "border-sky-500 text-sky-600" : "border-transparent text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div className="mb-4 flex gap-2 overflow-x-auto border-b border-slate-200">
      <button type="button" onClick={() => onChange("plan")} className={tabCls("plan")}>
        <span className="text-xs">연구계획서</span>
        <span className="text-sm font-semibold">{planStatusText}</span>
        {planDate && <span className="text-xs text-slate-400">{planDate}</span>}
      </button>
      <button type="button" onClick={() => onChange("logs")} className={tabCls("logs")}>
        <span className="text-xs">연구일지</span>
        <span className="text-sm font-semibold">{logCount}건</span>
        {recentDate && <span className="text-xs text-slate-400">최근 {recentDate}</span>}
      </button>
      <button type="button" onClick={() => onChange("report")} className={tabCls("report")}>
        <span className="text-xs">결과보고서</span>
        <span className="text-sm font-semibold">{reportStatusText}</span>
        {reportDate && <span className="text-xs text-slate-400">{reportDate}</span>}
      </button>
      <button type="button" onClick={() => onChange("docs")} className={tabCls("docs")}>
        <span className="text-xs">자료</span>
        <span className="text-sm font-semibold">{refCount}건</span>
      </button>
      <button type="button" onClick={() => onChange("mine")} className={tabCls("mine")}>
        <span className="text-sm font-semibold">나의 기록</span>
      </button>
    </div>
  );
}
