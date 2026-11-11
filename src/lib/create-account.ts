import { supabaseAdmin } from "@/lib/supabase-admin";

interface CreateAccountInput {
  name: string;
  role: "student" | "teacher";
  username: string;
  email: string;
  initialPassword: string;
  grade?: number | null;
  classNo?: number | null;
  number?: number | null;
  subject?: string | null;
}

interface CreateAccountResult {
  success: boolean;
  username?: string;
  initialPassword?: string;
  error?: string;
}

// Supabase Admin API로 auth 계정을 만들고 public.users 행을 채운다.
// auth.users insert가 handle_new_user() 트리거를 발동시켜 최소 행을 먼저
// 만들어 두므로, upsert로 나머지 필드를 덮어쓴다.
export async function createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
  const { name, role, username, email, initialPassword, grade, classNo, number, subject } = input;

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
    user_metadata: { name, role },
  });

  if (createError || !created.user) {
    const message = createError?.message.toLowerCase().includes("already")
      ? "이미 사용 중인 아이디입니다."
      : createError?.message ?? "계정 생성에 실패했습니다.";
    return { success: false, error: message };
  }

  const { error: upsertError } = await supabaseAdmin.from("users").upsert(
    {
      id: created.user.id,
      name,
      email,
      username,
      role,
      grade: role === "student" ? grade ?? null : null,
      class: role === "student" && classNo != null ? String(classNo) : null,
      number: role === "student" ? number ?? null : null,
      subject: role === "teacher" ? subject ?? null : null,
      password_changed: false,
    },
    { onConflict: "id" }
  );

  if (upsertError) {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    const message =
      upsertError.message.includes("duplicate") || upsertError.message.includes("unique")
        ? "이미 사용 중인 아이디입니다."
        : upsertError.message;
    return { success: false, error: message };
  }

  return { success: true, username, initialPassword };
}
