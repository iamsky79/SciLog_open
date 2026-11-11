"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { useRequireAdmin } from "@/lib/role-guards";
import { Card } from "@/components/ui/Card";
import { BulkUserUpload } from "@/components/BulkUserUpload";
import { cn } from "@/lib/utils";
import {
  buildStudentNumber,
  buildStudentUsername,
  buildTeacherUsername,
} from "@/lib/account-codes";
import { OTHER_SUBJECT, SUBJECT_OPTIONS, subjectToEnglish } from "@/lib/subject-map";
import type { Profile, UserRole } from "@/lib/database.types";

type Tab = "student" | "teacher";

interface CreateResult {
  username: string;
  initialPassword: string;
  notice?: string;
}

const GRADES = [1, 2, 3];

export default function AdminUsersPage() {
  const { loading: authLoading, allowed } = useRequireAdmin("/dashboard");
  const [tab, setTab] = useState<Tab>("student");

  const [cohort, setCohort] = useState("");
  const [studentName, setStudentName] = useState("");
  const [grade, setGrade] = useState(1);
  const [classNo, setClassNo] = useState("");
  const [number, setNumber] = useState("");

  const [teacherName, setTeacherName] = useState("");
  const [subject, setSubject] = useState(SUBJECT_OPTIONS[0].label);
  const [customSubjectEn, setCustomSubjectEn] = useState("");

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);

  const [users, setUsers] = useState<Profile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [search, setSearch] = useState("");

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<{ name: string; initialPassword: string } | null>(
    null
  );
  const [resetError, setResetError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadUsers = async () => {
    const supabase = createClient();
    setUsersLoading(true);
    const { data } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });
    setUsers((data as Profile[]) ?? []);
    setUsersLoading(false);
  };

  useEffect(() => {
    if (authLoading || !allowed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
  }, [authLoading, allowed]);

  const cohortNum = Number(cohort);
  const classNoNum = Number(classNo);
  const numberNum = Number(number);
  const studentReady =
    !!cohort &&
    !!studentName &&
    !!classNo &&
    !!number &&
    !Number.isNaN(cohortNum) &&
    !Number.isNaN(classNoNum) &&
    !Number.isNaN(numberNum);

  const studentUsername = studentReady ? buildStudentUsername(cohortNum, studentName) : null;
  const studentNumberPreview = studentReady
    ? buildStudentNumber(grade, classNoNum, numberNum)
    : null;

  const teacherSubjectEnglish = subjectToEnglish(subject, customSubjectEn);
  const teacherUsername = teacherName ? buildTeacherUsername(teacherName) : null;

  const createAccount = async (body: Record<string, unknown>) => {
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);

    const response = await fetch("/api/admin/create-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    setCreating(false);

    if (!response.ok) {
      setCreateError(result.error ?? "계정 생성에 실패했습니다.");
      return;
    }

    setCreateResult({ username: result.username, initialPassword: result.initialPassword, notice: result.notice });
    loadUsers();
  };

  const handleCreateStudent = async () => {
    if (!studentReady) return;
    await createAccount({
      name: studentName,
      role: "student",
      cohort: cohortNum,
      grade,
      class: classNoNum,
      number: numberNum,
    });
    setCohort("");
    setStudentName("");
    setClassNo("");
    setNumber("");
  };

  const handleCreateTeacher = async () => {
    if (!teacherName || !teacherSubjectEnglish) return;
    await createAccount({
      name: teacherName,
      role: "teacher",
      subject,
      subjectEn: subject === OTHER_SUBJECT ? customSubjectEn : undefined,
    });
    setTeacherName("");
    setSubject(SUBJECT_OPTIONS[0].label);
    setCustomSubjectEn("");
  };

  const handleDeleteUser = async (target: Profile) => {
    if (!window.confirm(`${target.name} 계정을 삭제할까요?\n모든 데이터(활동 기록 등)가 함께 삭제됩니다.`)) return;

    setDeletingId(target.id);
    setDeleteError(null);

    const response = await fetch("/api/admin/delete-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: target.id }),
    });
    const result = await response.json();

    setDeletingId(null);

    if (!response.ok) {
      setDeleteError(result.error ?? "삭제에 실패했습니다.");
      return;
    }

    loadUsers();
  };

  const handleResetPassword = async (target: Profile) => {
    if (!window.confirm("비밀번호를 새 무작위 초기 비밀번호로 초기화할까요?")) return;

    setResettingId(target.id);
    setResetError(null);
    setResetMessage(null);

    const response = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: target.id }),
    });
    const result = await response.json();

    setResettingId(null);

    if (!response.ok) {
      setResetError(result.error ?? "초기화에 실패했습니다.");
      return;
    }

    setResetMessage({ name: target.name, initialPassword: result.initialPassword });
    loadUsers();
  };

  const filteredUsers = users.filter((user) => {
    if (roleFilter !== "all" && user.role !== roleFilter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return (
      user.name.toLowerCase().includes(query) ||
      (user.username ?? "").toLowerCase().includes(query)
    );
  });

  if (authLoading || !allowed) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">사용자 관리</h1>
        <p className="mt-1 text-sm text-slate-500">학생·교사 계정을 생성하고 관리하세요.</p>
      </div>

      <Card>
        <div className="flex gap-1 border-b border-slate-200">
          {(["student", "teacher"] as Tab[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setCreateResult(null);
                setCreateError(null);
              }}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                tab === value
                  ? "border-sky-500 text-sky-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}
            >
              {value === "student" ? "학생 생성" : "교사 생성"}
            </button>
          ))}
        </div>

        {tab === "student" ? (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">기수</label>
              <input
                type="number"
                value={cohort}
                onChange={(event) => setCohort(event.target.value)}
                placeholder="예) 22"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">이름</label>
              <input
                value={studentName}
                onChange={(event) => setStudentName(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">학년</label>
                <select
                  value={grade}
                  onChange={(event) => setGrade(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}학년
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">반</label>
                <input
                  type="number"
                  value={classNo}
                  onChange={(event) => setClassNo(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">번호</label>
                <input
                  type="number"
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            {studentUsername && (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                아이디: <span className="font-medium text-slate-900">{studentUsername}</span> /
                학번: <span className="font-medium text-slate-900">{studentNumberPreview}</span> /
                초기 비밀번호는 생성 후 표시됩니다
              </p>
            )}

            <button
              type="button"
              onClick={handleCreateStudent}
              disabled={!studentReady || creating}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "생성 중..." : "학생 계정 생성"}
            </button>

            <BulkUserUpload
              role="student"
              expectedHeaders={["기수", "이름", "학년", "반", "번호"]}
              onUploaded={loadUsers}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">이름</label>
              <input
                value={teacherName}
                onChange={(event) => setTeacherName(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">과목</label>
              <select
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {SUBJECT_OPTIONS.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label}
                  </option>
                ))}
                <option value={OTHER_SUBJECT}>{OTHER_SUBJECT}</option>
              </select>
            </div>

            {subject === OTHER_SUBJECT && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  영문 코드
                </label>
                <input
                  value={customSubjectEn}
                  onChange={(event) => setCustomSubjectEn(event.target.value)}
                  placeholder="소문자 영문 (예: hist)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            )}

            {teacherUsername && teacherSubjectEnglish && (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                아이디: <span className="font-medium text-slate-900">{teacherUsername}</span> /
                초기 비밀번호는 생성 후 표시됩니다
              </p>
            )}

            <button
              type="button"
              onClick={handleCreateTeacher}
              disabled={!teacherName || !teacherSubjectEnglish || creating}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "생성 중..." : "교사 계정 생성"}
            </button>

            <BulkUserUpload
              role="teacher"
              expectedHeaders={["이름", "과목"]}
              onUploaded={loadUsers}
            />
          </div>
        )}

        {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}

        {createResult && (
          <div className="mt-4 space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-medium">✅ 계정 생성 완료</p>
            <p>아이디: {createResult.username}{createResult.notice ? ` (${createResult.notice})` : ""}</p>
            <p>초기 비밀번호: <span className="font-mono font-semibold">{createResult.initialPassword}</span></p>
            <p className="text-emerald-700">
              → 무작위로 만든 비밀번호라 이 화면을 벗어나면 다시 볼 수 없어요. 지금 전달해 주세요.
              (첫 로그인 때 새 비밀번호로 바꾸게 됩니다)
            </p>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">전체 사용자</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as "all" | UserRole)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="all">전체</option>
              <option value="student">학생</option>
              <option value="teacher">교사</option>
            </select>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="이름 또는 아이디 검색"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </div>

        {resetError && <p className="mt-3 text-sm text-red-600">{resetError}</p>}
        {deleteError && <p className="mt-3 text-sm text-red-600">{deleteError}</p>}

        {resetMessage && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            초기화 완료. {resetMessage.name}님의 새 초기 비밀번호:{" "}
            <span className="font-mono font-semibold">{resetMessage.initialPassword}</span>
            <span className="ml-1 text-emerald-700">(이 화면을 벗어나면 다시 볼 수 없어요)</span>
          </div>
        )}

        {usersLoading ? (
          <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-400">
                  <th className="py-2 pr-4 font-medium">이름</th>
                  <th className="py-2 pr-4 font-medium">아이디</th>
                  <th className="py-2 pr-4 font-medium">역할</th>
                  <th className="py-2 pr-4 font-medium">과목</th>
                  <th className="py-2 pr-4 font-medium">학년·반·번호</th>
                  <th className="py-2 pr-4 font-medium">비밀번호 변경</th>
                  <th className="py-2 pr-4 font-medium">가입일</th>
                  <th className="py-2 pr-4 font-medium">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td className="py-2 pr-4">
                      {user.role === "student" ? (
                        <Link
                          href={`/student/${user.id}`}
                          className="font-medium text-sky-600 hover:underline"
                        >
                          {user.name}
                        </Link>
                      ) : (
                        <span className="text-slate-700">{user.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{user.username ?? "-"}</td>
                    <td className="py-2 pr-4 text-slate-500">
                      {user.role === "student" ? "학생" : user.role === "teacher" ? "교사" : "뷰어"}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">
                      {user.role === "teacher" ? user.subject ?? "-" : "-"}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">
                      {user.role === "student" && user.grade != null
                        ? `${user.grade}학년 ${user.class ?? "-"}반 ${user.number ?? "-"}번`
                        : "-"}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">
                      {user.password_changed ? "변경됨" : "초기 비밀번호"}
                    </td>
                    <td className="py-2 pr-4 text-slate-400">
                      {new Date(user.created_at).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        {(user.role === "student" || user.role === "teacher") && (
                          <button
                            type="button"
                            onClick={() => handleResetPassword(user)}
                            disabled={resettingId === user.id}
                            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {resettingId === user.id ? "초기화 중..." : "비밀번호 초기화"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user)}
                          disabled={deletingId === user.id}
                          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingId === user.id ? "삭제 중..." : "삭제"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">
                조건에 맞는 사용자가 없습니다.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
