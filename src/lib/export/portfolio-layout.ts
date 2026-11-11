import { ACTIVITY_ROLE_CODES, ACTIVITY_ROLE_LABEL } from "@/lib/database.types";
import type { PortfolioActivity, PortfolioTypeKey } from "@/lib/portfolio/detail";
import { reportDisplayFields } from "@/lib/report-fields";
import { fmtDate } from "./common";
import type { JournalEntryExport, PlanExportPayload, ReportExportPayload } from "./types";

// 포트폴리오 PROJECT 본문(PDF/DOCX 공통) visual specification — 두 renderer가 같은 값/같은
// 라벨/같은 필드 순서를 쓰도록 한 곳에 둔다. PDF는 mm/pt fixed layout으로, DOCX는 같은 값을
// twips/half-point로 환산해서 쓴다. 새 포트폴리오 renderer 시스템이 아니라 기존
// render-plan/journal/report(compact=true) + render-full-portfolio가 공유하는 최소 helper다.

export const PF_COLOR = {
  orange: "#ED5A14",
  navy: "#1C2433",
  body: "#30343B",
  gray: "#6B7280",
  divider: "#E3E5E8",
  yearChipBg: "#F1F2F4",
  typeChipBg: "#FDEEE6",
  footerMuted: "#9AA0A8",
} as const;

/** 글자 크기(pt). */
export const PF_PT = {
  projectNo: 11,
  chip: 9,
  title: 20,
  major: 14,
  basicHeading: 11,
  field: 9.5,
  body: 10,
  meta: 9.5,
  journalTitle: 11.5,
  journalWriter: 9,
  footerCurrent: 10,
  footerTotal: 8.5,
} as const;

/** 간격(mm) — PDF 기준. DOCX는 mmToTwips()로 환산한다. */
export const PF_MM = {
  pageW: 210,
  pageH: 297,
  margin: 22,
  marginTop: 22,
  marginBottom: 19,
  footerFromBottom: 12,
  contentW: 166,
  topRulePt: 3,
  topRuleToLabel: 5.5,
  labelToChips: 6.5,
  chipH: 4.9,
  chipPadX: 1.8,
  chipGap: 1.5,
  chipToTitle: 8.5,
  titleLineH: 9.35, // 26.5pt
  titleToBasicInfo: 11.5,
  basicRowPitch: 7.5,
  basicLabelCol: 22,
  majorBefore: 13,
  majorToRule: 4.5,
  majorRulePt: 1,
  majorRuleToContent: 6,
  fieldBarH: 5.1,
  fieldBarW: 0.79, // 2.25pt
  fieldBarOffset: 2.5,
  fieldToBody: 4,
  bodyLineH: 7,
  bodyToNextField: 7,
  journalCountGap: 7,
  journalCountToDivider: 9,
  journalToDivider: 8,
  dividerToJournal: 7.5,
  journalTitleToWriter: 5,
  reportToEvidence: 11,
  dividerPt: 0.5,
} as const;

export const MM_TO_TWIPS = 56.6929;
export const mmToTwips = (mm: number): number => Math.round(mm * MM_TO_TWIPS);

export const PF_TYPE_LABEL: Record<PortfolioTypeKey, string> = { rne: "R&E", club: "동아리", individual: "창의개인연구", other: "기타 활동" };

export const PF_SECTION = {
  plan: "연구 계획",
  journal: "연구 일지",
  myRecord: "나의 기록",
  report: "결과 보고서",
  basicInfo: "기본 정보",
  evidence: "EVIDENCE",
  evidenceTitle: "학생 제출 원본 — 결과보고서",
  writer: "작성자:",
} as const;

export interface PfField {
  label: string;
  value: string;
}

/** 연구 일지 field 순서 — 현재 SciLog research log의 실제 field만(오늘의 목표/성과 및 소감은 포트폴리오 본문에 넣지 않는다). */
export const PF_JOURNAL_FIELD_ORDER = ["오늘의 연구 활동", "주요 결과 및 관찰", "해석 및 판단", "문제점 / 특이사항", "다음 활동과 그 이유"] as const;

export function pfJournalFields(entry: JournalEntryExport): PfField[] {
  return PF_JOURNAL_FIELD_ORDER.map((label) => entry.fields.find((f) => f.label === label)).filter((f): f is PfField => !!f);
}

export function pfPlanFields(data: PlanExportPayload): PfField[] {
  const out: PfField[] = [];
  if (data.motivation) out.push({ label: "연구 동기 및 목적", value: data.motivation });
  if (data.method) out.push({ label: "연구 방법", value: data.method });
  if (data.expectedResult) out.push({ label: "기대 결과", value: data.expectedResult });
  if (data.feedback) out.push({ label: "지도교사 검토 의견", value: data.feedback });
  return out;
}

