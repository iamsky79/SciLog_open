"use client";

/** 승인 완료 제출물의 "승인 취소" 확인 모달 — 실수로 되돌리지 않도록 한 번 더 묻는다. */
export function UndoApprovalDialog({
  open,
  submitting,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">승인을 취소할까요?</h2>
        <p className="text-sm text-slate-600">승인을 취소하고 학생이 다시 수정할 수 있는 상태로 되돌립니다. 연구일지는 검토 대기 상태로 돌아갑니다.</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={() => onConfirm()}
            disabled={submitting}
            className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "처리 중..." : "승인 취소"}
          </button>
        </div>
      </div>
    </div>
  );
}
