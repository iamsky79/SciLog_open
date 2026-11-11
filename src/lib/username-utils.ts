import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * base username이 이미 사용 중이면 base2, base3, ... 순서로 빈 username을 찾아 반환한다.
 * 사용 가능한 username이 없으면 예외를 던진다.
 */
export async function findAvailableUsername(base: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("username", base)
    .maybeSingle();
  if (!data) return base;

  for (let n = 2; n <= 99; n++) {
    const candidate = `${base}${n}`;
    const { data: existing } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("username", candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  throw new Error("사용 가능한 아이디를 찾을 수 없습니다.");
}