export function pfReportFields(data: ReportExportPayload): PfField[] {
  const out: PfField[] = reportDisplayFields(data);
  if (data.feedback) out.push({ label: "지도교사 검토 의견", value: data.feedback });
  return out;
}

/** 연구일지 header — date가 없으면 date/구분자 없이 title만, title이 없으면 date만. 둘 다 없으면 null(가짜 날짜/"(제목 없음)" 금지). */
export function pfJournalHeading(entry: { date: string | null; title: string | null }): { date: string; title: string } | null {
  const date = entry.date ? fmtDate(entry.date) : "";
  const title = entry.title?.trim() ?? "";
  if (!date && !title) return null;
  return { date, title };
}

export function pfTitleOf(a: PortfolioActivity): string {
  return a.report?.title?.trim() || a.plan?.title?.trim() || a.name;
}

/** 기본 정보 — 학년도/활동 유형/지도교사/팀원 또는 학생/기간. 상태·제출일은 넣지 않는다. */
export function pfBasicInfoRows(a: PortfolioActivity): { label: string; value: string }[] {
  const rows = [
    { label: "학년도", value: a.schoolYear ? `${a.schoolYear}학년도` : "학년도 미정" },
    { label: "활동 유형", value: PF_TYPE_LABEL[a.typeKey] },
  ];
  // historical import 프로젝트에 연결된 교사는 "실제 지도교사"가 아니라 import 관리를 위한 교사이므로 "관리교사"로 표기한다.
  if (a.teacherId) rows.push({ label: a.isHistorical ? "관리교사" : "지도교사", value: a.teacherName });
  if (a.members.length > 0) rows.push({ label: a.typeKey === "individual" ? "학생" : "팀원", value: a.members.join(", ") });
  rows.push({ label: "기간", value: a.periodLabel });
  return rows;
}

/** 나의 기록 — 연구일지 role(나의 역할)을 프로젝트 단위로 모으고, 학생이 직접 쓴 personal record 중 실제 값이 있는 것만 낸다. */
export function pfMyRecordFields(a: PortfolioActivity, includeRoles: boolean): PfField[] {
  const out: PfField[] = [];
  if (includeRoles) {
    const roles = new Set<string>();
    for (const l of a.logs) for (const r of l.myRoles) roles.add(r);
    const labels = ACTIVITY_ROLE_CODES.filter((c) => roles.has(c)).map((c) => ACTIVITY_ROLE_LABEL[c]);
    if (labels.length > 0) out.push({ label: "나의 역할", value: labels.join("  ·  ") });
  }
  const pr = a.personalRecord;
  if (pr?.myRole) out.push({ label: "구체적으로 한 일", value: pr.myRole });
  if (pr?.motivation) out.push({ label: "연구 동기", value: pr.motivation });
  if (pr?.lessonsLearned) out.push({ label: "배운 점 / 느낀 점", value: pr.lessonsLearned });
  if (pr?.challenges) out.push({ label: "어려웠던 점과 해결 과정", value: pr.challenges });
  return out;
}

/** Cover / Journey / Other Activities / Teacher Observations 공통 top-level page 수치(mm). */
export const PF_PAGE = {
  coverTop: 24,
  coverKickerGap: 9.5,
  coverSubtitleGap: 4,
  coverNameGap: 23,
  coverYearGap: 6,
  coverCreatedGap: 3,
  glanceGap: 30,
  glanceRuleToCards: 9.5,
  cardGap: 3,
  cardH: 23,
  cardAccentH: 2,
  titleGap: 6, // top rule → page title
  titleToNext: 4,
  chipsAfterTitle: 7.5,
  countAfterChips: 6,
  journeyToList: 11,
  entryChipToTitle: 4,
  entryTitleToMeta: 3,
  entryToEntry: 8.5,
  entryChipH: 5,
  entryNumW: 8.5,
  entryTitleLineH: 5.5,
  yearBefore: 11,
  yearToSemester: 5.5,
  semesterToActivity: 4.5,
  activityChipToTitle: 2,
  titleToMeta: 2.5,
  metaToBody: 4.5,
  bodyToResult: 5.5,
  resultLabelToBody: 2.5,
  bodyToDivider: 7.5,
  dividerToNext: 5.5,
} as const;

export const PF_COVER_LABELS = {
  glance: "Portfolio at a Glance",
  journey: "Portfolio Journey",
  journeySub: "아래 순서대로 전체 연구 기록이 이어집니다.",
  research: "RESEARCH PROJECTS",
  researchCont: "RESEARCH PROJECTS · CONTINUED",
  other: "OTHER ACTIVITIES",
  observations: "TEACHER OBSERVATIONS",
  otherChip: "기타 활동",
  observationChip: "교사 관찰 기록",
} as const;
