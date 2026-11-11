import { NextResponse } from "next/server";
import { createClient as createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

interface TeamRow {
  name: string;
  type: "rne" | "club";
  subtype?: string;
  teacherUsername?: string;
  studentUsernames?: string[];
  field?: string;
  schoolYear?: string;
}

interface RowResult {
  row: number;
  success: boolean;
  name?: string;
  error?: string;
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: requester } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!requester?.is_admin) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { teams } = (await request.json()) as { teams: TeamRow[] };

  if (!Array.isArray(teams) || teams.length === 0) {
    return NextResponse.json({ error: "등록할 팀이 없습니다." }, { status: 400 });
  }

  const results: RowResult[] = [];

  for (let i = 0; i < teams.length; i++) {
    const rowNumber = i + 1;
    const row = teams[i];

    if (!row.name || !row.type) {
      results.push({ row: rowNumber, success: false, error: "팀명과 유형은 필수입니다." });
      continue;
    }

    // 지도교사 조회
    let teacherId: string | null = null;
    if (row.teacherUsername) {
      const { data: teacher } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("username", row.teacherUsername.normalize("NFC"))
        .eq("role", "teacher")
        .maybeSingle();
      if (!teacher) {
        results.push({ row: rowNumber, success: false, error: `교사 username을 찾을 수 없습니다: ${row.teacherUsername}` });
        continue;
      }
      teacherId = teacher.id;
    }

    // 학생 조회
    const studentIds: string[] = [];
    if (row.studentUsernames && row.studentUsernames.length > 0) {
      for (const username of row.studentUsernames) {
        if (!username) continue;
        const { data: student } = await supabaseAdmin
          .from("users")
          .select("id")
          .eq("username", username.normalize("NFC"))
          .eq("role", "student")
          .maybeSingle();
        if (!student) {
          results.push({ row: rowNumber, success: false, error: `학생 username을 찾을 수 없습니다: ${username}` });
          studentIds.length = 0; // sentinel
          break;
        }
        studentIds.push(student.id);
      }
      if (studentIds.length === 0 && row.studentUsernames.some((u) => u)) {
        continue;
      }
    }

    // 팀 생성
    const { data: team, error: teamError } = await supabaseAdmin
      .from("teams")
      .insert({
        type: row.type,
        subtype: row.type === "rne" ? (row.subtype ?? null) : null,
        teacher_id: teacherId,
        name: row.name,
        field: row.field ?? null,
        school_year: row.schoolYear ?? null,
      })
      .select()
      .single();

    if (teamError || !team) {
      results.push({ row: rowNumber, success: false, error: teamError?.message ?? "팀 생성 실패" });
      continue;
    }

    // 팀원 등록
    if (studentIds.length > 0) {
      await supabaseAdmin.from("team_members").insert(
        studentIds.map((studentId) => ({
          team_id: team.id,
          student_id: studentId,
          is_leader: false,
        }))
      );
    }

    results.push({ row: rowNumber, success: true, name: row.name });
  }

  return NextResponse.json({ results });
}
