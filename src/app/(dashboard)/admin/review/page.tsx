import { redirect } from "next/navigation";

// 관리자의 "전체 검토"는 개념 자체를 없앴다 — 관리자의 핵심 업무는 submission을
// 직접 승인하는 게 아니라 제출 현황을 관리하는 것이라, 예전 이 경로의 북마크는
// 새 "제출 관리 > 제출 현황"으로 보낸다(교사용 "제출물 관리"인 /archive와는
// 다른 화면 — 관리자 전용 집계 뷰).
export default function AdminReviewRedirect() {
  redirect("/admin/submissions");
}
