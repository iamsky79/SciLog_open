"use client";

import { Badge } from "@/components/ui/Badge";
import type { ReviewPhase } from "@/lib/review/actions";

interface ReviewActionButtonsProps {
  phase: ReviewPhase;
  onApprove: () => void;
  onRequestRevision: () => void;
  busy?: boolean;
  size?: "sm" | "xs";
}

/**
 * 검토 Inbox와 팀/개인 페이지가 공유하는 승인/수정요청 버튼+상태 배지.
 * 같은 phase 계산(deriveReviewPhase)과 같은 mutation(approveSubmission/requestRevision)을
 * 재사용하는 화면이라면 항상 이 컴포넌트로 동일하게 보이게 한다.
 */
export function ReviewActionButtons({ phase, onApprove, onRequestRevision, busy, size = "sm" }: ReviewActionButtonsProps) {
  const pad = size === "xs" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";

  if (phase === "draft") return null;
  if (phase === "approved") return <Badge tone="green">승인 완료</Badge>;
  if (phase === "revision_requested") return <Badge tone="red">수정 요청</Badge>;

  return (
    <div className="flex items-center gap-2">
      {phase === "resubmitted" && <Badge tone="gold">재검토 필요</Badge>}
      <button
        type="button"
        onClick={onRequestRevision}
        disabled={busy}
        className={`rounded-lg border border-red-300 font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 ${pad}`}
      >
        수정 요청
      </button>
      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className={`rounded-lg bg-sky-500 font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 ${pad}`}
      >
        {busy ? "처리 중..." : "승인"}
      </button>
    </div>
  );
}
