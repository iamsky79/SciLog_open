"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useRequireRole } from "@/lib/role-guards";
import { Card } from "@/components/ui/Card";
import type { ReportSchedule, Semester } from "@/lib/database.types";

const TERM_OPTIONS: { value: Semester; label: string }[] = [
  { value: "1-2", label: "1학년 2학기" },
  { value: "2-1", label: "2학년 1학기" },
  { value: "2-2", label: "2학년 2학기" },
  { value: "3-1", label: "3학년 1학기" },
];

const SUBJECT_OPTIONS = ["물리", "화학", "생명과학", "지구과학", "정보", "수학"];

interface SimpleTeacher {
  id: string;
  name: string;
}

export default function NewIndividualResearchPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const { loading, allowed } = useRequireRole("student", "/individual");

  const [teachers, setTeachers] = useState<SimpleTeacher[]>([]);
  const [regSchedule, setRegSchedule] = useState<ReportSchedule | null>(null);
  const [semester, setSemester] = useState<Semester>(TERM_OPTIONS[0].value);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();
      const [{ data: teacherData, error: teacherErr }, { data: schedData, error: schedErr }] = await Promise.all([
        supabase.from("users").select("id, name").eq("role", "teacher").order("name"),
        supabase.from("report_schedules").select("*").eq("submission_type", "registration").order("deadline", { ascending: false }),
      ]);
      if (teacherErr) console.error("지도교사 목록 조회 실패:", teacherErr);
      setTeachers(teacherData ?? []);
      if (schedErr) {
        // 이 페이지 자체는 등록 기간 여부로 막히지 않는다(진입 자체가 /individual의
        // "등록 기간" 게이트를 이미 통과했다는 뜻) — 연도 표시/폴백에만 쓰이므로
        // 여기서는 콘솔에만 남기고 폼 진행을 막지 않는다.
        console.error("등록 기간 일정 조회 실패:", schedErr);
      } else {
        const regSchedules = (schedData ?? []) as ReportSchedule[];
        const byType = regSchedules.find((s) => s.entity_type === "individual" && !s.entity_id);
        const globalSched = regSchedules.find((s) => !s.entity_type && !s.entity_id);
        setRegSchedule(byType ?? globalSched ?? null);
      }
    }
    loadData();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;
    if (!subject) { setError("연구 분야를 선택해주세요."); return; }
    if (!teacherId) { setError("지도교사를 선택해주세요."); return; }

    setError("");
    setSaving(true);

    const supabase = createClient();
    const { data: research, error: insertError } = await supabase
      .from("individual_research")
      .insert({
        student_id: userId,
        teacher_id: teacherId,
        semester,
        title,
        subject,
        field: subject,
        year: regSchedule ? new Date(regSchedule.deadline).getFullYear() : new Date().getFullYear(),
        plan_status: "draft",
      })
      .select()
      .single();

    setSaving(false);
    if (insertError || !research) {
      console.error("창의개인연구 등록 실패:", insertError);
      setError(`창의개인연구를 등록하지 못했습니다. (${insertError?.message ?? "알 수 없는 오류"})`);
      return;
    }
    router.push(`/individual/${research.id}`);
  };

  if (loading || !allowed) return <p className="text-sm text-slate-400">불러오는 중...</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">새 창의개인연구 등록</h1>
        <p className="mt-1 text-sm text-slate-500">기본 정보를 입력하고 연구를 생성하세요. 계획서는 생성 후 작성합니다.</p>
        {regSchedule && (
          <p className="mt-1 text-sm text-sky-600">{new Date(regSchedule.deadline).getFullYear()}학년도 등록</p>
        )}
      </div>

      <Card>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              연구 제목 <span className="text-red-500">*</span>
            </label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="연구 제목을 입력하세요"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              연구 분야 <span className="text-red-500">*</span>
            </label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">분야를 선택하세요</option>
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              학기 <span className="text-red-500">*</span>
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value as Semester)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {TERM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              지도교사 <span className="text-red-500">*</span>
            </label>
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">지도교사를 선택하세요</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "생성 중..." : "연구 생성하기"}
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
