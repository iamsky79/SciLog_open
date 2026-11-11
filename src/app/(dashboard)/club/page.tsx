"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import type { Team } from "@/lib/database.types";

interface ClubCardInfo extends Team {
  teacherName: string | null;
  memberNames: string[];
}

export default function ClubPage() {
  const { userId, profile, loading: authLoading } = useAuth();
  const [clubs, setClubs] = useState<ClubCardInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !userId) return;

    async function load() {
      const supabase = createClient();
      const isTeacherOrAdmin = profile?.role === "teacher" || profile?.is_admin === true;
      let clubQuery = supabase
        .from("teams")
        .select("*")
        .eq("type", "club")
        .order("created_at", { ascending: false });
      if (isTeacherOrAdmin) clubQuery = clubQuery.eq("teacher_id", userId);
      const { data: teams } = await clubQuery;

      const rows = (teams as Team[]) ?? [];
      const teacherIds = Array.from(
        new Set(rows.map((t) => t.teacher_id).filter((id): id is string => !!id))
      );
      const teamIds = rows.map((t) => t.id);

      let teacherNameMap: Record<string, string> = {};
      if (teacherIds.length > 0) {
        const { data: teacherRows } = await supabase
          .from("users")
          .select("id, name")
          .in("id", teacherIds);
        teacherNameMap = Object.fromEntries((teacherRows ?? []).map((t) => [t.id, t.name]));
      }

      const memberNamesMap: Record<string, string[]> = {};
      if (teamIds.length > 0) {
        const { data: memberRows } = await supabase
          .from("team_members")
          .select("team_id, student_id")
          .in("team_id", teamIds);

        const studentIds = [
          ...new Set((memberRows ?? []).map((m: { student_id: string }) => m.student_id)),
        ];
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

      setClubs(
        rows.map((t) => ({
          ...t,
          teacherName: t.teacher_id ? (teacherNameMap[t.teacher_id] ?? null) : null,
          memberNames: memberNamesMap[t.id] ?? [],
        }))
      );
      setLoading(false);
    }

    load();
  }, [authLoading, userId, profile]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">동아리 활동</h1>
          <p className="mt-1 text-sm text-slate-500">참여 중인 동아리와 활동 기록을 확인하세요.</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : clubs.length === 0 ? (
        <p className="text-sm text-slate-400">등록된 동아리가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <Link key={club.id} href={`/club/${club.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <h3 className="text-base font-semibold text-slate-900">{club.name}</h3>
                {club.school_year && (
                  <p className="mt-1 text-xs font-medium text-sky-600">{club.school_year}학년도</p>
                )}
                <p className="mt-2 text-sm text-slate-500">
                  지도교사 · {club.teacherName ?? "미배정"}
                </p>
                {club.memberNames.length > 0 && (
                  <div className="mt-1">
                    <p className="text-xs text-slate-400">팀원</p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {club.memberNames.join(", ")}
                    </p>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1.5 text-sm text-sky-500">
                  <span>팀 상세 보기 →</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
