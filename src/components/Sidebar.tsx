"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FlaskConical,
  Users,
  Lightbulb,
  Activity,
  Award,
  LogOut,
  UserCog,
  Layers,
  ShieldCheck,
  KeyRound,
  ClipboardList,
  Archive,
  Calendar,
  FileUp,
  GraduationCap,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { fetchPendingReviewCount } from "@/lib/review/pendingCount";
import { onReviewChanged } from "@/lib/review/actions";
import { fetchActionableSubmissionCount } from "@/lib/submissions/hub";

const roleLabel = {
  student: "학생",
  teacher: "교사",
  viewer: "뷰어",
};

const studentNav = [
  { label: "대시보드", href: "/dashboard", icon: LayoutDashboard },
  { label: "R&E", href: "/rne", icon: FlaskConical },
  { label: "동아리", href: "/club", icon: Users },
  { label: "창의개인연구", href: "/individual", icon: Lightbulb },
  { label: "기타 활동", href: "/other", icon: Activity },
  { label: "수상 성과", href: "/awards", icon: Award },
  { label: "제출물", href: "/submissions", icon: FileUp },
  { label: "내 포트폴리오", href: "/portfolio", icon: GraduationCap },
];

const teacherNav = [
  { label: "대시보드", href: "/dashboard", icon: LayoutDashboard },
  { label: "R&E", href: "/rne", icon: FlaskConical },
  { label: "동아리", href: "/club", icon: Users },
  { label: "창의개인연구", href: "/individual", icon: Lightbulb },
  { label: "기타 활동", href: "/other", icon: Activity },
  { label: "제출물 관리", href: "/archive", icon: Archive },
  { label: "학생 포트폴리오", href: "/students", icon: GraduationCap },
];

const adminOnlyNav = [
  { label: "전체 대시보드", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "사용자 관리", href: "/admin/users", icon: UserCog },
  { label: "팀 관리", href: "/admin/teams", icon: Layers },
  { label: "전체 팀 현황", href: "/admin/teams-overview", icon: ClipboardList },
  { label: "관리자 권한 관리", href: "/admin/roles", icon: ShieldCheck },
  // "제출 관리" — 제출 현황(집계/모니터링)과 제출 일정 관리(마감일 설정)를 나란히 둔다.
  // 예전 "전체 검토"(교사 승인 UI 복제)는 개념 자체를 없애고 /admin/review는
  // 제출 현황으로 redirect한다.
  { label: "제출 현황", href: "/admin/submissions", icon: ListChecks },
  { label: "제출 일정 관리", href: "/admin/report-schedule", icon: Calendar },
];


export default function Sidebar() {
  const pathname = usePathname();
  const { userId, profile, signOut } = useAuth();

  const isAdmin = profile?.is_admin === true;
  const navItems = isAdmin || profile?.role === "teacher" ? teacherNav : studentNav;

  const [reviewPendingCount, setReviewPendingCount] = useState(0);
  const [submissionActionCount, setSubmissionActionCount] = useState(0);

  useEffect(() => {
    if (!profile || (profile.role !== "teacher" && !profile.is_admin)) return;
    if (!userId) return;
    let cancelled = false;
    const refresh = () => {
      fetchPendingReviewCount({ userId, isAdmin: profile.is_admin === true }).then((count) => {
        if (!cancelled) setReviewPendingCount(count);
      });
    };
    refresh();
    // 라우트 이동 시(위 pathname 의존성) + 어느 화면에서든 승인/수정요청이 일어났을 때
    // (scilog:review-changed 이벤트) 다시 계산한다. 전역 상태 라이브러리 없이도
    // 같은 화면에 머문 채 처리한 경우까지 배지가 즉시 갱신되도록 하기 위함.
    const unsubscribe = onReviewChanged(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [profile, userId, pathname]);

  useEffect(() => {
    if (!profile || profile.role !== "student") return;
    if (!userId) return;
    let cancelled = false;
    const refresh = () => {
      fetchActionableSubmissionCount(userId).then((count) => {
        if (!cancelled) setSubmissionActionCount(count);
      });
    };
    refresh();
    // 교사가 검토(승인/수정요청)하면 같은 이벤트가 발생하므로, 학생 쪽 배지도
    // 새로고침 없이 즉시 갱신된다(승인/수정요청 mutation이 같은 source of truth를 씀).
    const unsubscribe = onReviewChanged(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [profile, userId, pathname]);

  return (
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col overflow-y-auto bg-[#1e2a3a]">
      <div className="px-6 py-6">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-6 w-6 text-sky-400" />
          <span className="text-xl font-bold text-white">SciLog</span>
        </div>
        <p className="mt-1 text-[11px] font-semibold tracking-wider text-slate-400">
          RESEARCH PORTFOLIO
        </p>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          const badgeCount = href === "/archive" ? reviewPendingCount : href === "/submissions" ? submissionActionCount : 0;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sky-500/20 text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
              {badgeCount > 0 && (
                <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="my-3 border-t border-white/10" />
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-500">
              관리자
            </p>
            {adminOnlyNav.map(({ label, href, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sky-500/20 text-white"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="border-t border-white/10 px-3 py-4">
        <div className="mb-2 space-y-0.5">
          <a
            href="https://www.dbpia.co.kr"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <span className="text-xs">🔗</span>
            DBpia
          </a>
          <a
            href="https://www.copykiller.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <span className="text-xs">🔗</span>
            카피킬러
          </a>
        </div>
        <div className="mb-1 border-t border-white/10" />
        <Link
          href="/settings/password"
          className={cn(
            "mb-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
            pathname.startsWith("/settings/password")
              ? "bg-sky-500/20 text-white"
              : "text-slate-300 hover:bg-white/5 hover:text-white"
          )}
        >
          <KeyRound className="h-5 w-5" />
          비밀번호 변경
        </Link>
        <div className="flex items-center justify-between rounded-md px-3 py-2">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-300">
              {profile?.name?.charAt(0) ?? "?"}
            </div>
            <span className="truncate text-sm font-medium text-slate-200">
              {profile
                ? `${profile.name} ${isAdmin ? "관리자" : roleLabel[profile.role]}`
                : "로딩 중..."}
            </span>
          </div>
          <button
            type="button"
            aria-label="로그아웃"
            onClick={signOut}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
