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

interface CreateUserBody {
  name: string;
  role: "student" | "teacher";
  cohort?: number;
  grade?: number;
  class?: number;
  number?: number;
  subject?: string;
  subjectEn?: string;
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

  const body = (await request.json()) as CreateUserBody;
  const { name, role, cohort, grade, class: classNo, number, subject, subjectEn } = body;

  if (!name || !role) {
    return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
  }

  let username: string;
  let baseUsername: string;
  let email: string;
  let initialPassword: string;

  if (role === "student") {
    if (cohort == null || grade == null || classNo == null || number == null) {
      return NextResponse.json({ error: "학생 정보가 누락되었습니다." }, { status: 400 });
    }

    email = buildStudentEmail(cohort, buildStudentNumber(grade, classNo, number));

    // 완전 중복 체크: 같은 기수+학번 학생이 이미 존재하면 생성 불가
    const { data: existingStudent } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existingStudent) {
      return NextResponse.json({ error: "이미 존재하는 계정입니다." }, { status: 400 });
    }

    baseUsername = buildStudentUsername(cohort, name).normalize("NFC");
    username = await findAvailableUsername(baseUsername);
    initialPassword = generateInitialPassword();
  } else {
    if (!subject) {
      return NextResponse.json({ error: "과목 정보가 누락되었습니다." }, { status: 400 });
    }
    const subjectEnglish = subjectToEnglish(subject, subjectEn);
    if (!subjectEnglish) {
      return NextResponse.json({ error: "과목 영문 코드가 올바르지 않습니다." }, { status: 400 });
    }

    baseUsername = buildTeacherUsername(name).normalize("NFC");
    username = await findAvailableUsername(baseUsername);
    initialPassword = generateInitialPassword();
    email = buildTeacherEmail();
  }

  const notice = username !== baseUsername ? "동명이인으로 자동 변경" : undefined;

  const result = await createAccount({
    name,
    role,
    username,
    email,
    initialPassword,
    grade: role === "student" ? grade : null,
    classNo: role === "student" ? classNo : null,
    number: role === "student" ? number : null,
    subject: role === "teacher" ? subject ?? null : null,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    username: result.username,
    initialPassword: result.initialPassword,
    ...(notice ? { notice } : {}),
  });
}
