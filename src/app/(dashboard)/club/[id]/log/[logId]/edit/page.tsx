"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { FileAttachments } from "@/components/ActivityLogSection";
import type { ActivityLog } from "@/lib/database.types";

const FORM_A_FIELDS: { key: keyof ActivityLog; label: string }[] = [
  { key: "goal", label: "오늘의 목표" },
  { key: "experiment", label: "실험 내용" },
  { key: "result", label: "결과 및 관찰" },
  { key: "conclusion", label: "고찰 및 결론" },
  { key: "next_plan", label: "다음 계획" },
  { key: "free_memo", label: "자유 메모" },
];

type FormState = Record<string, string>;

export default function ClubLogEditPage() {
  const params = useParams<{ id: string; logId: string }>();
  const { id: teamId, logId } = params;
  const router = useRouter();
  const { userId, loading: authLoading } = useAuth();

  const [log, setLog] = useState<ActivityLog | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !logId || !userId) return;

    async function load() {
      const supabase = createClient();
      setLoading(true);

      const { data } = await supabase.from("activity_logs").select("*").eq("id", logId).single();
      const logRow = data as ActivityLog | null;

      if (!logRow) {
        setAccessError("기록을 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      if (logRow.author_id !== userId) {
        router.replace(`/club/${teamId}/log/${logId}`);
        return;
      }

      if (logRow.status === "approved") {
        setAccessError("승인된 기록은 수정할 수 없습니다.");
        setLog(logRow);
        setLoading(false);
        return;
      }

      setLog(logRow);
      const initial: FormState = { log_date: logRow.log_date ?? "" };
      for (const { key } of FORM_A_FIELDS) {
        initial[key as string] = (logRow[key] as string | null) ?? "";
      }
      setForm(initial);
      setLoading(false);
    }

    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, logId, userId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!log) return;
    setSaving(true);

    const supabase = createClient();
    const updates: Record<string, string | null> = { log_date: form.log_date };
    for (const { key } of FORM_A_FIELDS) {
      updates[key as string] = form[key as string] || null;
    }

    await supabase.from("activity_logs").update(updates).eq("id", log.id);
    setSaving(false);
    router.push(`/club/${teamId}/log/${logId}`);
  };

  if (loading || authLoading) return <p className="text-sm text-slate-400">불러오는 중...</p>;

  if (accessError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{accessError}</p>
        <button
          type="button"
          onClick={() => router.push(`/club/${teamId}/log/${logId}`)}
          className="text-sm text-sky-600 hover:text-sky-700"
        >
          ← 기록으로 돌아가기
        </button>
      </div>
    );
  }

  if (!log) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-slate-900">활동 기록 수정</h1>

      <Card>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">날짜</label>
            <input
              type="date"
              required
              value={form.log_date ?? ""}
              onChange={(e) => setForm({ ...form, log_date: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {FORM_A_FIELDS.map(({ key, label }) => (
            <div key={String(key)}>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
              <textarea
                rows={3}
                value={form[key as string] ?? ""}
                onChange={(e) => setForm({ ...form, [key as string]: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          ))}

          {log.file_urls && log.file_urls.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">기존 첨부 파일</p>
              <FileAttachments urls={log.file_urls} />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-60"
            >
              {saving ? "저장 중..." : "저장하기"}
            </button>
            <button
              type="button"
              onClick={() => router.push(`/club/${teamId}/log/${logId}`)}
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
