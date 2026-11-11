"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, FileDown, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Reference } from "@/lib/database.types";

const SOURCE_OPTIONS = ["DBpia", "Google Scholar", "PubMed", "RISS", "기타"];

// 한글 등 비ASCII 문자를 제거 — Supabase Storage 키는 ASCII만 허용
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || "file").slice(0, 40);
}

interface Props {
  entityType: "rne" | "club" | "individual";
  entityId: string;
  currentUserId: string;
  entityName?: string;
  schoolYear?: string | null;
}

interface FormState {
  title: string;
  authors: string;
  source: string;
  customSource: string;
  url: string;
  memo: string;
  file: File | null;
}

const emptyForm = (): FormState => ({
  title: "",
  authors: "",
  source: "DBpia",
  customSource: "",
  url: "",
  memo: "",
  file: null,
});

export function ReferencesSection({ entityType, entityId, currentUserId, entityName, schoolYear }: Props) {
  const [refs, setRefs] = useState<Reference[]>([]);
  const [authorMap, setAuthorMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("references")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    const rows = (data as Reference[]) ?? [];
    setRefs(rows);

    const creatorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
    if (creatorIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, username, name")
        .in("id", creatorIds);
      setAuthorMap(
        Object.fromEntries(
          (users ?? []).map((u) => [u.id, (u.username as string | null) ?? u.name])
        )
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const supabase = createClient();

    const sourceLabel = form.source === "기타" ? form.customSource.trim() || "기타" : form.source;

    let fileUrl: string | null = null;
    if (form.file) {
      const year = schoolYear ?? new Date().getFullYear().toString();
      const safeTitle = sanitizeFileName(form.title.trim());
      const safeName = entityName ? sanitizeFileName(entityName) : entityId.slice(0, 8);
      const fileName = `${year}_${safeName}_ref_${safeTitle}.pdf`;
      const path = `references/${entityType}/${entityId}/${Date.now()}_${fileName}`;
      const { data: uploaded } = await supabase.storage
        .from("references")
        .upload(path, form.file, { contentType: "application/pdf" });
      if (uploaded) {
        const { data: urlData } = supabase.storage.from("references").getPublicUrl(uploaded.path);
        fileUrl = urlData.publicUrl;
      }
    }

    await supabase.from("references").insert({
      entity_type: entityType,
      entity_id: entityId,
      title: form.title.trim(),
      authors: form.authors.trim() || null,
      source: sourceLabel || null,
      url: form.url.trim() || null,
      file_url: fileUrl,
      memo: form.memo.trim() || null,
      created_by: currentUserId,
    });

    setSaving(false);
    setModalOpen(false);
    setForm(emptyForm());
    await load();
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const supabase = createClient();
    const target = refs.find((r) => r.id === id);
    if (target?.file_url) {
      const match = target.file_url.match(/\/object\/public\/references\/(.+?)(?:\?|$)/);
      if (match) await supabase.storage.from("references").remove([match[1]]);
    }
    await supabase.from("references").delete().eq("id", id);
    setDeletingId(null);
    setRefs((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">참고 자료</h2>
        <button
          type="button"
          onClick={() => { setForm(emptyForm()); setModalOpen(true); }}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" />
          자료 추가
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : refs.length === 0 ? (
        <p className="text-sm text-slate-400">등록된 참고 자료가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-400">
                <th className="py-2.5 pl-4 pr-2 font-medium">제목</th>
                <th className="py-2 pr-2 font-medium">출처</th>
                <th className="py-2 pr-2 font-medium">등록자</th>
                <th className="py-2 pr-2 font-medium">파일</th>
                <th className="py-2 pr-2 font-medium">메모</th>
                <th className="py-2 pr-4 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {refs.map((ref) => (
                <tr key={ref.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pl-4 pr-2 font-medium text-slate-800">
                    {ref.url ? (
                      <a href={ref.url} target="_blank" rel="noopener noreferrer"
                        className="text-sky-600 hover:underline">
                        {ref.title}
                      </a>
                    ) : ref.title}
                    {ref.authors && (
                      <p className="text-xs text-slate-400 font-normal">{ref.authors}</p>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-slate-600">{ref.source ?? "-"}</td>
                  <td className="py-2 pr-2 text-slate-600">
                    {ref.created_by ? (authorMap[ref.created_by] ?? "-") : "-"}
                  </td>
                  <td className="py-2 pr-2">
                    {ref.file_url ? (
                      <a href={ref.file_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sky-600 hover:text-sky-800">
                        <FileDown className="h-3.5 w-3.5" />
                        PDF
                      </a>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 max-w-[160px] truncate text-slate-500 text-xs">
                    {ref.memo ?? "-"}
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => handleDelete(ref.id)}
                      disabled={deletingId === ref.id}
                      className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">자료 추가</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  논문 제목 <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">저자</label>
                <input
                  value={form.authors}
                  onChange={(e) => setForm((f) => ({ ...f, authors: e.target.value }))}
                  placeholder="홍길동, 김철수"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">출처</label>
                <select
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {form.source === "기타" && (
                  <input
                    value={form.customSource}
                    onChange={(e) => setForm((f) => ({ ...f, customSource: e.target.value }))}
                    placeholder="출처 직접 입력"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">URL (선택)</label>
                <input
                  type="url"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">PDF 파일 (선택)</label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))}
                  className="w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">메모</label>
                <textarea
                  rows={2}
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !form.title.trim()}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
