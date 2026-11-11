"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useRequireRole } from "@/lib/role-guards";
import { Card } from "@/components/ui/Card";
import { OTHER_ACTIVITY_SUBTYPE_OPTIONS, OTHER_ACTIVITY_SEMESTER_FORM_OPTIONS } from "@/lib/other-activity";
import type { OtherActivitySubtype, OtherActivitySemester } from "@/lib/database.types";

interface Teacher {
  id: string;
  name: string;
  username: string | null;
  subject: string | null;
}

export default function NewOtherActivityPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const { loading, allowed } = useRequireRole("student", "/other");

  const [academicYear, setAcademicYear] = useState<string>(String(new Date().getFullYear()));
  const [semester, setSemester] = useState<OtherActivitySemester | "">("");
  const [subtype, setSubtype] = useState<OtherActivitySubtype>(OTHER_ACTIVITY_SUBTYPE_OPTIONS[0].value);
  const [title, setTitle] = useState("");
  const [activityDate, setActivityDate] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [content, setContent] = useState("");
  const [result, setResult] = useState("");
  const [teacherId, setTeacherId] = useState<string>("");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("users")
      .select("id, name, username, subject")
      .eq("role", "teacher")
      .order("name")
      .then(({ data }) => setTeachers((data as Teacher[]) ?? []));
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;
    setSaving(true);

    const supabase = createClient();
    const { data: activity, error } = await supabase
      .from("other_activities")
      .insert({
        student_id: userId,
        academic_year: academicYear ? parseInt(academicYear, 10) : null,
        semester: semester || null,
        subtype,
        title,
        activity_date: activityDate || null,
        organizer: organizer || null,
        content: content || null,
        result: result || null,
        teacher_id: teacherId || null,
        has_teacher: !!teacherId,
      })
      .select()
      .single();

    setSaving(false);

    if (error || !activity) return;

    setSavedTitle(title);
    setTitle("");
    setActivityDate("");
    setOrganizer("");
    setContent("");
    setResult("");
    setTeacherId("");
  };

  if (loading || !allowed) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">기타 활동 등록</h1>
        <p className="mt-1 text-sm text-slate-500">새로운 활동을 등록하세요.</p>
      </div>

      {savedTitle && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-700">
            &ldquo;{savedTitle}&rdquo; 활동이 등록되었습니다.
          </p>
          <button
            type="button"
            onClick={() => router.push("/other")}
            className="text-xs font-semibold text-green-700 underline hover:text-green-800"
          >
            목록 보기
          </button>
        </div>
      )}

      <Card>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">학년도</label>
              <input
                required
                type="number"
                inputMode="numeric"
                value={academicYear}
                onChange={(event) => setAcademicYear(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                학기 <span className="text-slate-400 font-normal">(선택)</span>
              </label>
              <select
                value={semester}
                onChange={(event) => setSemester(event.target.value as OtherActivitySemester | "")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {OTHER_ACTIVITY_SEMESTER_FORM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">활동 유형</label>
            <select
              value={subtype}
              onChange={(event) => setSubtype(event.target.value as OtherActivitySubtype)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {OTHER_ACTIVITY_SUBTYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">활동 제목</label>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                날짜 <span className="text-slate-400 font-normal">(선택)</span>
              </label>
              <input
                type="date"
                value={activityDate}
                onChange={(event) => setActivityDate(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                주최기관 <span className="text-slate-400 font-normal">(선택)</span>
              </label>
              <input
                value={organizer}
                onChange={(event) => setOrganizer(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">활동 내용</label>
            <textarea
              required
              rows={6}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              결과 및 성과 <span className="text-slate-400 font-normal">(선택)</span>
            </label>
            <textarea
              rows={3}
              value={result}
              onChange={(event) => setResult(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              지도교사 <span className="text-slate-400 font-normal">(선택)</span>
            </label>
            <select
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">지도교사 없음</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.subject ? ` (${t.subject})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "저장 중..." : "저장하기"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              취소
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
