"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useRequireAdmin } from "@/lib/role-guards";
import { Card } from "@/components/ui/Card";

interface SimpleUser {
  id: string;
  name: string;
  email: string;
}

export default function AdminRolesPage() {
  const { userId } = useAuth();
  const { loading: authLoading, allowed } = useRequireAdmin("/dashboard");

  const [admins, setAdmins] = useState<SimpleUser[]>([]);
  const [teachers, setTeachers] = useState<SimpleUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const supabase = createClient();
    setLoading(true);

    const [{ data: adminRows }, { data: teacherRows }] = await Promise.all([
      supabase.from("users").select("id, name, email").eq("is_admin", true).order("name"),
      supabase
        .from("users")
        .select("id, name, email")
        .eq("role", "teacher")
        .eq("is_admin", false)
        .order("name"),
    ]);

    setAdmins(adminRows ?? []);
    setTeachers(teacherRows ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || !allowed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [authLoading, allowed]);

  // 관리자 권한 변경은 브라우저에서 public.users를 직접 수정하지 않고 서버 API(/api/admin/set-admin)만 거친다.
  // 서버가 요청자의 관리자 여부와 "마지막 관리자 해제 금지"를 다시 확인한다.
  const changeAdmin = async (targetId: string, isAdmin: boolean) => {
    setError(null);
    setBusyId(targetId);
    try {
      const response = await fetch("/api/admin/set-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetId, isAdmin }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "관리자 권한을 변경하지 못했습니다.");
        return;
      }
      await load();
    } catch {
      setError("네트워크 오류로 관리자 권한을 변경하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = (targetId: string) => changeAdmin(targetId, false);
  const handleGrant = (targetId: string) => changeAdmin(targetId, true);

  const filteredTeachers = teachers.filter((teacher) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return (
      teacher.name.toLowerCase().includes(query) || teacher.email.toLowerCase().includes(query)
    );
  });

  if (authLoading || !allowed) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">관리자 권한 관리</h1>
        <p className="mt-1 text-sm text-slate-500">관리자 계정을 관리하세요.</p>
      </div>

      <Card>
        <h2 className="text-base font-semibold text-slate-900">현재 관리자</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {admins.map((admin) => (
              <li key={admin.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    {admin.name}
                    {admin.id === userId && (
                      <span className="ml-1.5 text-xs text-slate-400">(본인)</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">{admin.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(admin.id)}
                  disabled={busyId !== null}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
                >
                  권한 취소
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-slate-900">교사에게 관리자 권한 부여</h2>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="이름 또는 이메일로 검색"
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        {loading ? (
          <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
        ) : filteredTeachers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">대상 교사가 없습니다.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {filteredTeachers.map((teacher) => (
              <li key={teacher.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">{teacher.name}</p>
                  <p className="text-xs text-slate-400">{teacher.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleGrant(teacher.id)}
                  disabled={busyId !== null}
                  className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-600 disabled:opacity-60"
                >
                  관리자 권한 부여
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
