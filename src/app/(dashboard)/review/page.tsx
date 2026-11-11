import { redirect } from "next/navigation";

// "검토"와 "제출물 보관함"이 "제출물 관리" 하나로 통합됐다 — 기존 북마크/링크가
// 깨지지 않도록 예전 검토 화면이 보여주던 것과 같은 범위(view=review)로 보낸다.
export default function ReviewRedirect() {
  redirect("/archive?view=review");
}
