"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { RNE_SUBTYPES, isGenericRneTeam, type RneSubtype } from "@/lib/rne-types";
import type { Team } from "@/lib/database.types";

interface TeamWithMembers extends Team {
  memberNames: string[];
}

/** RNE_SUBTYPES 섹션마다 반복되던 카드 그리드 마크업을 하나로 모은 것. */
function TeamCardGrid({ teams }: { teams: TeamWithMembers[] }) {
  if (teams.length === 0) return <p className="text-sm text-slate-400">등록된 팀이 없습니다.</p>;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {teams.map((team) => (
        <Link key={team.id} href={`/rne/${team.id}`}>
          <Card className="transition-shadow hover:shadow-md">
            <h3 className="text-base font-semibold text-slate-900">{team.name}</h3>
            {team.field && <p className="mt-1 text-sm text-slate-500">{team.field}</p>}
            {team.memberNames.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-slate-400">팀원</p>
                <p className="text-sm text-slate-600">{team.memberNames.join(", ")}</p>
              </div>
            )}
            <div className="mt-2 flex items-center gap-2 text-sm text-sky-500">
              <span>팀 상세 보기 →</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function RnePage() {
  const { userId, profile, loading: authLoading } = useAuth();
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const sectionRefs = useRef<Partial<Record<RneSubtype, HTMLElement | null>>>({});
  const genericSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (authLoading || !userId) return;

    async function load() {
      const supabase = createClient();
      const isTeacherOrAdmin = profile?.role === "teacher" || profile?.is_admin === true;
      let query = supabase
        .from("teams")
        .select("*")
        .eq("type", "rne")
        .order("created_at", { ascending: false });
      if (isTeacherOrAdmin) query = query.eq("teacher_id", userId);
      const { data } = await query;
      const rows = (data as Team[]) ?? [];
      const teamIds = rows.map((t) => t.id);

      let memberNamesMap: Record<string, string[]> = {};
      if (teamIds.length > 0) {
        const { data: memberRows } = await supabase
          .from("team_members")
          .select("team_id, student_id")
          .in("team_id", teamIds);

        const studentIds = [...new Set((memberRows ?? []).map((m: { student_id: string }) => m.student_id))];
        let userNameMap: Record<string, string> = {};
        if (studentIds.length > 0) {
          const { data: users } = await supabase
            .from("users")
            .select("id, username, name")
            .in("id", studentIds);
          userNameMap = Object.fromEntries(
            (users ?? []).map((u) => [u.id, (u.username as string | null) ?? u.name])
          );
        }
        for (const m of (memberRows ?? []) as { team_id: string; student_id: string }[]) {
          if (!memberNamesMap[m.team_id]) memberNamesMap[m.team_id] = [];
          memberNamesMap[m.team_id].push(userNameMap[m.student_id] ?? "?");
        }
      }

      setTeams(rows.map((t) => ({ ...t, memberNames: memberNamesMap[t.id] ?? [] })));
      setLoading(false);
    }

    load();
  }, [authLoading, userId, profile]);

  const scrollToType = (type: RneSubtype) => {
    sectionRefs.current[type]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const teamsByType = (type: RneSubtype) => teams.filter((team) => team.subtype === type);
  const genericTeams = teams.filter(isGenericRneTeam);

  return (
    <div className="flex gap-8">
      <aside className="sticky top-0 h-fit w-44 shrink-0 space-y-1">
        <h2 className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          R&E 유형
        </h2>
        {RNE_SUBTYPES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => scrollToType(value)}
            className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            {label}
          </button>
        ))}
        {genericTeams.length > 0 && (
          <button
            type="button"
            onClick={() => genericSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            R&E
          </button>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-10">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">R&E</h1>
          <p className="mt-1 text-sm text-slate-500">R&E 프로그램별 팀 활동을 확인하세요.</p>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">불러오는 중...</p>
        ) : (
          <>
            {RNE_SUBTYPES.map(({ value, label }) => (
              <section
                key={value}
                ref={(el) => {
                  sectionRefs.current[value] = el;
                }}
                className="space-y-4 scroll-mt-4"
              >
                <h2 className="text-lg font-semibold text-slate-900">{label}</h2>
                <TeamCardGrid teams={teamsByType(value)} />
              </section>
            ))}
            {genericTeams.length > 0 && (
              <section
                ref={(el) => {
                  genericSectionRef.current = el;
                }}
                className="space-y-4 scroll-mt-4"
              >
                <h2 className="text-lg font-semibold text-slate-900">R&E</h2>
                <TeamCardGrid teams={genericTeams} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
