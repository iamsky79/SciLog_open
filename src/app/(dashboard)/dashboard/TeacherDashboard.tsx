"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertCircle, Award, CheckCircle2, ClipboardCheck, FlaskConical, Layers, Lightbulb, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { AnnualResearchJourney } from "@/components/dashboard/AnnualResearchJourney";
import { UpcomingSchedules } from "@/components/dashboard/UpcomingSchedules";
import { ProjectProgressList } from "@/components/dashboard/ProjectProgressList";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { StatCard } from "@/components/dashboard/StatCard";
import { PROJECT_KIND_LABEL, projectsByStage, type ProjectProgress } from "@/lib/dashboard/journey";
import { reviewQueue, submissionTotals } from "@/lib/dashboard/summary";
import type { ScheduleView } from "@/lib/dashboard/schedule";
import { countHead, fetchProjectProgress, fetchRecentFeed, fetchTeacherScheduleViews, loadTeacherProjects, type FeedItem, type ProjectRef } from "@/lib/dashboard/data";
import { fetchPendingReviewCount } from "@/lib/review/pendingCount";
import { onReviewChanged } from "@/lib/review/actions";

/** 교사 대시보드 — "무엇을 검토해야 하고 어떤 연구가 진행 중인가". scope "all"은 관리자 전체 대시보드가 같이 쓴다. */
export default function TeacherDashboard({ scope }: { scope: "mine" | "all" }) {
  const { userId, profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectProgress[]>([]);
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [otherCount, setOtherCount] = useState(0);
  const [awardCount, setAwardCount] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);

  const isAdmin = profile?.is_admin === true;

  // 승인/수정 요청 직후(다른 화면에서 일어난 변경 포함) 검토 필요 숫자가 사이드바 배지와 같이 갱신되도록 같은 이벤트를 듣는다.
  useEffect(() => onReviewChanged(() => setReloadTick((n) => n + 1)), []);

  useEffect(() => {
    if (authLoading || !userId || !profile) return;
    let cancelled = false;
    (async () => {
      const refs: ProjectRef[] = await loadTeacherProjects(userId, scope);
      const [progress, scheduleViews, feedItems, pending, others, awards] = await Promise.all([
        fetchProjectProgress(refs),
        fetchTeacherScheduleViews(refs, scope),
        fetchRecentFeed({ refs, unscoped: scope === "all" }),
        // 검토 필요는 사이드바 배지와 같은 함수 — 담당 연구(관리자는 전체)에서 내가 실제로 처리할 수 있는 건만 센다.
        fetchPendingReviewCount({ userId, isAdmin }),
        countHead("other_activities"),
        countHead("awards"),
      ]);
      if (cancelled) return;
      setProjects(progress);
      setSchedules(scheduleViews);
      setFeed(feedItems);
      setReviewCount(pending);
      setOtherCount(others);
      setAwardCount(awards);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, profile, scope, isAdmin, reloadTick]);

  const byStage = useMemo(() => projectsByStage(projects), [projects]);
  const totals = useMemo(() => submissionTotals(projects), [projects]);
  const queue = useMemo(() => reviewQueue(projects), [projects]);
  const countOf = (kind: ProjectProgress["kind"]) => projects.filter((p) => p.kind === kind).length;
  const ownerLabel = scope === "all" ? "전체 연구" : "담당 연구";

  return (
    <div className="space-y-6">
      <DashboardHeader profile={profile} subtitle={scope === "all" ? "전체 연구의 진행 상황을 확인하세요." : "검토가 필요한 제출물과 담당 연구를 한눈에 확인하세요."} />

      <AnnualResearchJourney byStage={byStage} schedules={schedules} ownerLabel={ownerLabel} loading={loading} />

      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="R&E 현황" value={`${countOf("rne")}건`} icon={FlaskConical} tone="sky" href="/rne" />
          <StatCard label="동아리 현황" value={`${countOf("club")}개`} icon={Users} tone="violet" href="/club" />
          <StatCard label="창의개인연구" value={`${countOf("individual")}건`} icon={Lightbulb} tone="amber" href="/individual" />
          <StatCard label="기타 활동" value={`${otherCount}건`} icon={Activity} tone="emerald" href="/other" />
          <StatCard label="수상 성과" value={`${awardCount}건`} icon={Award} tone="rose" href="/awards" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={ownerLabel} value={`${projects.length}개`} icon={Layers} tone="slate" hint="R&E·동아리·창의개인연구" />
          <StatCard label="검토 필요" value={`${reviewCount}건`} icon={ClipboardCheck} tone="amber" href="/archive?view=review" hint="내가 처리할 수 있는 제출물" />
          <StatCard label="수정 요청 중" value={`${totals.revision}건`} icon={AlertCircle} tone="red" href="/archive?view=revision" hint="학생 수정을 기다리는 제출물" />
          <StatCard label="승인 완료" value={`${totals.approved}건`} icon={CheckCircle2} tone="emerald" hint={`${ownerLabel}의 제출물`} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UpcomingSchedules items={schedules} loading={loading} />
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">검토 필요</h2>
            <Link href="/archive?view=review" className="text-xs font-medium text-sky-600 hover:text-sky-800">
              제출물 관리에서 보기
            </Link>
          </div>
          {loading ? (
            <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
          ) : queue.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
              <p className="text-sm font-medium text-slate-600">지금 검토할 제출물이 없어요.</p>
              <p className="mt-1 text-xs text-slate-400">학생이 제출하면 이곳에 표시됩니다.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {queue.slice(0, 6).map(({ project, needs, revision }) => (
                <li key={`${project.kind}-${project.id}`}>
                  <Link href="/archive?view=review" className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-sky-200 hover:bg-sky-50/40">
                    <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">검토 {needs}건</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{project.name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{PROJECT_KIND_LABEL[project.kind]}</span>
                    {revision > 0 && <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">수정 요청 {revision}</span>}
                  </Link>
                </li>
              ))}
              {queue.length > 6 && <li className="px-1 text-xs text-slate-400">그 외 {queue.length - 6}개 연구에도 검토할 제출물이 있어요.</li>}
            </ul>
          )}
        </Card>
      </div>

      <ProjectProgressList title={scope === "all" ? "전체 연구 진행현황" : "담당 연구 진행현황"} projects={projects} mode="teacher" loading={loading} />
      <RecentActivity feed={feed} loading={loading} />
    </div>
  );
}
