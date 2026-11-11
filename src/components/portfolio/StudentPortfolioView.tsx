"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  ACTIVITY_ROLE_LABEL,
  ACTIVITY_ROLE_CODES,
  type PortfolioActivity,
  type PortfolioTypeKey,
  type StudentPortfolio,
} from "@/lib/portfolio/detail";
import { downloadFile } from "@/lib/submissions/download";
import { OTHER_ACTIVITY_SUBTYPE_LABEL } from "@/lib/other-activity";
import { reportDisplayFields } from "@/lib/report-fields";

// 학생 본인 화면(/portfolio)과 교사 화면(/student/[id])이 그대로 함께 쓰는 포트폴리오
// 본문 뷰. 두 화면의 핵심 내용이 달라지면 안 되므로, 역할에 따른 분기를 이 컴포넌트
// 안에 넣지 않는다 — 교사 전용 관리 정보는 각 페이지가 이 컴포넌트 "바깥"에 별도로 그린다.

const TYPE_LABEL: Record<PortfolioTypeKey, string> = { rne: "R&E", club: "동아리", individual: "창의개인연구", other: "기타 활동" };
const TYPE_BADGE_CLS: Record<PortfolioTypeKey, string> = {
  rne: "bg-sky-100 text-sky-700",
  club: "bg-violet-100 text-violet-700",
  individual: "bg-amber-100 text-amber-700",
  other: "bg-slate-200 text-slate-700",
};
/** "기타 활동"은 별도 section으로 분리해서 보여주므로(연구 프로젝트와 다른 구조) 이
 * 필터 탭에는 넣지 않는다 — R&E/동아리/창의개인연구만 전환한다. */
const TYPE_TABS: { key: "all" | Exclude<PortfolioTypeKey, "other">; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "rne", label: "R&E" },
  { key: "club", label: "동아리" },
  { key: "individual", label: "창의개인연구" },
];

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function statusView(status: string | null): { text: string; cls: string } {
  if (!status || status === "draft") return { text: "-", cls: "text-slate-400" };
  if (status === "approved") return { text: "✓ 승인완료", cls: "text-green-600 font-medium" };
  if (status === "rejected") return { text: "✗ 수정요청", cls: "text-red-500 font-medium" };
  if (status === "historical") return { text: "과거 기록", cls: "text-slate-500" };
  return { text: "⏳ 검토대기", cls: "text-amber-600 font-medium" };
}

function AttachmentInline({ attachments }: { attachments: { name: string; url: string }[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <button
          key={a.url}
          type="button"
          onClick={() => downloadFile(a.url, a.name)}
          className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-sky-600 hover:bg-sky-50"
          title={`${a.name} 다운로드`}
        >
          <Download className="h-3 w-3" />
          <span className="max-w-[160px] truncate">{a.name}</span>
        </button>
      ))}
    </div>
  );
}

/** 연구일지 한 건의 "전체 보기" 필드 목록 — export(journalPayloadFromActivity)와 라벨/순서를 동일하게 맞춘다. */
function logFullFields(log: PortfolioActivity["logs"][number]): { label: string; value: string }[] {
  return (
    [
      { label: "오늘의 목표", value: log.goal },
      { label: "오늘의 연구 활동", value: log.activityContent },
      { label: "주요 결과 및 관찰", value: log.result },
      { label: "해석 및 판단", value: log.interpretation },
      { label: "문제점 / 특이사항", value: log.conclusion },
      { label: "다음 활동과 그 이유", value: log.nextPlan },
      { label: "성과 및 소감", value: log.achievement },
      { label: "교사 피드백", value: log.teacherFeedback },
    ] as { label: string; value: string | null }[]
  ).filter((f): f is { label: string; value: string } => !!f.value);
}

/** 계획서/보고서/연구일지에 달린 교사 피드백 — 해당 프로젝트 카드 안에서, 실제 문서
 * 바로 아래에 인라인으로 보여준다(별도 전역 목록으로 모으지 않는다). 상태 배지처럼
 * 행정 처리 이력을 나열하지 않고 피드백 본문만 보여준다. */
function FeedbackBlock({ feedback }: { feedback: string }) {
  return (
    <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50 p-2">
      <p className="text-xs font-semibold text-sky-700">교사 피드백</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">&ldquo;{feedback}&rdquo;</p>
    </div>
  );
}

function ExpandToggle({ expanded, label }: { expanded: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-sky-600">
      {label}
      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    </span>
  );
}

