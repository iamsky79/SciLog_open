"use client";

import { useAuth } from "@/lib/auth-context";
import DashboardClient from "../../dashboard/DashboardClient";

export default function AdminDashboardPage() {
  const { profile, loading: authLoading } = useAuth();

  if (authLoading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (!profile?.is_admin) return <p className="text-sm text-slate-400">접근 권한이 없습니다.</p>;

  return <DashboardClient scope="all" />;
}
