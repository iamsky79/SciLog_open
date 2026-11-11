export const SUBJECT_OPTIONS: { label: string; en: string }[] = [
  { label: "화학", en: "chem" },
  { label: "물리", en: "phys" },
  { label: "생물", en: "bio" },
  { label: "수학", en: "math" },
  { label: "영어", en: "eng" },
  { label: "국어", en: "kor" },
  { label: "정보", en: "info" },
  { label: "지구과학", en: "earth" },
  { label: "담임", en: "teacher" },
];

export const OTHER_SUBJECT = "기타";

export const SUBJECT_MAP: Record<string, string> = Object.fromEntries(
  SUBJECT_OPTIONS.map((option) => [option.label, option.en])
);

// subjectKo가 "기타"면 customEn(관리자가 직접 입력한 영문)을 검증해 사용한다.
export function subjectToEnglish(subjectKo: string, customEn?: string): string | null {
  if (subjectKo === OTHER_SUBJECT) {
    const trimmed = (customEn ?? "").trim().toLowerCase();
    return /^[a-z]+$/.test(trimmed) ? trimmed : null;
  }
  return SUBJECT_MAP[subjectKo] ?? null;
}
