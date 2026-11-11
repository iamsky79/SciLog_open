"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// 예전에는 /submit(별도 제출 폼)으로 보냈지만, 결과보고서 작성/제출은 이제
// 해당 활동의 원본 화면(report 탭)에서만 한다 — 그 화면으로 바로 보낸다.
const ROUTE_BY_ENTITY: Record<string, string> = { rne: "rne", club: "club", individual: "individual" };

function Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const entity = searchParams.get("entity");
    const id = searchParams.get("id");
    const route = entity ? ROUTE_BY_ENTITY[entity] : undefined;
    if (route && id) {
      router.replace(`/${route}/${id}?tab=report`);
    } else {
      router.replace("/submissions");
    }
  }, [router, searchParams]);
  return <p className="text-sm text-slate-400">이동 중...</p>;
}

export default function SubmitReportPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">이동 중...</p>}>
      <Redirect />
    </Suspense>
  );
}
