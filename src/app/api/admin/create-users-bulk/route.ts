import { NextResponse } from "next/server";
import { createClient as createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createAccount } from "@/lib/create-account";
import { findAvailableUsername } from "@/lib/username-utils";
import {
  generateInitialPassword,
  buildStudentEmail,
  buildStudentNumber,
  buildStudentUsername,
  buildTeacherEmail,
  buildTeacherUsername,
} from "@/lib/account-codes";
import { subjectToEnglish } from "@/lib/subject-map";

interface StudentRow {
  cohort?: number;
  name?: string;
  grade?: number;
  class?: number;
  number?: number;
}

interface TeacherRow {
  name?: string;
  subject?: string;
  subjectEn?: string;
}

interface BulkBody {
  role: "student" | "teacher";
  rows: (StudentRow | TeacherRow)[];
}

interface RowResult {
  row: number;
  success: boolean;
  username?: string;
  initialPassword?: string;
  error?: string;
  notice?: string;
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

  const body = (await request.json()) as BulkBody;
  const { role, rows } = body;

  if (!role || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "등록할 행이 없습니다." }, { status: 400 });
  }

  const results: RowResult[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 1;
    const row = rows[index];

    if (role === "student") {
      const { cohort, name, grade, class: classNo, number } = row as StudentRow;
      if (!name || cohort == null || grade == null || classNo == null || number == null) {
        results.push({ row: rowNumber, success: false, error: "필수 항목이 비어 있습니다." });
        continue;
      }

      const email = buildStudentEmail(cohort, buildStudentNumber(grade, classNo, number));

      // 완전 중복 체크: 같은 기수+학번 학생이 이미 존재하면 건너뜀
      const { data: existingStudent } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existingStudent) {
        results.push({ row: rowNumber, success: false, error: "이미 존재하는 계정입니다." });
        continue;
      }

      const baseUsername = buildStudentUsername(cohort, name).normalize("NFC");
      const username = await findAvailableUsername(baseUsername);
      const notice = username !== baseUsername ? "동명이인으로 자동 변경" : undefined;
      const initialPassword = generateInitialPassword();

      const result = await createAccount({
        name,
        role: "student",
        username,
        email,
        initialPassword,
        grade,
        classNo,
        number,
      });
      results.push({ row: rowNumber, ...result, ...(notice ? { notice } : {}) });
    } else {
      const { name, subject, subjectEn } = row as TeacherRow;
      if (!name || !subject) {
        results.push({ row: rowNumber, success: false, error: "필수 항목이 비어 있습니다." });
        continue;
      }

      const subjectEnglish = subjectToEnglish(subject, subjectEn);
      if (!subjectEnglish) {
        results.push({
          row: rowNumber,
          success: false,
          error: `지원하지 않는 과목입니다: ${subject} (영문 코드 매핑 필요)`,
        });
        continue;
      }

      const baseUsername = buildTeacherUsername(name).normalize("NFC");
      const username = await findAvailableUsername(baseUsername);
      const notice = username !== baseUsername ? "동명이인으로 자동 변경" : undefined;
      const initialPassword = generateInitialPassword();
      const email = buildTeacherEmail();

      const result = await createAccount({
        name,
        role: "teacher",
        username,
        email,
        initialPassword,
        subject,
      });
      results.push({ row: rowNumber, ...result, ...(notice ? { notice } : {}) });
    }
  }

  return NextResponse.json({ results });
}
