import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";

const INVALID_CREDENTIALS_MESSAGE = "아이디 또는 비밀번호가 올바르지 않습니다.";

export async function POST(request: Request) {
  const { username, password } = (await request.json()) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 400 });
  }

  // 한글 username은 입력 환경(macOS/iOS 등)에 따라 NFD로 들어올 수 있어,
  // DB에 NFC로 저장된 값과 정확히 일치하도록 NFC로 정규화한 뒤 조회한다.
  const normalizedUsername = username.normalize("NFC");

  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("email")
    .eq("username", normalizedUsername)
    .single();

  // username을 찾지 못한 경우도 동일한 에러로 응답해 아이디 존재 여부가
  // 노출되지 않도록 한다.
  if (!profile?.email) {
    return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
  }

  // 로그인은 반드시 요청마다 새로 만든 클라이언트로 수행한다.
  // 공유 supabaseAdmin 싱글턴에서 signInWithPassword를 호출하면 그 사용자
  // 세션이 싱글턴에 저장되어, 이후 요청에서 supabaseAdmin.from(...) 쿼리가
  // service_role이 아니라 그 사용자 권한(RLS)으로 실행되는 오염이 발생한다.
  // 그 결과 두 번째 사용자부터 username 조회가 RLS에 막혀 로그인이 실패한다.
  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await authClient.auth.signInWithPassword({
    email: profile.email,
    password,
  });

  if (error || !data.session) {
    return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
  }

  return NextResponse.json({ success: true, session: data.session });
}
