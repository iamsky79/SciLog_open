"use client";

import { TeamForm } from "@/components/TeamForm";
import { useRequireAdmin } from "@/lib/role-guards";

export default function NewClubTeamPage() {
  const { loading, allowed } = useRequireAdmin("/club");

  if (loading || !allowed) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">동아리 팀 추가</h1>
        <p className="mt-1 text-sm text-slate-500">새 동아리 팀을 등록하세요.</p>
      </div>
      <TeamForm teamType="club" />
    </div>
  );
}
