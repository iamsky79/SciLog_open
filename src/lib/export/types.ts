import type { ActivityRoleCode, PlanStatus, ReviewStatus } from "@/lib/database.types";

/** research_plans / research_reports / references / personal_records 테이블의 entity_type 값. */
export type EntityKind = "rne" | "club" | "individual";

export interface PlanExportPayload {
  entityKind: EntityKind;
  entityName: string;
  periodLabel: string | null;
  teacherName: string | null;
  members: string[];
  title: string | null;
  motivation: string | null;
  method: string | null;
  expectedResult: string | null;
  status: PlanStatus;
  submittedAt: string | null;
  feedback: string | null;
  /** 창의개인연구 계획서 첨부파일 (팀 계획서는 파일 컬럼이 없어 항상 빈 배열) */
  fileUrls: string[];
  generatedAt: string;
}

export interface ReportExportPayload {
  entityKind: EntityKind;
  entityName: string;
  periodLabel: string | null;
  teacherName: string | null;
  members: string[];
  title: string | null;
  /** 서론(introduction) — 새 작성 UI부터 사용. */
  introduction: string | null;
  /** 결론(conclusion) — 새 작성 UI부터 사용. */
  conclusion: string | null;
  /** legacy 필드 — introduction/conclusion 도입 이전 결과보고서의 "연구 요약". */
  summary: string | null;
  status: PlanStatus;
  submittedAt: string | null;
  feedback: string | null;
  /** 실제 제출 원본 파일 — 결과보고서 본문은 이 파일에 있으며 introduction/conclusion(또는 legacy summary)은 요약일 뿐. */
  primaryFile: { name: string; url: string } | null;
  extraFiles: { name: string; url: string }[];
  generatedAt: string;
}

export interface JournalEntryExport {
  id: string;
  /** 원본에서 날짜를 확인할 수 없는 historical 일지는 null. */
  date: string | null;
  title: string | null;
  authorName: string;
  status: ReviewStatus;
  fields: { label: string; value: string }[];
  images: { url: string; name: string }[];
  files: { url: string; name: string }[];
  participants: { studentId: string; name: string; roles: ActivityRoleCode[]; roleDescription: string | null }[];
  teacherFeedback: string | null;
}

export interface JournalExportPayload {
  entityKind: EntityKind;
  entityName: string;
  periodLabel: string | null;
  entries: JournalEntryExport[];
  generatedAt: string;
}

export interface ReferenceExportItem {
  title: string;
  authors: string | null;
  source: string | null;
  url: string | null;
  fileName: string | null;
  fileUrl: string | null;
  memo: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface ReferencesExportPayload {
  entityKind: EntityKind;
  entityName: string;
  periodLabel: string | null;
  items: ReferenceExportItem[];
  generatedAt: string;
}

export interface PortfolioEntryExport {
  date: string;
  logTitle: string | null;
  /** 팀 공동 기록 맥락 파악용 짧은 스니펫(오늘의 연구 활동). 다른 학생의 역할 데이터는 포함하지 않는다. */
  teamContentSnippet: string | null;
  roles: ActivityRoleCode[];
  roleDescription: string | null;
}

export interface PortfolioExportPayload {
  studentName: string;
  entityName: string;
  periodLabel: string | null;
  /** 참여 횟수 원자료(raw frequency) — 역량 점수가 아님을 문서에도 명시한다. */
  roleCounts: Record<ActivityRoleCode, number>;
  totalParticipatedLogs: number;
  entries: PortfolioEntryExport[];
  personalRecord: {
    motivation: string | null;
    myRole: string | null;
    lessonsLearned: string | null;
    challenges: string | null;
  } | null;
  generatedAt: string;
}