function ActivityCard({ activity }: { activity: PortfolioActivity }) {
  const planStatus = statusView(activity.plan?.status ?? null);
  const reportStatus = statusView(activity.report?.status ?? null);
  const [planExpanded, setPlanExpanded] = useState(false);
  const [reportExpanded, setReportExpanded] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const planSections = activity.plan
    ? ([
        { label: "연구 동기 및 목적", value: activity.plan.motivation },
        { label: "연구 방법", value: activity.plan.method },
        { label: "기대 결과", value: activity.plan.expectedResult },
      ] as { label: string; value: string | null }[]).filter((s): s is { label: string; value: string } => !!s.value)
    : [];
  const reportSections = activity.report
    ? reportDisplayFields({ introduction: activity.report.introduction, conclusion: activity.report.conclusion, summary: activity.report.summary })
    : [];

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_BADGE_CLS[activity.typeKey]}`}>
            {TYPE_LABEL[activity.typeKey]}
          </span>
          <h3 className="mt-1 text-base font-semibold text-slate-900">{activity.name}</h3>
          <p className="text-xs text-slate-500">
            {activity.periodLabel} · {activity.isHistorical ? "관리교사" : "지도교사"} {activity.teacherName}
            {activity.members.length > 0 && ` · ${activity.typeKey === "individual" ? "학생" : "팀원"} ${activity.members.join(", ")}`}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">연구계획서</p>
            <span className={`text-xs ${planStatus.cls}`}>{planStatus.text}</span>
          </div>
          {activity.plan && activity.plan.status !== "draft" ? (
            <>
              <p className="mt-1 truncate text-sm text-slate-800">{activity.plan.title || "(제목 없음)"}</p>
              <p className="text-xs text-slate-400">제출일 {fmtDate(activity.plan.submittedAt)}</p>
              <AttachmentInline attachments={activity.plan.attachments} />
              {activity.plan.feedback && <FeedbackBlock feedback={activity.plan.feedback} />}
              {planSections.length > 0 && (
                <>
                  <button type="button" onClick={() => setPlanExpanded((v) => !v)} className="mt-2">
                    <ExpandToggle expanded={planExpanded} label="전체보기" />
                  </button>
                  {planExpanded && (
                    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                      {planSections.map((s) => (
                        <div key={s.label}>
                          <p className="text-xs font-semibold text-slate-500">{s.label}</p>
                          <p className="whitespace-pre-wrap text-sm text-slate-700">{s.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">미제출</p>
          )}
        </div>
        <div className="rounded-lg border border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">결과보고서</p>
            <span className={`text-xs ${reportStatus.cls}`}>{reportStatus.text}</span>
          </div>
          {activity.report && activity.report.status !== "draft" ? (
            <>
              <p className="mt-1 truncate text-sm text-slate-800">{activity.report.title || "(제목 없음)"}</p>
              <p className="text-xs text-slate-400">제출일 {fmtDate(activity.report.submittedAt)}</p>
              <AttachmentInline attachments={activity.report.attachments} />
              {activity.report.feedback && <FeedbackBlock feedback={activity.report.feedback} />}
              {reportSections.length > 0 && (
                <>
                  <button type="button" onClick={() => setReportExpanded((v) => !v)} className="mt-2">
                    <ExpandToggle expanded={reportExpanded} label="전체보기" />
                  </button>
                  {reportExpanded && (
                    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                      {reportSections.map((s) => (
                        <div key={s.label}>
                          <p className="text-xs font-semibold text-slate-500">{s.label}</p>
                          <p className="whitespace-pre-wrap text-sm text-slate-700">{s.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">미제출</p>
          )}
        </div>
      </div>

      {activity.personalRecord && (
        <div className="rounded-lg border border-slate-100 p-3">
          <p className="text-xs font-semibold text-slate-500">나의 기록</p>
          <div className="mt-1 space-y-1.5">
            {activity.personalRecord.motivation && (
              <p className="text-sm text-slate-700">
                <span className="text-slate-500">연구 동기:</span> {activity.personalRecord.motivation}
              </p>
            )}
            {activity.personalRecord.myRole && (
              <p className="text-sm text-slate-700">
                <span className="text-slate-500">나의 역할:</span> {activity.personalRecord.myRole}
              </p>
            )}
            {activity.personalRecord.lessonsLearned && (
              <p className="text-sm text-slate-700">
                <span className="text-slate-500">배운 점 / 느낀 점:</span> {activity.personalRecord.lessonsLearned}
              </p>
            )}
            {activity.personalRecord.challenges && (
              <p className="text-sm text-slate-700">
                <span className="text-slate-500">어려웠던 점과 해결 과정:</span> {activity.personalRecord.challenges}
              </p>
            )}
          </div>
        </div>
      )}

      {activity.logs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">연구일지 {activity.logs.length}건</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {[...activity.logs]
              .sort((a, b) => (b.logDate ?? "").localeCompare(a.logDate ?? ""))
              .map((log) => {
                const sv = statusView(log.status);
                const isExpanded = expandedLogId === log.id;
                // plan/report와 동일한 기준(status !== "draft") — draft 연구일지는
                // 날짜/제목/상태/역할/첨부파일 등 기존에 허용되던 정보만 유지하고
                // "전체보기"와 본문 전문은 노출하지 않는다.
                const fields = log.status !== "draft" ? logFullFields(log) : [];
                return (
                  <li key={log.id} className="px-3 py-2">
                    <button type="button" className="w-full text-left" onClick={() => setExpandedLogId(isExpanded ? null : log.id)}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-slate-800">
                          {log.logDate ? `${fmtDate(log.logDate)} · ` : ""}{log.title || (log.logDate ? "(제목 없음)" : "날짜 미상")}
                        </p>
                        <span className={`text-xs ${sv.cls}`}>{sv.text}</span>
                      </div>
                      {log.myRoles.length > 0 && (
                        <p className="mt-0.5 text-xs text-slate-500">{log.myRoles.map((r) => ACTIVITY_ROLE_LABEL[r]).join(" · ")}</p>
                      )}
                      {fields.length > 0 && <ExpandToggle expanded={isExpanded} label="전체보기" />}
                    </button>
                    <AttachmentInline attachments={log.attachments} />
                    {isExpanded && fields.length > 0 && (
                      <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3" onClick={(e) => e.stopPropagation()}>
                        {fields.map((f) => (
                          <div key={f.label}>
                            <p className="text-xs font-semibold text-slate-500">{f.label}</p>
                            <p className="whitespace-pre-wrap text-sm text-slate-700">{f.value}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** 기타 활동 한 건 — 목록에서는 [유형] 제목만 보여주고, 날짜/주최기관/활동 내용/결과 및
 * 성과는 클릭하면 펼쳐진다(연구계획서/결과보고서 "전체보기"와 같은 패턴). */
function OtherActivityRow({ activity }: { activity: PortfolioActivity }) {
  const [expanded, setExpanded] = useState(false);
  const other = activity.otherActivity;
  if (!other) return null;
  const metaLine = [fmtDate(activity.otherActivityDate) !== "-" ? fmtDate(activity.otherActivityDate) : null, other.organizer].filter(Boolean).join(" · ");
  const hasDetail = !!(metaLine || other.content || other.result);

  return (
    <li className="px-3 py-2">
      <button type="button" className="w-full text-left" onClick={() => hasDetail && setExpanded((v) => !v)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-800">
            <span className="mr-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
              {OTHER_ACTIVITY_SUBTYPE_LABEL[other.subtype]}
            </span>
            {activity.name}
          </p>
          {hasDetail && <ExpandToggle expanded={expanded} label="자세히" />}
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3" onClick={(e) => e.stopPropagation()}>
          {metaLine && <p className="text-xs text-slate-500">{metaLine}</p>}
          {other.content && (
            <div>
              <p className="text-xs font-semibold text-slate-500">활동 내용</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{other.content}</p>
            </div>
          )}
          {other.result && (
            <div>
              <p className="text-xs font-semibold text-slate-500">결과 및 성과</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{other.result}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** 기타 활동 section — 연구 프로젝트와 섞지 않고 학년도 오름차순 → 학기 → 날짜 →
 * 활동 제목 순으로 그룹핑해서 보여준다("2023학년도 / 1학기 / [교내대회] ..." 형태). */
function OtherActivitiesSection({ activities }: { activities: PortfolioActivity[] }) {
  const groups = useMemo(() => {
    const sorted = [...activities].sort((a, b) => {
      const yearA = a.schoolYear ? parseInt(a.schoolYear, 10) : Number.MAX_SAFE_INTEGER;
      const yearB = b.schoolYear ? parseInt(b.schoolYear, 10) : Number.MAX_SAFE_INTEGER;
      if (yearA !== yearB) return yearA - yearB;
      if (a.periodSort !== b.periodSort) return a.periodSort - b.periodSort;
      const dateA = a.otherActivityDate ?? "";
      const dateB = b.otherActivityDate ?? "";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return a.name.localeCompare(b.name, "ko");
    });
    const result: { year: string; semester: string; items: PortfolioActivity[] }[] = [];
    for (const a of sorted) {
      const year = a.schoolYear ? `${a.schoolYear}학년도` : "학년도 미정";
      const semester = a.otherSemesterLabel ?? "학기 구분 없음";
      const last = result[result.length - 1];
      if (last && last.year === year && last.semester === semester) last.items.push(a);
      else result.push({ year, semester, items: [a] });
    }
    return result;
  }, [activities]);

  if (activities.length === 0) return <p className="text-sm text-slate-400">등록된 기타 활동이 없습니다.</p>;

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => (
        <div key={`${g.year}-${g.semester}-${gi}`}>
          <p className="text-sm font-semibold text-slate-800">{g.year}</p>
          <p className="mb-1.5 text-xs text-slate-500">{g.semester}</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {g.items.map((a) => (
              <OtherActivityRow key={a.key} activity={a} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function StudentPortfolioView({
  portfolio,
  academicYear,
  onAcademicYearChange,
}: {
  portfolio: StudentPortfolio;
  academicYear: string | null;
  onAcademicYearChange: (year: string | null) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<"all" | Exclude<PortfolioTypeKey, "other">>("all");

  // "기타 활동"은 연구 프로젝트(plan/report/logs 구조)와 완전히 다른 데이터라 같은
  // 목록/필터에 섞지 않고 별도 section(OtherActivitiesSection)으로 분리한다.
  const researchActivities = useMemo(() => portfolio.activities.filter((a) => a.typeKey !== "other"), [portfolio.activities]);
  const otherActivities = useMemo(() => portfolio.activities.filter((a) => a.typeKey === "other"), [portfolio.activities]);

  const visibleActivities = useMemo(
    () => (typeFilter === "all" ? researchActivities : researchActivities.filter((a) => a.typeKey === typeFilter)),
    [researchActivities, typeFilter]
  );

  const roleEntries = ACTIVITY_ROLE_CODES.map((code) => ({ code, label: ACTIVITY_ROLE_LABEL[code], count: portfolio.roleCounts[code] ?? 0 })).filter(
    (r) => r.count > 0
  );

  return (
    <div className="space-y-5">
      {/* 개요 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">개요</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {portfolio.student.username && `아이디: ${portfolio.student.username} · `}
            {portfolio.student.grade != null && `${portfolio.student.grade}학년`}
            {portfolio.student.class && ` ${portfolio.student.class}반`}
            {portfolio.student.number != null && ` ${portfolio.student.number}번`}
          </p>
        </div>
        <select
          value={academicYear ?? "all"}
          onChange={(e) => onAcademicYearChange(e.target.value === "all" ? null : e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="all">전체 학년도</option>
          {portfolio.yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}학년도
            </option>
          ))}
        </select>
      </div>

      <Card className="!p-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
          <span>
            참여 연구 <b className="text-slate-900">{portfolio.summary.projectCount}</b>건
          </span>
          <span className="text-slate-300">|</span>
          <span>
            연구일지 <b className="text-slate-900">{portfolio.summary.noteCount}</b>건
          </span>
          <span className="text-slate-300">|</span>
          <span>
            승인 제출물 <b className="text-slate-900">{portfolio.summary.approvedSubmissionCount}</b>건
          </span>
          <span className="text-slate-300">|</span>
          <span>
            수상성과 <b className="text-slate-900">{portfolio.summary.awardCount}</b>건
          </span>
        </p>
      </Card>

      {/* 주요 연구 경험 — 횟수는 활동 사실일 뿐 역량 평가가 아니다. */}
      {roleEntries.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">주요 연구 경험</h2>
          <div className="flex flex-wrap gap-2">
            {roleEntries.map((r) => (
              <span key={r.code} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                {r.label} <b className="text-slate-800">{r.count}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 연구/활동 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">연구/활동</h2>
          <span className="text-sm text-slate-500">{visibleActivities.length}건</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTypeFilter(tab.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === tab.key ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {visibleActivities.length === 0 ? (
          <Card className="text-sm text-slate-400">아직 기록된 활동이 없습니다.</Card>
        ) : (
          <div className="space-y-3">
            {visibleActivities.map((a) => (
              <ActivityCard key={a.key} activity={a} />
            ))}
          </div>
        )}
      </div>

      {/* 기타 활동 — 연구 프로젝트와 구조가 달라 별도 section으로 분리(같은 그리드에 섞지 않음). */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">기타 활동</h2>
          <span className="text-sm text-slate-500">{otherActivities.length}건</span>
        </div>
        <OtherActivitiesSection activities={otherActivities} />
      </div>

      {/* 수상성과 */}
      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">수상성과</h2>
        {portfolio.awards.length === 0 ? (
          <p className="text-sm text-slate-400">등록된 수상 실적이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {portfolio.awards.map((a) => (
              <li key={a.id} className="space-y-0.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{a.award_name}</span>
                  {a.grade && <Badge tone="gold">{a.grade}</Badge>}
                </div>
                <p className="text-xs text-slate-500">
                  {a.competition}
                  {a.organizer && ` · ${a.organizer}`}
                  {a.award_date && ` · ${fmtDate(a.award_date)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
