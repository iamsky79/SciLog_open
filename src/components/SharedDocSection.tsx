"use client";

import { useState } from "react";
import { ExternalLink, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase";

interface Props {
  entityType: "rne" | "club" | "individual";
  entityId: string;
  initialUrl: string | null;
  canEdit: boolean;
}

export function SharedDocSection({ entityType, entityId, initialUrl, canEdit }: Props) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [draft, setDraft] = useState(initialUrl ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    const value = draft.trim() || null;
    if (entityType === "individual") {
      await supabase.from("individual_research").update({ shared_doc_url: value }).eq("id", entityId);
    } else {
      await supabase.from("teams").update({ shared_doc_url: value }).eq("id", entityId);
    }
    setUrl(value ?? "");
    setSaving(false);
    setEditing(false);
  };

  return (
    <>
      <span className="flex items-center gap-1 text-sm">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-medium text-sky-600 hover:text-sky-800"
          >
            🔗 공유 문서 열기 <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : canEdit ? (
          <button type="button" onClick={() => { setDraft(""); setEditing(true); }} className="text-slate-400 hover:text-sky-600">
            🔗 공유 문서 추가
          </button>
        ) : (
          <span className="text-slate-400">공유 문서 없음</span>
        )}
        {url && canEdit && (
          <button
            type="button"
            onClick={() => { setDraft(url); setEditing(true); }}
            title="URL 수정"
            className="text-slate-400 hover:text-slate-600"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </span>

      {editing && (
        <div className="mt-2 flex w-full items-center gap-2">
          <input
            type="url"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://docs.google.com/..."
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
        </div>
      )}
    </>
  );
}
