"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { ReportSchedule } from "@/lib/database.types";

interface ScheduleForm {
  title: string;
  entity_type: string;
  entity_id: string;
  deadline: string;
  description: string;
  submission_type: string;
}

const EMPTY_FORM: ScheduleForm = {
  title: "",
  entity_type: "",
  entity_id: "",
  deadline: "",
  description: "",
  submission_type: "report",
};

function entityTypeLabel(t: string | null): string {
  if (!t) return "전체 (글로벌)";
  if (t === "rne") return "R&E";
  if (t === "club") return "동아리";
  if (t === "individual") return "창의개인연구";
  return t;
}

function formatDeadline(d: string): string {
  return new Date(d).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function dDayLabel(deadline: string): string {
  const diff = Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "D-day";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

export default function ReportSchedulePage() {
  const router = useRouter();
  const { userId, profile, loading: authLoading } = useAuth();
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<ReportSchedule | null>(null);
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<ReportSchedule | null>(null);
  const [activeTab, setActiveTab] = useState<"report" | "plan" | "note" | "registration" | "competition">("report");

  useEffect(() => {
    if (!authLoading && profile && !profile.is_admin) {
      router.replace("/dashboard");
    }
  }, [authLoading, profile, router]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("report_schedules")
      .select("*")
      .order("deadline", { ascending: true });
    if (error) {
      console.error("제출 일정 목록 조회 실패:", error);
      alert(`제출 일정 목록을 불러오지 못했습니다. (${error.message})`);
    }
    setSchedules((data ?? []) as ReportSchedule[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && userId && profile?.is_admin) load();
  }, [authLoading, userId, profile, load]);

  function openAdd() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, submission_type: activeTab });
    setShowModal(true);
  }

  function openEdit(s: ReportSchedule) {
    setEditTarget(s);
    setForm({
      title: s.title,
      entity_type: s.entity_type ?? "",
      entity_id: s.entity_id ?? "",
      deadline: s.deadline.slice(0, 16),
      description: s.description ?? "",
      submission_type: s.submission_type ?? "report",
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.title || !form.deadline) { alert("제목과 마감일은 필수입니다."); return; }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      title: form.title,
      entity_type: form.entity_type || null,
      entity_id: form.entity_id || null,
      deadline: new Date(form.deadline).toISOString(),
      description: form.description || null,
      submission_type: form.submission_type || "report",
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    // 예전에는 여기서 에러를 확인하지 않아, submission_type 컬럼이 없던 시절엔
    // 저장이 매번 실패해도(42703) 사용자에게는 그냥 모달이 닫히는 것처럼 보였다
    // (038_report_schedules_submission_type.sql로 컬럼 자체는 해결하지만, 앞으로
    // 다른 이유로 실패할 때도 조용히 묻히지 않도록 에러를 반드시 확인한다).
    const { error } = editTarget
      ? await supabase.from("report_schedules").update(payload).eq("id", editTarget.id)
      : await supabase.from("report_schedules").insert(payload);
    setSaving(false);
    if (error) {
      alert(`일정 저장 실패: ${error.message}`);
      return;
    }
    setShowModal(false);
    await load();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const supabase = createClient();
    const { error } = await supabase.from("report_schedules").delete().eq("id", deleteTarget.id);
    if (error) {
      alert(`일정 삭제 실패: ${error.message}`);
      return;
    }
    setDeleteTarget(null);
    await load();
  }

  if (authLoading || loading) return <p className="text-sm text-slate-400">불러오는 중...</p>;

  const filteredSchedules = schedules.filter((s) => (s.submission_type ?? "report") === activeTab);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">제출 일정 관리</h1>
          <p className="mt-1 text-sm text-slate-500">계획서·결과보고서 제출 마감일과 외부 대회/공모전/학술발표 일정을 등록하고 관리합니다.</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
        >
          + 일정 추가
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {(["report", "plan", "note", "registration", "competition"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab === "report" ? "결과보고서 일정" : tab === "plan" ? "계획서 일정" : tab === "note" ? "연구노트 일정" : tab === "registration" ? "등록 기간" : "대회/공모전/학술발표"}
          </button>
        ))}
      </div>

      {filteredSchedules.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-400">
            등록된 {activeTab === "plan" ? "계획서" : activeTab === "note" ? "연구노트" : activeTab === "registration" ? "등록 기간" : activeTab === "competition" ? "대회/공모전/학술발표" : "결과보고서"} 일정이 없습니다.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">제목</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">적용 범위</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">마감일</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">D-day</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">설명</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSchedules.map((s) => {
                const isPast = new Date(s.deadline) < new Date();
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{s.title}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {entityTypeLabel(s.entity_type)}
                      {s.entity_id && (
                        <span className="ml-1 text-xs text-slate-400">(ID: {s.entity_id.slice(0, 8)}…)</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDeadline(s.deadline)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold ${isPast ? "text-red-500" : "text-sky-600"}`}>
                        {dDayLabel(s.deadline)}
                      </span>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-slate-500" title={s.description ?? ""}>
                      {s.description ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          className="rounded bg-sky-50 px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-100"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(s)}
                          className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 추가/수정 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              {editTarget ? "일정 수정" : "일정 추가"}
            </h2>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">제목 *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="예: 2026년 R&E 결과보고서 제출"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">적용 범위</label>
              <select
                value={form.entity_type}
                onChange={(e) => setForm((f) => ({ ...f, entity_type: e.target.value, entity_id: "" }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
              >
                <option value="">전체 (글로벌)</option>
                <option value="rne">R&E</option>
                <option value="club">동아리</option>
                <option value="individual">창의개인연구</option>
              </select>
            </div>

            {form.entity_type && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  특정 ID (선택 — 비우면 유형 전체 적용)
                </label>
                <input
                  type="text"
                  value={form.entity_id}
                  onChange={(e) => setForm((f) => ({ ...f, entity_id: e.target.value.trim() }))}
                  placeholder="팀/개인연구 UUID"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">제출 유형 *</label>
              <select
                value={form.submission_type}
                onChange={(e) => setForm((f) => ({ ...f, submission_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
              >
                <option value="report">결과보고서</option>
                <option value="plan">계획서</option>
                <option value="note">연구노트</option>
                <option value="registration">등록 기간</option>
                <option value="competition">대회/공모전/학술발표</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">마감일 *</label>
              <input
                type="datetime-local"
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">설명 (선택)</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="학생에게 표시될 안내 메시지"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">일정 삭제</h2>
            <p className="text-sm text-slate-600">
              &ldquo;{deleteTarget.title}&rdquo; 일정을 삭제하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
