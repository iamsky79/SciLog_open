import { NextResponse } from "next/server";
import { createClient as createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateInitialPassword } from "@/lib/account-codes";

interface ResetBody {
  userId?: string;
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

  const { userId } = (await request.json()) as ResetBody;
  if (!userId) {
    return NextResponse.json({ error: "대상 사용자가 지정되지 않았습니다." }, { status: 400 });
  }

  // service_role로 RLS 우회해 대상 사용자 정보를 읽는다.
  const { data: target } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (!target) {
    return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  }

  if (target.role !== "teacher" && target.role !== "student") {
    return NextResponse.json(
      { error: "초기 비밀번호를 만들 수 없는 역할입니다." },
      { status: 400 }
    );
  }

  // 새 무작위 초기 비밀번호를 만든다. 이 응답에서만 한 번 보여주고 어디에도 저장하지 않는다.
  const initialPassword = generateInitialPassword();

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: initialPassword,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  // 초기 비밀번호를 새로 발급했으니 다음 로그인 때 다시 바꾸도록 플래그를 되돌린다.
  await supabaseAdmin.from("users").update({ password_changed: false }).eq("id", userId);

  return NextResponse.json({ success: true, initialPassword });
}
