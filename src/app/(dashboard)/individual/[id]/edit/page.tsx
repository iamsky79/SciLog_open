"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useRequireRole } from "@/lib/role-guards";
import { Card } from "@/components/ui/Card";
import type { IndividualResearch, Semester } from "@/lib/database.types";

const TERM_OPTIONS: { value: Semester; label: string }[] = [
  { value: "1-2", label: "1학년 2학기" },
  { value: "2-1", label: "2학년 1학기" },
  { value: "2-2", label: "2학년 2학기" },
  { value: "3-1", label: "3학년 1학기" },
];

interface SimpleTeacher {
  id: string;
  name: string;
}

export default function EditIndividualResearchPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const researchId = params.id;
  const { userId } = useAuth();
  const { loading: authLoading, allowed } = useRequireRole("student", "/individual");

  const [teachers, setTeachers] = useState<SimpleTeacher[]>([]);
  const [research, setResearch] = useState<IndividualResearch | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  const [semester, setSemester] = useState<Semester>(TERM_OPTIONS[0].value);
  const [title, setTitle] = useState("");
  const [field, setField] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [planMotivation, setPlanMotivation] = useState("");
  const [planMethod, setPlanMethod] = useState("");
  const [planExpected, setPlanExpected] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadTeachers() {
      const supabase = createClient();
      const { data } = await supabase
        .from("users")
        .select("id, name")
        .eq("role", "teacher")
        .order("name");
      setTeachers(data ?? []);
    }
    loadTeachers();
  }, []);

  useEffect(() => {
    if (authLoading || !researchId) return;

    async function loadResearch() {
      const supabase = createClient();
      const { data } = await supabase
        .from("individual_research")
        .select("*")
        .eq("id", researchId)
        .single();

      const row = data as IndividualResearch | null;
      if (!row) {
        setLoadingData(false);
        return;
      }

      setResearch(row);
      setSemester(row.semester);
      setTitle(row.title);
      setField(row.field ?? "");
      setTeacherId(row.teacher_id ?? "");
      setPlanMotivation(row.plan_motivation ?? "");
      setPlanMethod(row.plan_method ?? "");
      setPlanExpected(row.plan_expected ?? "");
      setLoadingData(false);
    }

    loadResearch();
  }, [authLoading, researchId]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;

    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-action");
    const isSubmit = action === "submit";

    if (isSubmit && !teacherId) {
      setError("지도교사를 선택해주세요.");
      return;
    }

    setError("");
    setSaving(true);

    const currentStatus = research?.plan_status ?? "draft";
    // If was rejected and re-submitting, reset to submitted; if saving as draft and was rejected, keep draft
    let newStatus: "draft" | "submitted";
    if (isSubmit) {
      newStatus = "submitted";
    } else {
      // If currently rejected, allow editing as draft
      newStatus = "draft";
    }

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("individual_research")
      .update({
        teacher_id: teacherId || null,
        semester,
        title,
        field: field || null,
        plan_motivation: planMotivation || null,
        plan_method: planMethod || null,
        plan_expected: planExpected || null,
        plan_status: newStatus,
        plan_submitted_at: isSubmit ? new Date().toISOString() : (currentStatus === "submitted" ? research?.plan_submitted_at : null),
      })
      .eq("id", researchId);

    setSaving(false);

    if (updateError) {
      setError("저장 중 오류가 발생했습니다.");
      return;
    }

    router.push(`/individual/${researchId}`);
  };

  if (authLoading || !allowed || loadingData) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  if (!research) {
    return <p className="text-sm text-slate-400">연구를 찾을 수 없습니다.</p>;
  }

  const currentStatus = research.plan_status ?? "draft";
  const isAlreadySubmittedOrApproved =
    currentStatus === "submitted" || currentStatus === "approved";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">창의개인연구 수정</h1>
        <p className="mt-1 text-sm text-slate-500">연구 정보 및 계획서를 수정하세요.</p>
      </div>

      {currentStatus === "rejected" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          계획서가 반려되었습니다. 수정 후 재제출해주세요.
          {research.plan_feedback && (
            <p className="mt-1 font-medium">피드백: {research.plan_feedback}</p>
          )}
        </div>
      )}

      <Card>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">학기</label>
            <select
              value={semester}
              onChange={(event) => setSemester(event.target.value as Semester)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {TERM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              연구 제목 <span className="text-red-500">*</span>
            </label>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">연구 분야</label>
            <input
              value={field}
              onChange={(event) => setField(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              지도교사 <span className="text-red-500">*</span>
            </label>
            <select
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">지도교사를 선택하세요</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
            <p className="text-sm font-semibold text-slate-700">연구계획서</p>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                연구 동기 및 목적
              </label>
              <textarea
                rows={3}
                value={planMotivation}
                onChange={(event) => setPlanMotivation(event.target.value)}
                placeholder="이 연구를 하게 된 동기와 목적을 작성하세요."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">연구 방법</label>
              <textarea
                rows={3}
                value={planMethod}
                onChange={(event) => setPlanMethod(event.target.value)}
                placeholder="연구를 어떤 방법으로 진행할지 작성하세요."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">기대 결과</label>
              <textarea
                rows={3}
                value={planExpected}
                onChange={(event) => setPlanExpected(event.target.value)}
                placeholder="연구를 통해 기대하는 결과를 작성하세요."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          {isAlreadySubmittedOrApproved && (
            <p className="text-xs text-slate-500">
              제출된 계획서는 수정 후 재제출해주세요.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              data-action="draft"
              disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "저장 중..." : "임시 저장"}
            </button>
            {!isAlreadySubmittedOrApproved && (
              <button
                type="submit"
                data-action="submit"
                disabled={saving}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "저장 중..." : "계획서 제출"}
              </button>
            )}
            {isAlreadySubmittedOrApproved && (
              <button
                type="submit"
                data-action="submit"
                disabled={saving}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "저장 중..." : "수정 후 재제출"}
              </button>
            )}
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
