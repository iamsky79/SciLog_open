"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { fetchProjectExportItems, type ProjectExportContext } from "@/lib/submissions/hub";
import type { ExportableSubmission } from "@/lib/export/submission-export";
import { MaterialPickerDialog } from "@/components/submissions/MaterialPicker";
import { SubmissionExportDialog } from "@/components/submissions/ExportDialog";

// R&E/동아리/창의개인연구 프로젝트 페이지의 "전체 내보내기" 공용 버튼.
// fetchProjectExportItems()로 이 프로젝트의 연구계획서/연구일지/결과보고서를
// 한 번에 조회한 뒤 → 어떤 자료를 포함할지 고르게 하고(MaterialPickerDialog) →
// 고른 것만 기존 공용 SubmissionExportDialog로 넘긴다. 페이지마다 이 흐름을
// 따로 구현하지 않는다.

export function ProjectExportButton({ ctx, label = "전체 내보내기" }: { ctx: ProjectExportContext; label?: string }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ExportableSubmission[] | null>(null);
  const [selected, setSelected] = useState<ExportableSubmission[] | null>(null);

  const handleOpen = async () => {
    setLoading(true);
    try {
      const data = await fetchProjectExportItems(ctx);
      if (data.length === 0) {
        alert("내보낼 수 있는 제출된 자료가 없습니다.");
        return;
      }
      setItems(data);
    } catch (e) {
      console.error("전체 내보내기 자료 조회 실패:", e);
      alert("자료를 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
      >
        <Download className="h-4 w-4" />
        {loading ? "불러오는 중..." : label}
      </button>

      {items && (
        <MaterialPickerDialog
          items={items}
          onCancel={() => setItems(null)}
          onConfirm={(picked) => {
            setSelected(picked);
            setItems(null);
          }}
        />
      )}
      {selected && <SubmissionExportDialog items={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
