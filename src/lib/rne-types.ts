export const RNE_SUBTYPES = [
  { value: "basic", label: "기초 R&E" },
  { value: "gyeonggi", label: "경기도 R&E" },
  { value: "science_fair", label: "과학 전람회" },
  { value: "creative_foundation", label: "창의재단 R&E" },
] as const;

export type RneSubtype = (typeof RNE_SUBTYPES)[number]["value"];

/** 세부 유형(subtype)이 없거나 위 4개에 해당하지 않는 R&E 팀 — 유형 섹션에는 들어가지 않으므로 일반 "R&E" 섹션에 모은다. */
export function isGenericRneTeam(team: { subtype: string | null }): boolean {
  return !RNE_SUBTYPES.some(({ value }) => value === team.subtype);
}
