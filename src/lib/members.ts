/** 팀원 이름 목록을 상단 breadcrumb에 넣기 좋게 요약한다. */
export function summarizeMemberNames(names: (string | null | undefined)[], max = 3): { summary: string; full: string } {
  const cleaned = names.filter((n): n is string => !!n && n.trim().length > 0);
  const full = cleaned.join(", ");
  if (cleaned.length === 0) return { summary: "", full: "" };
  if (cleaned.length <= max) return { summary: cleaned.join(" · "), full };
  return { summary: `${cleaned.slice(0, max).join(" · ")} 외 ${cleaned.length - max}명`, full };
}
