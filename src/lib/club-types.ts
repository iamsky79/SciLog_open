export const CLUB_SUBTYPES = [
  { value: "교내", label: "교내 동아리" },
  { value: "교외", label: "교외 동아리" },
] as const;

export type ClubSubtype = (typeof CLUB_SUBTYPES)[number]["value"];
