"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertCircle, Award, BookOpenText, CheckCircle2, FlaskConical, Hourglass, Lightbulb, PenLine, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { AnnualResearchJourney } from "@/components/dashboard/AnnualResearchJourney";
import { UpcomingSchedules } from "@/components/dashboard/UpcomingSchedules";
import { ProjectProgressList } from "@/components/dashboard/ProjectProgressList";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { StatCard } from "@/components/dashboard/StatCard";
import { projectsByStage, type ProjectProgress } from "@/lib/dashboard/journey";
import { studentNextActions, submissionTotals } from "@/lib/dashboard/summary";
import type { ScheduleView } from "@/lib/dashboard/schedule";
import { countHead, fetchProjectProgress, fetchRecentFeed, fetchStudentScheduleViews, loadStudentProjects, type FeedItem } from "@/lib/dashboard/data";

const ACTION_STYLE = { revision: "bg-red-50 text-red-700", due: "bg-orange-50 text-orange-700", draft: "bg-slate-100 text-slate-600" } as const;

/** 학생 대시보드 — "내가 지금 무엇을 해야 하는가"를 중심으로, 내 연구와 실제 제출 일정을 보여준다. */
export default function StudentDashboard() {
  const { userId, profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectProgress[]>([]);
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [otherCount, setOtherCount] = useState(0);
  const [awardCount, setAwardCount] = useState(0);

  useEffect(() => {
    if (authLoading || !userId) return;
    let cancelled = false;
    (async () => {
      const refs = await loadStudentProjects(userId);
      const [progress, scheduleViews, feedItems, others, awards] = await Promise.all([
        fetchProjectProgress(refs, { authorId: userId }),
        fetchStudentScheduleViews(userId),
        fetchRecentFeed({ refs, authorId: userId }),
        countHead("other_activities", userId),
        countHead("awards", userId),
      ]);
      if (cancelled) return;
      setProjects(progress);
      setSchedules(scheduleViews);
      setFeed(feedItems);
      setOtherCount(others);
      setAwardCount(awards);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  const byStage = useMemo(() => projectsByStage(projects), [projects]);
  const totals = useMemo(() => submissionTotals(projects), [projects]);
  const actions = useMemo(() => studentNextActions(projects, schedules), [projects, schedules]);
  const countOf = (kind: ProjectProgress["kind"]) => projects.filter((p) => p.kind === kind).length;

  return (
    <div className="space-y-6">
      <DashboardHeader profile={profile} subtitle="오늘도 연구 활동을 기록해보세요." />

      <AnnualResearchJourney byStage={byStage} schedules={schedules} ownerLabel="내 연구" loading={loading} />

      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="R&E" value={`${countOf("rne")}건`} icon={FlaskConical} tone="sky" href="/rne" />
          <StatCard label="동아리" value={`${countOf("club")}개`} icon={Users} tone="violet" href="/club" />
          <StatCard label="창의개인연구" value={`${countOf("individual")}건`} icon={Lightbulb} tone="amber" href="/individual" />
          <StatCard label="기타 활동" value={`${otherCount}건`} icon={Activity} tone="emerald" href="/other" />
          <StatCard label="수상 성과" value={`${awardCount}건`} icon={Award} tone="rose" href="/awards" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="작성 중" value={`${totals.draft}건`} icon={PenLine} tone="slate" hint="임시저장한 계획서·보고서" />
          <StatCard label="검토 중" value={`${totals.reviewing}건`} icon={Hourglass} tone="amber" hint="계획서·보고서·연구일지" />
          <StatCard label="수정 요청" value={`${totals.revision}건`} icon={AlertCircle} tone="red" hint="계획서·보고서·연구일지" />
          <StatCard label="승인 완료" value={`${totals.approved}건`} icon={CheckCircle2} tone="emerald" hint="계획서·보고서·연구일지" />
          <StatCard label="연구일지" value={`${totals.logTotal}건`} icon={BookOpenText} tone="sky" hint="내가 작성한 일지" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UpcomingSchedules items={schedules} loading={loading} />
        <Card>
          <h2 className="text-base font-semibold text-slate-900">다음 할 일</h2>
          {loading ? (
            <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
          ) : actions.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
              <p className="text-sm font-medium text-slate-600">지금 처리할 일이 없어요.</p>
              <p className="mt-1 text-xs text-slate-400">수정 요청, 임시저장, 마감이 가까운 제출이 생기면 이곳에 표시됩니다.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {actions.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-sky-200 hover:bg-sky-50/40">
                    <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", ACTION_STYLE[a.kind])}>{a.label}</span>
                    <span className="truncate text-sm text-slate-700">{a.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ProjectProgressList title="내 연구 현황" projects={projects} mode="student" loading={loading} />
      <RecentActivity feed={feed} loading={loading} />
    </div>
  );
}
