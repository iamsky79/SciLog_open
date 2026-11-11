// 기수(username 앞자리, 예: "22김선아" → 22) → 입학년도. 22기=2026년 입학 기준.
export function admissionYearFromUsername(username: string | null): number | null {
  if (!username) return null;
  const m = username.match(/^(\d+)/);
  if (!m) return null;
  return Number(m[1]) + 2004;
}
