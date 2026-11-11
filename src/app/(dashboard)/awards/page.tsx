"use client";

import { useEffect, useState } from "react";
import { Plus, Award as AwardIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import type { AwardRecord } from "@/lib/database.types";

const GRADES = ["금상", "은상", "동상"] as const;
const gradeTone: Record<string, Tone> = {
  금상: "gold",
  은상: "gray",
  동상: "copper",
};

const emptyForm = {
  award_name: "",
  competition: "",
  organizer: "",
  award_date: "",
  grade: GRADES[0] as string,
  drive_link: "",
};

export default function AwardsPage() {
  const { userId, profile, loading: authLoading } = useAuth();
  const [awards, setAwards] = useState<AwardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const supabase = createClient();
    setLoading(true);
    const { data } = await supabase
      .from("awards")
      .select("*")
      .order("award_date", { ascending: false });
    setAwards((data as AwardRecord[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [authLoading]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;
    setSaving(true);

    const supabase = createClient();
    await supabase.from("awards").insert({
      student_id: userId,
      award_name: form.award_name,
      competition: form.competition || null,
      organizer: form.organizer || null,
      award_date: form.award_date || null,
      grade: form.grade,
      drive_link: form.drive_link || null,
    });

    setSaving(false);
    setShowForm(false);
    setForm(emptyForm);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">수상 성과</h1>
          <p className="mt-1 text-sm text-slate-500">지금까지의 수상 기록을 확인하세요.</p>
        </div>
        {profile?.role === "student" && (
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-600"
          >
            <Plus className="h-4 w-4" />
            새 수상 등록
          </button>
        )}
      </div>

      {showForm && (
        <Card>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">수상명</label>
              <input
                required
                value={form.award_name}
                onChange={(event) => setForm({ ...form, award_name: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">대회명</label>
              <input
                value={form.competition}
                onChange={(event) => setForm({ ...form, competition: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">주최기관</label>
              <input
                value={form.organizer}
                onChange={(event) => setForm({ ...form, organizer: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">날짜</label>
                <input
                  type="date"
                  value={form.award_date}
                  onChange={(event) => setForm({ ...form, award_date: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">등급</label>
                <select
                  value={form.grade}
                  onChange={(event) => setForm({ ...form, grade: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  {GRADES.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">드라이브 링크</label>
              <input
                type="url"
                value={form.drive_link}
                onChange={(event) => setForm({ ...form, drive_link: event.target.value })}
                placeholder="https://drive.google.com/..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </form>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : awards.length === 0 ? (
        <p className="text-sm text-slate-400">등록된 수상 기록이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {awards.map((award) => (
            <Card key={award.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <AwardIcon className="h-5 w-5" />
                </div>
                {award.grade && (
                  <Badge tone={gradeTone[award.grade] ?? "gray"}>{award.grade}</Badge>
                )}
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{award.award_name}</h3>
              {award.competition && (
                <p className="mt-2 text-sm text-slate-500">{award.competition}</p>
              )}
              {award.award_date && (
                <p className="mt-1 text-sm text-slate-400">{award.award_date}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
