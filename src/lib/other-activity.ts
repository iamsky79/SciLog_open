import type { OtherActivitySubtype, OtherActivitySemester } from "@/lib/database.types";

// 기타 활동(생기부의 교내외 대회/수행평가/발명 활동 등) 유형·학기 표시를 한 곳에서
// 관리한다 — 폼/목록/상세/포트폴리오 export가 전부 이 상수만 참조해 라벨이 서로
// 어긋나지 않게 한다. DB의 other_activity_subtype enum 값 자체는 바꾸지 않고
// (기존 레코드 보존), 화면에 보여줄 라벨만 여기서 통일한다.
export const OTHER_ACTIVITY_SUBTYPE_OPTIONS: { value: OtherActivitySubtype; label: string }[] = [
  { value: "external_competition", label: "외부대회" },
  { value: "internal_competition", label: "교내대회" },
  { value: "performance", label: "수행평가" },
  { value: "invention", label: "발명대회" },
  { value: "idea", label: "기타" },
];

export const OTHER_ACTIVITY_SUBTYPE_LABEL: Record<OtherActivitySubtype, string> = Object.fromEntries(
  OTHER_ACTIVITY_SUBTYPE_OPTIONS.map((o) => [o.value, o.label])
) as Record<OtherActivitySubtype, string>;

/** 폼의 학기 select용 — ""는 "학기 구분 없음"(DB에는 semester=null로 저장). */
export const OTHER_ACTIVITY_SEMESTER_FORM_OPTIONS: { value: OtherActivitySemester | ""; label: string }[] = [
  { value: "", label: "학기 구분 없음" },
  { value: "1", label: "1학기" },
  { value: "2", label: "2학기" },
];

export const OTHER_ACTIVITY_SEMESTER_LABEL: Record<OtherActivitySemester, string> = {
  "1": "1학기",
  "2": "2학기",
};

/** 기타 활동 정렬 전용 학기 우선순위 — 1학기 → 2학기 → 학기 구분 없음(null) 순.
 * 학생 기타 활동 목록/학생 포트폴리오 화면/PDF·DOCX 기타 활동 section이 전부 이
 * 함수 하나로 학기 정렬 기준을 통일한다. */
export function otherActivitySemesterSortPriority(semester: OtherActivitySemester | null): number {
  if (semester === "1") return 1;
  if (semester === "2") return 2;
  return 3;
}
