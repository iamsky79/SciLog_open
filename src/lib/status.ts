import type { Tone } from "@/components/ui/Badge";
import type { ReviewStatus } from "@/lib/database.types";

// ─── Legacy exports (used by ActivityLogSection, lab, dashboard, log pages) ──

export const statusLabel: Record<ReviewStatus, string> = {
  approved: "승인 완료",
  rejected: "수정 요청",
  pending: "검토 대기",
  submitted: "검토 대기",
  draft: "임시저장",
  historical: "과거 기록",
};

export const statusTone: Record<ReviewStatus, Tone> = {
  approved: "green",
  rejected: "red",
  pending: "gold",
  submitted: "gold",
  draft: "gray",
  historical: "gray",
};

export const REVIEW_STATUSES: ReviewStatus[] = ["pending", "submitted", "approved", "rejected"];

// ─── Unified status display (all plan/report/activity statuses) ───────────────

export const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  submitted: "검토 대기",
  teacher_approved: "승인 완료",
  approved: "승인 완료",
  rejected: "수정 요청",
  pending: "검토 대기",
  historical: "과거 기록",
};

export const STATUS_COLOR: Record<string, "gray" | "yellow" | "green" | "red"> = {
  draft: "gray",
  submitted: "yellow",
  teacher_approved: "green",
  approved: "green",
  rejected: "red",
  pending: "yellow",
  historical: "gray",
};
