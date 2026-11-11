"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ClubPlanRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/club/${id}?tab=plan`);
  }, [id, router]);
  return <p className="text-sm text-slate-400">이동 중...</p>;
}
