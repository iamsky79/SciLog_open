"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { TeachingActivityKind } from "@/lib/portfolio/teaching";
import {
  OBSERVATION_TAGS,
  createObservation,
  deleteObservation,
  fetchObservations,
  updateObservation,
  type TeacherObservation,
} from "@/lib/observations/actions";

// 학생 row의 [+ 기록]에서 여는 drawer. 별도 사이드바 메뉴/페이지를 새로 만들지
// 않고, 여기서 작성 + 이전 기록 확인을 한 번에 처리한다. 다른 교사가 쓴 기록은
// "교사 기록"으로만 보이고(actions.ts의 isMine으로만 구분, 실명은 애초에 이 화면
// 어디에도 조회/전달하지 않는다), 본인 것만 수정/삭제 버튼이 보인다.

const ACTIVITY_OPTIONS: TeachingActivityKind[] = ["R&E", "동아리", "창의개인연구", "기타 활동"];

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ObservationDrawer({
  studentId,
  studentName,
  currentTeacherId,
  onClose,
  onCountChange,
}: {
  studentId: string;
  studentName: string;
  currentTeacherId: string;
  onClose: () => void;
  onCountChange?: (studentId: string, count: number) => void;
}) {
  const [items, setItems] = useState<TeacherObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [date, setDate] = useState(todayStr());
  const [activityType, setActivityType] = useState<TeachingActivityKind | "">("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    const data = await fetchObservations(studentId, currentTeacherId);
    setItems(data);
    onCountChange?.(studentId, data.length);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const resetForm = () => {
    setDate(todayStr());
    setActivityType("");
    setContent("");
    setTags([]);
    setEditingId(null);
  };

  const toggleTag = (tag: string) => setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    const result = editingId
      ? await updateObservation(editingId, { content: content.trim(), tags, activityType: activityType || null, observedAt: date || undefined })
      : await createObservation({
          studentId,
          authorTeacherId: currentTeacherId,
          activityType: activityType || null,
          observedAt: date,
          content: content.trim(),
          tags,
        });
    setSaving(false);
    if (result.error) {
      alert(`저장 실패: ${result.error}`);
      return;
    }
    resetForm();
    await load();
  };

  const startEdit = (item: TeacherObservation) => {
    setEditingId(item.id);
    setDate(item.observedAt ?? ""); // 날짜 미상(historical) 기록은 저장 시 observed_at을 건드리지 않는다
    setActivityType(item.activityType ?? "");
    setContent(item.content);
    setTags(item.tags);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 관찰 기록을 삭제하시겠습니까?")) return;
    const result = await deleteObservation(id);
    if (result.error) {
      alert(`삭제 실패: ${result.error}`);
      return;
    }
    if (editingId === id) resetForm();
    await load();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <p className="text-base font-semibold text-slate-900">{studentName} 학생</p>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">{editingId ? "관찰 기록 수정" : "새 관찰 기록"}</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-500">날짜</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-500">관련 활동 (선택)</label>
                <select
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value as TeachingActivityKind | "")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="">선택 안 함</option>
                  {ACTIVITY_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">관찰 내용</label>
              <textarea
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="관찰한 내용을 작성하세요."
                className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">태그 (선택)</label>
              <div className="flex flex-wrap gap-1.5">
                {OBSERVATION_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                      tags.includes(tag) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !content.trim()}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
              >
                {saving ? "저장 중..." : editingId ? "수정 저장" : "기록 저장"}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  취소
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold text-slate-700">이전 관찰 기록 {items.length > 0 && `(${items.length})`}</p>
            {loading ? (
              <p className="text-sm text-slate-400">불러오는 중...</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-slate-400">아직 기록된 관찰이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <span>{item.observedAt ? fmtDate(item.observedAt) : item.academicYear != null ? `${item.academicYear}학년도` : "날짜 미상"}</span>
                        {item.activityType && <Badge tone="gray">{item.activityType}</Badge>}
                        <Badge tone={item.isMine ? "blue" : "gray"}>{item.isMine ? "내 기록" : "교사 기록"}</Badge>
                      </div>
                      {item.isMine && (
                        <div className="flex gap-2 text-xs">
                          <button type="button" onClick={() => startEdit(item)} className="text-sky-600 hover:underline">
                            수정
                          </button>
                          <button type="button" onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline">
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{item.content}</p>
                    {item.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {item.tags.map((t) => (
                          <span key={t} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-500">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
