"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { RNE_SUBTYPES } from "@/lib/rne-types";

interface StatCard {
  label: string;
  count: number;
  typeParam: string;
}

export default function TeamsOverviewPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<StatCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !profile?.is_admin) return;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from("teams").select("type, subtype");
      if (!data) { setLoading(false); return; }

      const counts: Record<string, number> = {};
      for (const t of data) {
        if (t.type === "rne" && t.subtype) {
          counts[t.subtype] = (counts[t.subtype] ?? 0) + 1;
        } else if (t.type === "club") {
          counts["club"] = (counts["club"] ?? 0) + 1;
        }
      }

      setStats([
        ...RNE_SUBTYPES.map(({ value, label }) => ({
          label,
          count: counts[value] ?? 0,
          typeParam: value,
        })),
        { label: "동아리", count: counts["club"] ?? 0, typeParam: "club" },
        { label: "전체 팀", count: data.length, typeParam: "all" },
      ]);
      setLoading(false);
    }

    load();
  }, [authLoading, profile]);

  if (!authLoading && !profile?.is_admin) {
    return <p className="text-sm text-slate-400">접근 권한이 없습니다.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">전체 팀 현황</h1>
        <p className="mt-1 text-sm text-slate-500">유형별 팀 수를 확인하고 관리 페이지로 이동하세요.</p>
      </div>

      {loading || authLoading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {stats.map((card) => (
            <button
              key={card.typeParam}
              type="button"
              onClick={() => router.push(`/admin/teams?type=${card.typeParam}`)}
              className="group rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:border-sky-300 hover:bg-sky-50 hover:shadow-md"
            >
              <p className="text-sm font-medium text-slate-500 group-hover:text-sky-600">
                {card.label}
              </p>
              <p className="mt-2 text-4xl font-bold text-slate-900">{card.count}</p>
              <p className="mt-1 text-xs text-slate-400">팀</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
