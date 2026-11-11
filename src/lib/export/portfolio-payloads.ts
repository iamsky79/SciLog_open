import type { PortfolioActivity, PortfolioLog } from "@/lib/portfolio/detail";
import { isImageUrl } from "./common";
import type { EntityKind, JournalExportPayload, PlanExportPayload, ReportExportPayload } from "./types";

// 포트폴리오(학생/교사 공용 per-student export)가 "선택 제출물 통합 PDF"와 완전히
// 같은 render-plan.ts/render-report.ts/render-journal.ts를 그대로 재사용하기 위한
// 어댑터. 새 쿼리를 만들지 않고 getStudentPortfolio()가 이미 채워 둔
// PortfolioActivity 필드만으로 기존 payload 타입을 구성한다 — 새 renderer는 만들지 않는다.

function entityKindOf(a: PortfolioActivity): EntityKind {
  // hasResearchStructure(a)(typeKey !== "other")인 활동에서만 호출된다.
  return a.typeKey as EntityKind;
}

export function planPayloadFromActivity(a: PortfolioActivity, generatedAt: string): PlanExportPayload | null {
  if (!a.plan) return null;
  // 화면(StudentPortfolioView)이 draft plan을 "미제출"로만 보여주고 본문을 감추는
  // 것과 같은 기준 — export도 draft의 구조화 본문(동기/방법/기대결과)은 넣지 않고
  // 제목/상태 등 기존에 허용되던 최소 정보만 유지한다.
  const isDraft = a.plan.status === "draft";
  return {
    entityKind: entityKindOf(a),
    entityName: a.name,
    periodLabel: a.periodLabel,
    teacherName: a.teacherId ? a.teacherName : null,
    members: a.members,
    title: a.plan.title,
    motivation: isDraft ? null : a.plan.motivation,
    method: isDraft ? null : a.plan.method,
    expectedResult: isDraft ? null : a.plan.expectedResult,
    status: a.plan.status,
    submittedAt: a.plan.submittedAt,
    feedback: a.plan.feedback,
    fileUrls: a.plan.attachments.map((att) => att.url),
    generatedAt,
  };
}

export function reportPayloadFromActivity(a: PortfolioActivity, generatedAt: string): ReportExportPayload | null {
  if (!a.report) return null;
  // 화면과 동일한 기준(status !== "draft") — draft 결과보고서는 연구 요약 본문을
  // 넣지 않는다.
  const isDraft = a.report.status === "draft";
  const extraFiles = a.report.attachments.filter((att) => att !== a.report!.submittedFile);
  return {
    entityKind: entityKindOf(a),
    entityName: a.name,
    periodLabel: a.periodLabel,
    teacherName: a.teacherId ? a.teacherName : null,
    members: a.members,
    title: a.report.title,
    introduction: isDraft ? null : a.report.introduction,
    conclusion: isDraft ? null : a.report.conclusion,
    summary: isDraft ? null : a.report.summary,
    status: a.report.status,
    submittedAt: a.report.submittedAt,
    feedback: a.report.feedback,
    primaryFile: a.report.submittedFile,
    extraFiles,
    generatedAt,
  };
}

/** 일지 정렬: display_order(있는 것 우선, 오름차순) → 날짜 오름차순(날짜 없음은 뒤) → created_at → id. 순서 정보가 없는 기존 프로젝트는 날짜순 그대로다. */
export function compareJournalLogs(x: PortfolioLog, y: PortfolioLog): number {
  if (x.displayOrder != null || y.displayOrder != null) {
    if (x.displayOrder == null) return 1;
    if (y.displayOrder == null) return -1;
    if (x.displayOrder !== y.displayOrder) return x.displayOrder - y.displayOrder;
  }
  if (x.logDate !== y.logDate) {
    if (!x.logDate) return 1;
    if (!y.logDate) return -1;
    return x.logDate.localeCompare(y.logDate);
  }
  return (x.createdAt ?? "").localeCompare(y.createdAt ?? "") || x.id.localeCompare(y.id);
}

export function journalPayloadFromActivity(a: PortfolioActivity, studentId: string, studentName: string, generatedAt: string): JournalExportPayload {
  const entries = [...a.logs]
    .sort(compareJournalLogs)
    .map((log) => {
      // 화면(StudentPortfolioView)·plan/report export와 동일한 기준(status !== "draft")
      // — draft 연구일지는 제목/날짜/상태 등 기존에 공개되던 최소 정보만 유지하고
      // goal/activityContent/result/interpretation/conclusion/nextPlan/achievement
      // 전문은 payload에 넣지 않는다.
      const fieldDefs: { label: string; value: string | null }[] =
        log.status === "draft"
          ? []
          : [
              { label: "오늘의 목표", value: log.goal },
              { label: "오늘의 연구 활동", value: log.activityContent },
              { label: "주요 결과 및 관찰", value: log.result },
              { label: "해석 및 판단", value: log.interpretation },
              { label: "문제점 / 특이사항", value: log.conclusion },
              { label: "다음 활동과 그 이유", value: log.nextPlan },
              { label: "성과 및 소감", value: log.achievement },
            ];
      return {
        id: log.id,
        date: log.logDate,
        title: log.title,
        authorName: studentName,
        status: log.status as JournalExportPayload["entries"][number]["status"],
        fields: fieldDefs.filter((f): f is { label: string; value: string } => !!f.value),
        images: log.attachments.filter((att) => isImageUrl(att.url)),
        files: log.attachments.filter((att) => !isImageUrl(att.url)),
        participants: [{ studentId, name: studentName, roles: log.myRoles, roleDescription: null }],
        teacherFeedback: log.teacherFeedback,
      };
    });

  return {
    entityKind: entityKindOf(a),
    entityName: a.name,
    periodLabel: a.periodLabel,
    entries,
    generatedAt,
  };
}
