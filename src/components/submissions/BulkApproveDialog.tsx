"use client";

/** "검토 필요"에서 선택한 제출물을 한 번에 승인하기 전 확인 모달 — 즉시 승인하지 않고 반드시 한 번 더 묻는다. */
export function BulkApproveDialog({
  open,
  count,
  submitting,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">선택한 제출물을 승인할까요?</h2>
        <p className="text-sm text-slate-600">
          선택한 {count}건의 제출물을 승인합니다. 승인 후 학생에게 승인 완료 상태로 표시됩니다.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onConfirm()}
            disabled={submitting}
            className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "처리 중..." : `${count}건 승인`}
          </button>
        </div>
      </div>
    </div>
  );
}
