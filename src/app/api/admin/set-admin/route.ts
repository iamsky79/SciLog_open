import { NextResponse } from "next/server";
import { createClient as createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// 관리자 권한 부여/해제 — 브라우저가 public.users를 직접 수정하지 않고 이 서버 API만 거친다.
// (048 migration이 일반 클라이언트의 role/is_admin 변경을 DB 수준에서 막는다.)
// 1) 요청자가 실제 관리자인지 서버에서 다시 확인하고(클라이언트 값은 믿지 않는다),
// 2) service role로 set_user_admin()을 호출한다. 이 함수가 마지막 관리자 해제를 같은 트랜잭션에서 막는다.

interface SetAdminBody {
  userId?: unknown;
  isAdmin?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: requester } = await supabase.from("users").select("is_admin").eq("id", user.id).single();
  if (requester?.is_admin !== true) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as SetAdminBody | null;
  const userId = body?.userId;
  const isAdmin = body?.isAdmin;
  if (typeof userId !== "string" || !UUID_RE.test(userId) || typeof isAdmin !== "boolean") {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.rpc("set_user_admin", { p_target: userId, p_make_admin: isAdmin });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("LAST_ADMIN")) {
      return NextResponse.json({ error: "마지막 관리자는 권한을 해제할 수 없습니다. 관리자는 최소 1명 이상 유지되어야 합니다." }, { status: 409 });
    }
    if (message.includes("NOT_TEACHER")) {
      return NextResponse.json({ error: "관리자 권한은 교사에게만 부여할 수 있습니다." }, { status: 400 });
    }
    if (message.includes("NOT_FOUND")) {
      return NextResponse.json({ error: "대상 사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ error: "관리자 권한을 변경하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
