/**
 * 팀(R&E/동아리) 프로젝트 기간 표기 — 원본에 없는 학기를 만들지 않는다.
 *   학년도+학년+학기 → "2023학년도 (1학년 2학기)"
 *   학년도+학년       → "2023학년도 (1학년)"
 *   학년도만          → "2023학년도"
 * semester가 비어 있다고 "1학기"로 대체하지 않는다(DB에 가짜 학기를 넣지도 않는다).
 */
export function teamPeriodLabel(schoolYear: string | null, semester: string | null, gradeNum: number | null): string | null {
  if (!schoolYear) return null;
  const parts = [gradeNum != null ? `${gradeNum}학년` : null, semester ? `${semester}학기` : null].filter((s): s is string => !!s);
  return parts.length > 0 ? `${schoolYear}학년도 (${parts.join(" ")})` : `${schoolYear}학년도`;
}
