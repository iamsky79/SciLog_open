"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useRequireAdmin } from "@/lib/role-guards";
import { TeamForm, type InitialTeamData } from "@/components/TeamForm";

export default function EditClubTeamPage() {
  const { loading: authLoading, allowed } = useRequireAdmin("/club");
  const params = useParams<{ id: string }>();
  const teamId = params.id;

  const [initialData, setInitialData] = useState<InitialTeamData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !allowed || !teamId) return;

    async function load() {
      const supabase = createClient();

      const { data: team } = await supabase
        .from("teams")
        .select("*")
        .eq("id", teamId)
        .single();

      if (!team) { setDataLoading(false); return; }

      const [{ data: teacherRow }, { data: memberRows }] = await Promise.all([
        team.teacher_id
          ? supabase
              .from("users")
              .select("id, name, subject, username")
              .eq("id", team.teacher_id)
              .single()
          : Promise.resolve({ data: null }),
        supabase
          .from("team_members")
          .select("student_id")
          .eq("team_id", teamId)
          .order("joined_at", { ascending: true }),
      ]);

      let members: InitialTeamData["members"] = [];
      if (memberRows && memberRows.length > 0) {
        const studentIds = memberRows.map((m: { student_id: string }) => m.student_id);
        const { data: studentRows } = await supabase
          .from("users")
          .select("id, name, grade, class, username")
          .in("id", studentIds);

        const studentMap = Object.fromEntries(
          (studentRows ?? []).map((s: { id: string; name: string; grade: number | null; class: string | null; username: string | null }) => [s.id, s])
        );

        members = memberRows.map((m: { student_id: string }) => ({
          ...(studentMap[m.student_id] ?? { id: m.student_id, name: "알 수 없음", grade: null, class: null, username: null }),
        }));
      }

      setInitialData({
        id: team.id,
        name: team.name,
        subtype: team.subtype ?? null,
        schoolYear: team.school_year ?? null,
        semester: team.semester ?? "1",
        field: team.field ?? null,
        description: team.description ?? null,
        teacher: teacherRow ?? null,
        members,
      });
      setDataLoading(false);
    }

    load();
  }, [authLoading, allowed, teamId]);

  if (authLoading || !allowed || dataLoading) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  if (!initialData) {
    return <p className="text-sm text-slate-400">동아리를 찾을 수 없습니다.</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">동아리 팀 수정</h1>
        <p className="mt-1 text-sm text-slate-500">{initialData.name}</p>
      </div>
      <TeamForm teamType="club" initialData={initialData} />
    </div>
  );
}
