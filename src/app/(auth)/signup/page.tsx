import { redirect } from "next/navigation";

// 공개 회원가입은 사용하지 않는다 — 계정은 관리자가 생성한다(관리자 > 사용자 관리).
// 예전 링크/북마크는 로그인 화면으로 보낸다. 가입 요청 자체는 Supabase Auth 설정(Allow new users to sign up)에서 막는다.
export default function SignupPage() {
  redirect("/login");
}
