"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const PASSWORD_PATH = "/settings/password";

// 관리자가 발급한 초기 비밀번호를 그대로 쓰는 계정은 비밀번호를 바꾸기 전까지
// 비밀번호 변경 화면 외에는 이용할 수 없게 한다.
export default function PasswordChangeGate({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const mustChange = !loading && !!profile && !profile.password_changed;
  const blocked = mustChange && pathname !== PASSWORD_PATH;

  useEffect(() => {
    if (blocked) router.replace(PASSWORD_PATH);
  }, [blocked, router]);

  if (blocked) return null;
  return <>{children}</>;
}
