"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// 예전에는 이 페이지 자체가 계획서/연구노트/결과보고서 제출 폼을 갖고 있어서,
// 각 활동의 원본 화면(PlanSection/ReportSection/JournalTimeline)과 별도로
// research_plans/research_reports/activity_logs/individual_research에 직접 썼다.
// 이제 실제 작성·제출은 항상 원본 화면에서만 하므로, 이 라우트는 옛 링크가
// 깨지지 않도록 정확한 원본 화면으로 돌려보내는 얇은 리다이렉트로만 남긴다.
const ROUTE_BY_ENTITY: Record<string, string> = { rne: "rne", club: "club", individual: "individual" };
// 예전 /submit의 tab 값(plan/note/report) → 현재 상세 페이지의 tab 값(plan/logs/report)
const TAB_MAP: Record<string, string> = { plan: "plan", note: "logs", report: "report" };

function Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const entity = searchParams.get("entity");
    const id = searchParams.get("id");
    const rawTab = searchParams.get("tab") ?? "plan";
    const route = entity ? ROUTE_BY_ENTITY[entity] : undefined;
    if (route && id) {
      router.replace(`/${route}/${id}?tab=${TAB_MAP[rawTab] ?? "plan"}`);
    } else {
      router.replace("/submissions");
    }
  }, [router, searchParams]);
  return <p className="text-sm text-slate-400">이동 중...</p>;
}

export default function SubmitRedirectPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">이동 중...</p>}>
      <Redirect />
    </Suspense>
  );
}
