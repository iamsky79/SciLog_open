import { createClient } from "@/lib/supabase";

/**
 * 사이드바 "검토" 빨간 배지 숫자 — ReviewClient(왼쪽 검토 Inbox)가 실제로 나열하는
 * 4개 소스(개인 계획서/팀 계획서/연구일지/결과보고서)를 동일한 담당 교사/관리자 범위로
 * 집계한다. Sidebar가 자체적으로 다른 쿼리를 만들지 않고 이 함수 하나만 쓰게 해서
 * Inbox 목록 건수와 배지 숫자가 항상 같은 소스에서 나오도록 한다.
 */
export async function fetchPendingReviewCount(params: { userId: string; isAdmin: boolean }): Promise<number> {
  const { userId, isAdmin } = params;
  const supabase = createClient();

  let myTeamIds: string[] = [];
  let myIndivIds: string[] = [];
  if (!isAdmin) {
    const [{ data: teams }, { data: indiv }] = await Promise.all([
      supabase.from("teams").select("id").eq("teacher_id", userId),
      supabase.from("individual_research").select("id").eq("teacher_id", userId),
    ]);
    myTeamIds = ((teams ?? []) as { id: string }[]).map((t) => t.id);
    myIndivIds = ((indiv ?? []) as { id: string }[]).map((r) => r.id);
    if (myTeamIds.length === 0 && myIndivIds.length === 0) return 0;
  }

  const indivPlansCount = async () => {
    let q = supabase.from("individual_research").select("id", { count: "exact", head: true }).eq("plan_status", "submitted");
    if (!isAdmin) q = q.eq("teacher_id", userId);
    const { count } = await q;
    return count ?? 0;
  };

  const teamPlansCount = async () => {
    if (isAdmin) {
      const { count } = await supabase.from("research_plans").select("id", { count: "exact", head: true }).not("team_id", "is", null).eq("status", "submitted");
      return count ?? 0;
    }
    if (myTeamIds.length === 0) return 0;
    const { count } = await supabase.from("research_plans").select("id", { count: "exact", head: true }).in("team_id", myTeamIds).eq("status", "submitted");
    return count ?? 0;
  };

  const logsCount = async () => {
    // activity_logs.status는 "검토 대기"를 DB상 'pending'으로 저장한다(레거시 'submitted' 값도 방어적으로 함께 센다).
    if (isAdmin) {
      const { count } = await supabase.from("activity_logs").select("id", { count: "exact", head: true }).in("status", ["pending", "submitted"]);
      return count ?? 0;
    }
    if (myTeamIds.length === 0 && myIndivIds.length === 0) return 0;
    const parts: string[] = [];
    if (myTeamIds.length > 0) parts.push(`and(entity_type.eq.team,entity_id.in.(${myTeamIds.join(",")}))`);
    if (myIndivIds.length > 0) parts.push(`and(entity_type.eq.individual,entity_id.in.(${myIndivIds.join(",")}))`);
    const { count } = await supabase
      .from("activity_logs")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "submitted"])
      .or(parts.join(","));
    return count ?? 0;
  };

  const reportsCount = async () => {
    if (isAdmin) {
      const { count } = await supabase.from("research_reports").select("id", { count: "exact", head: true }).eq("status", "submitted");
      return count ?? 0;
    }
    let total = 0;
    if (myTeamIds.length > 0) {
      const { count } = await supabase.from("research_reports").select("id", { count: "exact", head: true }).in("team_id", myTeamIds).eq("status", "submitted");
      total += count ?? 0;
    }
    if (myIndivIds.length > 0) {
      const { count } = await supabase
        .from("research_reports")
        .select("id", { count: "exact", head: true })
        .eq("entity_type", "individual")
        .in("entity_id", myIndivIds)
        .eq("status", "submitted");
      total += count ?? 0;
    }
    return total;
  };

  const [c1, c2, c3, c4] = await Promise.all([indivPlansCount(), teamPlansCount(), logsCount(), reportsCount()]);
  return c1 + c2 + c3 + c4;
}
