"use client";

import { useAuth } from "@/lib/auth-context";
import StudentDashboard from "./StudentDashboard";
import TeacherDashboard from "./TeacherDashboard";

// 대시보드 진입점 — 역할에 따라 학생/교사 대시보드로 나눈다. 두 대시보드는 같은 연간 연구 여정, 일정,
// 요약 카드 컴포넌트(src/components/dashboard)를 공유하고 역할별 데이터/업무만 다르다.
// scope "all"은 관리자 전체 대시보드(/admin/dashboard)가 쓴다.
export default function DashboardClient({ scope }: { scope: "mine" | "all" }) {
  const { profile, loading } = useAuth();
  if (loading || !profile) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  const isTeacherOrAdmin = profile.role === "teacher" || profile.is_admin === true;
  return isTeacherOrAdmin ? <TeacherDashboard scope={scope} /> : <StudentDashboard />;
}
