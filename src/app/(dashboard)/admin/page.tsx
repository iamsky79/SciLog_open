"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, FlaskConical, Clock, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useRequireAdmin } from "@/lib/role-guards";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

const QUICK_LINKS = [
  { label: "사용자 관리", href: "/admin/users" },
  { label: "팀 관리", href: "/admin/teams" },
  { label: "관리자 권한 관리", href: "/admin/roles" },
];

export default function AdminDashboardPage() {
  const { loading: authLoading, allowed } = useRequireAdmin("/dashboard");
  const [counts, setCounts] = useState({
    students: 0,
    teachers: 0,
    rneTeams: 0,
    clubTeams: 0,
    pendingLogs: 0,
    admins: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !allowed) return;

    async function load() {
      const supabase = createClient();
      const [students, teachers, rneTeams, clubTeams, pendingLogs, admins] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "student"),
        supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "teacher"),
        supabase.from("teams").select("*", { count: "exact", head: true }).eq("type", "rne"),
        supabase.from("teams").select("*", { count: "exact", head: true }).eq("type", "club"),
        supabase
          .from("activity_logs")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase.from("users").select("*", { count: "exact", head: true }).eq("is_admin", true),
      ]);

      setCounts({
        students: students.count ?? 0,
        teachers: teachers.count ?? 0,
        rneTeams: rneTeams.count ?? 0,
        clubTeams: clubTeams.count ?? 0,
        pendingLogs: pendingLogs.count ?? 0,
        admins: admins.count ?? 0,
      });
      setLoading(false);
    }

    load();
  }, [authLoading, allowed]);

  if (authLoading || !allowed) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  const summaryCards = [
    {
      label: "전체 사용자 수",
      icon: Users,
      value: loading ? "-" : `${counts.students + counts.teachers}명`,
      description: loading ? "" : `학생 ${counts.students}명 · 교사 ${counts.teachers}명`,
      accent: "bg-sky-50 text-sky-600",
    },
    {
      label: "전체 팀 수",
      icon: FlaskConical,
      value: loading ? "-" : `${counts.rneTeams + counts.clubTeams}개`,
      description: loading ? "" : `R&E ${counts.rneTeams}개 · 동아리 ${counts.clubTeams}개`,
      accent: "bg-violet-50 text-violet-600",
    },
    {
      label: "검토 대기 중인 활동 로그",
      icon: Clock,
      value: loading ? "-" : `${counts.pendingLogs}건`,
      description: "",
      accent: "bg-amber-50 text-amber-600",
    },
    {
      label: "관리자 계정 수",
      icon: ShieldCheck,
      value: loading ? "-" : `${counts.admins}명`,
      description: "",
      accent: "bg-emerald-50 text-emerald-600",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">관리자 대시보드</h1>
        <p className="mt-1 text-sm text-slate-500">SciLog 전체 현황을 확인하세요.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map(({ label, icon: Icon, value, description, accent }) => (
          <Card key={label}>
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", accent)}>
              <Icon className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
            {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
