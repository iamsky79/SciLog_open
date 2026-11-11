import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { Profile } from "@/lib/database.types";

const ROLE_LABEL: Record<Profile["role"], string> = { student: "학생", teacher: "선생님", viewer: "님" };

/** 한국 학년도는 3월에 시작한다 — 1~2월은 전년도에 속한다. */
export function currentAcademicYear(now: Date = new Date()): number {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

export function DashboardHeader({ profile, subtitle }: { profile: Profile | null; subtitle: string }) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">안녕하세요, {profile ? `${profile.name} ${ROLE_LABEL[profile.role]}` : "..."}!</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">{currentAcademicYear()}학년도</span>
      </div>

      {profile && !profile.password_changed && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            초기 비밀번호를 사용 중이에요. 비밀번호를 변경해주세요.
          </div>
          <Link href="/settings/password" className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-600">
            변경하기
          </Link>
        </div>
      )}
    </>
  );
}
