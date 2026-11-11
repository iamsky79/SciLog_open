import { ACTIVITY_ROLE_CODES, ACTIVITY_ROLE_LABEL } from "@/lib/database.types";
import type { StudentPortfolio, PortfolioActivity, PortfolioTypeKey, AttachmentRef } from "@/lib/portfolio/detail";
import { fmtDate, loadDocx, makeDocxHelpers, sanitizeDownloadName, PdfWriter, isPdfUrl, hexToRgb, type PdfLayoutConfig, type DocxSpacingConfig } from "./common";
import { planPayloadFromActivity, reportPayloadFromActivity, journalPayloadFromActivity } from "./portfolio-payloads";
import { buildJournalSectionChildren, renderJournalSectionPDF } from "./render-journal";
import { PF_COLOR, PF_COVER_LABELS, PF_MM, PF_PAGE, PF_PT, PF_SECTION, PF_TYPE_LABEL, pfBasicInfoRows, pfMyRecordFields, pfPlanFields, pfReportFields, type PfField } from "./portfolio-layout";
import {
  ascentMm, chipWidth, fieldMinHeight, flowText, needSpace, PT_MM, setPfFont, stampPortfolioFooters, wrapText, writeChips, writeDivider, writeEyebrowRule, writeField, writeFields,
  writeGlanceCards, writeMajorHeading, writePageTitle, writePortfolioFooters, writeSmallLine, writeTopRule, type PfChip,
} from "./portfolio-pdf";
import {
  pfBasicInfo, pfBody, pfChips, pfChipTitle, pfCover, pfDivider, pfDocument, pfEyebrowRule, pfField, pfFields, pfGlanceCards, pfJourneyEntry, pfMajorHeading, pfMeta, pfPageHeader,
  pfProjectHeader, pfSemesterHeading, pfSubNote, pfTitle,
} from "./portfolio-docx";
import { buildPlanSectionChildren, renderPlanSectionPDF } from "./render-plan";
import { buildReportSectionChildren, renderReportSectionPDF } from "./render-report";
import type { JournalExportPayload, PlanExportPayload, ReportExportPayload } from "./types";
import { OTHER_ACTIVITY_SUBTYPE_LABEL } from "@/lib/other-activity";
import { observationAcademicYear, sortObservationsForPortfolio, type TeacherObservation } from "@/lib/observations/actions";

// 학생 "내 포트폴리오"(자기 자신), 교사 "학생 포트폴리오"(다른 학생 조회), 그리고
// 프로젝트 페이지의 "포트폴리오형 프로젝트 export"가 전부 이 하나의 renderer를 쓴다.
// 차이는 딱 두 가지뿐이다:
//   - activities: 프로젝트 전체(포트폴리오) vs 프로젝트 하나([단일 activity])
//   - includeGlobalOverview: 표지/한눈에 보기/프로젝트 목록/종합정보를 넣을지
// 새 export 옵션 체계나 새 renderer를 만들지 않는다 — PortfolioExportOptions와
// render-plan/report/journal.ts를 그대로 재사용한다.
//
// 시각 디자인(여백/줄간격/색)은 이 파일이 만드는 PdfWriter/makeDocxHelpers 인스턴스에만
// 적용된다(PORTFOLIO_LAYOUT/PORTFOLIO_DOCX_SPACING) — render-plan/report/journal.ts
// 자체는 수정하지 않으므로, 그 함수들을 그대로 쓰는 "선택 제출물 통합 PDF"
// (submission-export.ts)는 기본값(기존 여백/줄간격/색)을 그대로 유지한다. render-journal.ts
// 만 variant="timeline"을 opt-in으로 받는다(기본값은 기존과 동일).
//
// 문서는 project-centric으로 구성한다 — 프로젝트 A의 모든 내용(계획서 전체 →
// 연구일지 전체 → 나의 기록 → 결과보고서 전체 → 제출 PDF → 첨부자료)이 끝난 뒤에만
// 프로젝트 B로 넘어간다.

const RAW_COUNT_NOTE = "※ 아래 수치는 연구일지에 기록된 참여 횟수를 단순 집계한 것이며, 역량 평가 점수가 아닙니다.";

const ALL_ACTIVITY_TYPES: PortfolioTypeKey[] = ["rne", "individual", "club", "other"];

/** 포트폴리오 전용 PDF 여백/줄간격 — 기존 탭별 내보내기 문서는 이 값을 전혀 받지 않는다. */
const PORTFOLIO_LAYOUT: PdfLayoutConfig = { margin: PF_MM.margin, marginTop: PF_MM.marginTop, marginBottom: PF_MM.marginBottom, lineHeightRatio: 0.53 };
/** 포트폴리오 전용 docx spacing — 기존 탭별 내보내기 docx는 이 값을 전혀 받지 않는다.
 * h2Before(divider→heading 5~7mm)/h2After(heading→본문 4~5mm) 가이드에 맞춘 값(1mm≈56.7twips). */
const PORTFOLIO_DOCX_SPACING: DocxSpacingConfig = { dividerBefore: 400, dividerAfter: 340, dividerColor: "D9DEE7", h2Before: 340, h2After: 260, paragraphColor: "1F2937" };

/**
 * 내보내기 dialog(학생/교사 공용)가 선택하는 "학년도/활동/포함 내용" 범위.
 * getStudentPortfolio()가 이미 academicYear로 서버 조회 단계에서 필터링해 주므로,
 * 여기서는 그 결과 위에서 "활동 유형"과 "어떤 section을 문서에 넣을지"만 더 좁힌다 —
 * 새 portfolio 조회 경로를 만들지 않는다.
 */
export interface PortfolioExportOptions {
  activityTypes: PortfolioTypeKey[];
  includeSummary: boolean;
  includeProcess: boolean;
  includeLogs: boolean;
  includeRoles: boolean;
  includeMyRecords: boolean;
  includeFeedback: boolean;
  includeReport: boolean;
  includeAwards: boolean;
  /** "실제 제출 보고서 PDF" — 연구계획서/결과보고서의 submittedFile(PDF인 경우)을
   * 포트폴리오 PDF 본문 뒤에 실제 페이지로 병합한다. PDF export에서만 의미가 있다. */
  includeSubmittedPdf: boolean;
  /** "PDF 첨부자료" — submittedFile 외 나머지 첨부(extra_file_urls 등) 중 PDF인
   * 것들도 통합 PDF에 추가로 병합한다. */
  includePdfAttachments: boolean;
}

export const DEFAULT_PORTFOLIO_EXPORT_OPTIONS: PortfolioExportOptions = {
  activityTypes: ALL_ACTIVITY_TYPES,
  includeSummary: true,
  includeProcess: true,
  includeLogs: true,
  includeRoles: true,
  includeMyRecords: true,
  includeFeedback: true,
  includeReport: true,
  includeAwards: true,
  includeSubmittedPdf: true,
  includePdfAttachments: false,
};

function hasResearchStructure(a: PortfolioActivity): boolean {
  return a.typeKey !== "other";
}

const TYPE_ORDER: Record<PortfolioTypeKey, number> = { rne: 0, club: 1, individual: 2, other: 3 };

/**
 * 활동 유형별로 묶지 않고 학년도 오름차순(2023→2024→...)으로 전체 프로젝트를 정렬한다 —
 * Research Journey(writeJourneyPage)와 본문 프로젝트 loop(writeProjectBody)가 모두 이
 * 배열 하나를 그대로 쓰므로 순서가 항상 같다. 같은 학년도 안에서만 기존 deterministic
 * 기준(활동 유형 → 학기/periodSort → 이름)을 적용한다. getStudentPortfolio()가 반환하는
 * 전역 정렬(화면 표시용, 유형별 그룹 + 최신순)은 건드리지 않는다 — export 시점에서만
 * 다시 정렬한다.
 */
function filteredActivitiesOf(portfolio: StudentPortfolio, options: PortfolioExportOptions): PortfolioActivity[] {
  const filtered = portfolio.activities.filter((a) => options.activityTypes.includes(a.typeKey));
  return [...filtered].sort((a, b) => {
    const yearA = a.schoolYear ? parseInt(a.schoolYear, 10) : Number.MAX_SAFE_INTEGER;
    const yearB = b.schoolYear ? parseInt(b.schoolYear, 10) : Number.MAX_SAFE_INTEGER;
    if (yearA !== yearB) return yearA - yearB;
    const t = TYPE_ORDER[a.typeKey] - TYPE_ORDER[b.typeKey];
    if (t !== 0) return t;
    if (a.periodSort !== b.periodSort) return a.periodSort - b.periodSort;
    return a.name.localeCompare(b.name, "ko");
  });
}

/** 프로젝트 대표 제목 — 결과보고서의 최종 title을 최우선으로 쓰고, 없으면 연구계획서
 * title, 그마저 없으면 팀/활동 내부 이름(a.name)으로 폴백한다. "이다해 test" 같은 내부
 * 관리용 이름을 대표 제목으로 쓰지 않기 위함 — 팀/활동 이름은 실제 연구 제목이 아직
 * 없을 때만 최후 수단으로 쓴다. */
function representativeTitle(a: PortfolioActivity): string {
  const reportTitle = a.report?.title?.trim();
  if (reportTitle) return reportTitle;
  const planTitle = a.plan?.title?.trim();
  if (planTitle) return planTitle;
  return a.name;
}

/** 기타 활동을 학년도 오름차순 → 학기 → 날짜 → 활동 제목 순으로 정렬한다. */
function sortOtherActivities(others: PortfolioActivity[]): PortfolioActivity[] {
  return [...others].sort((a, b) => {
    const yearA = a.schoolYear ? parseInt(a.schoolYear, 10) : Number.MAX_SAFE_INTEGER;
    const yearB = b.schoolYear ? parseInt(b.schoolYear, 10) : Number.MAX_SAFE_INTEGER;
    if (yearA !== yearB) return yearA - yearB;
    if (a.periodSort !== b.periodSort) return a.periodSort - b.periodSort;
    const dateA = a.otherActivityDate ?? "";
    const dateB = b.otherActivityDate ?? "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.name.localeCompare(b.name, "ko");
  });
}

/** 이 포트폴리오에 실제로 내보낼 내용이 하나라도 있는지 — 없으면 빈 문서를 만들지 않는다. */
export function hasExportableContent(portfolio: StudentPortfolio, options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS): boolean {
  const activities = filteredActivitiesOf(portfolio, options);
  const awards = options.includeAwards ? portfolio.awards : [];
  return activities.length > 0 || awards.length > 0;
}

/** 단일 학년도면 그 값, 여러 학년도에 걸친 활동이면 "최솟값-최댓값" 범위로 — 새 학년도 개념을 만들지 않고 yearOptions를 그대로 쓴다. */
function yearLabelOf(portfolio: StudentPortfolio): string {
  if (portfolio.academicYear) return portfolio.academicYear;
  const years = [...portfolio.yearOptions].filter(Boolean).sort();
  if (years.length === 0) return "전체학년도";
  if (years.length === 1) return years[0];
  return `${years[0]}-${years[years.length - 1]}`;
}

/** 개별 프로젝트 export(includeGlobalOverview=false, activities 1개)면 프로젝트명을 파일명에 넣는다. */
function fileBaseName(portfolio: StudentPortfolio, includeGlobalOverview = true): string {
  if (!includeGlobalOverview && portfolio.activities.length === 1) {
    return sanitizeDownloadName(`${portfolio.activities[0].name}_${portfolio.student.name}_포트폴리오`);
  }
  return sanitizeDownloadName(`${yearLabelOf(portfolio)}_${portfolio.student.name}_연구포트폴리오`);
}

/** 표지에 쓰는 "OO학년도" / "OO-OO학년도" / "전체 학년도" 문구 — yearLabelOf와 같은 값을 문장으로만 다듬는다. */
function coverYearLabel(portfolio: StudentPortfolio): string {
  const label = yearLabelOf(portfolio);
  return label === "전체학년도" ? "전체 학년도" : `${label.replace("-", "–")}학년도`;
}

// ─── Page 1: Cover — top orange line → SciLog → RESEARCH PORTFOLIO → 학생 이름 → 학년도 → 생성일,
// 같은 page 하단에 Portfolio at a Glance(14pt heading + orange line + 요약 카드). Glance는 별도 페이지가
// 아니다 — writeFrontMatter가 이 함수 다음에 w.newPage()를 불러 Journey가 다음 페이지에서 시작한다. ───
function writeCoverPage(w: PdfWriter, portfolio: StudentPortfolio, includeGlance: boolean): void {
  w.y = PF_PAGE.coverTop;
  writeTopRule(w);
  writeSmallLine(w, "SciLog", 10, true, PF_COLOR.orange, PF_PAGE.coverKickerGap);
  writeSmallLine(w, "RESEARCH PORTFOLIO", 11, true, PF_COLOR.gray, PF_PAGE.coverSubtitleGap, 0.3);
  writeSmallLine(w, portfolio.student.name, 29, true, PF_COLOR.navy, PF_PAGE.coverNameGap);
  writeSmallLine(w, coverYearLabel(portfolio), 11, false, PF_COLOR.gray, PF_PAGE.coverYearGap);
  writeSmallLine(w, `생성일 ${fmtDate(new Date().toISOString())}`, 9, false, PF_COLOR.gray, PF_PAGE.coverCreatedGap);
  if (includeGlance) writeCoverGlanceBlock(w, portfolio);
}

function glanceCards(portfolio: StudentPortfolio): { label: string; value: string }[] {
  const { summary } = portfolio;
  const cards = [
    { label: "참여 연구/활동", value: `${summary.projectCount}` },
    { label: "연구계획서", value: `${summary.planApproved}/${summary.planTotal}` },
    { label: "결과보고서", value: `${summary.reportApproved}/${summary.reportTotal}` },
    { label: "연구일지", value: `${summary.noteCount}` },
  ];
  if (summary.awardCount > 0) cards.push({ label: "수상·발표", value: `${summary.awardCount}` });
  return cards;
}

function writeCoverGlanceBlock(w: PdfWriter, portfolio: StudentPortfolio): void {
  w.y += PF_PAGE.glanceGap - PF_MM.majorBefore; // writeMajorHeading이 majorBefore를 다시 더한다
  writeMajorHeading(w, PF_COVER_LABELS.glance, PF_PAGE.cardH + 10);
  w.y += PF_PAGE.glanceRuleToCards - PF_MM.majorRuleToContent;
  writeGlanceCards(w, glanceCards(portfolio));
}

function docxCoverChildren(mod: DocxMod, portfolio: StudentPortfolio, includeGlance: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = pfCover(mod, portfolio.student.name, coverYearLabel(portfolio), `생성일 ${fmtDate(new Date().toISOString())}`);
  if (includeGlance) {
    children.push(pfMajorHeading(mod, PF_COVER_LABELS.glance, PF_PAGE.glanceGap));
    children.push(pfGlanceCards(mod, glanceCards(portfolio)));
  }
  return children;
}

// ─── Page 2~: Portfolio Journey — RESEARCH PROJECTS(compact entry: [번호][유형] → 제목 → 기간·지도교사) →
// OTHER ACTIVITIES 요약 → TEACHER OBSERVATIONS 요약(teacher export만). 번호는 본문 PROJECT NN과 같은
// activities 배열(filteredActivitiesOf)에서 나오므로 항상 1:1로 일치한다. entry는 chip+제목 전체+metadata가
// 통째로 한 페이지에 들어가야 하고, 안 들어가면 entry 전체를 다음 페이지로 보낸다(고정 개수로 자르지 않는다). ───
const JOURNEY_TITLE_PT = PF_PT.journalTitle;

function journeyMetaOf(a: PortfolioActivity): string {
  return [a.periodLabel, a.teacherId ? `${a.isHistorical ? "관리교사" : "지도교사"} ${a.teacherName}` : null].filter((s): s is string => !!s).join(" · ");
}

function journeyEntryHeight(w: PdfWriter, titleLines: number, hasMeta: boolean): number {
  return PF_PAGE.entryChipH + PF_PAGE.entryChipToTitle - 1.4 + titleLines * PF_PAGE.entryTitleLineH + (hasMeta ? PF_PAGE.entryTitleToMeta - 1.4 + 4.3 : 0) + PF_PAGE.entryToEntry;
}

function writeJourneyEntry(w: PdfWriter, chips: PfChip[], titleLines: string[], meta: string): void {
  const top = w.y;
  writeChips(w, chips, top, PF_PAGE.entryChipH, 8.5);
  w.y = top + PF_PAGE.entryChipH + PF_PAGE.entryChipToTitle - 1.4;
  setPfFont(w, JOURNEY_TITLE_PT, true, PF_COLOR.navy);
  titleLines.forEach((line, i) => w.doc.text(line, w.margin, w.y + i * PF_PAGE.entryTitleLineH + PF_PAGE.entryTitleLineH / 2 + JOURNEY_TITLE_PT * PT_MM * 0.36));
  w.y += titleLines.length * PF_PAGE.entryTitleLineH;
  if (meta) {
    w.y += PF_PAGE.entryTitleToMeta - 1.4;
    flowText(w, meta, { pt: 9, color: PF_COLOR.gray, lineH: 4.3 });
  }
  w.y += PF_PAGE.entryToEntry;
}

const summaryBlockHeight = (): number => 3.3 + 3 + 5 + PF_PAGE.entryChipH + 4.5 + 4.3 + PF_PAGE.entryToEntry;

function writeJourneySummary(w: PdfWriter, heading: string, chipLabel: string, range: string | null, count: number): void {
  needSpace(w, summaryBlockHeight());
  writeEyebrowRule(w, heading);
  const top = w.y;
  writeChips(w, [{ text: chipLabel, bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange }, ...(range ? [{ text: range, bg: PF_COLOR.yearChipBg, fg: PF_COLOR.gray }] : [])], top, PF_PAGE.entryChipH, 8.5);
  w.y = top + PF_PAGE.entryChipH + 4.5 - 1.4;
  flowText(w, `총 ${count}건`, { pt: 9, color: PF_COLOR.gray, lineH: 4.3 });
  w.y += PF_PAGE.entryToEntry;
}

function writeJourneyPage(w: PdfWriter, activities: PortfolioActivity[], observations: TeacherObservation[]): void {
  const research = activities.filter(hasResearchStructure);
  const others = activities.filter((a) => a.typeKey === "other");
  writeTopRule(w);
  writePageTitle(w, PF_COVER_LABELS.journey);
  writeSmallLine(w, PF_COVER_LABELS.journeySub, 9, false, PF_COLOR.gray, PF_PAGE.titleToNext);
  w.y += PF_PAGE.journeyToList - 4;

  if (research.length > 0) {
    writeEyebrowRule(w, PF_COVER_LABELS.research);
    research.forEach((a, idx) => {
      const titleLines = wrapText(w, representativeTitle(a), JOURNEY_TITLE_PT, true);
      const meta = journeyMetaOf(a);
      if (w.y + journeyEntryHeight(w, titleLines.length, !!meta) > w.pageH - w.marginBottom && w.y > w.marginTop + 0.01) {
        w.newPage();
        writeSmallLine(w, PF_COVER_LABELS.researchCont, 9.5, true, PF_COLOR.gray, 0);
        w.y += 6;
      }
      writeJourneyEntry(
        w,
        [
          { text: String(idx + 1).padStart(2, "0"), bg: PF_COLOR.orange, fg: "#FFFFFF", minW: PF_PAGE.entryNumW },
          { text: PF_TYPE_LABEL[a.typeKey], bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange },
        ],
        titleLines,
        meta
      );
    });
  }
  if (others.length > 0) writeJourneySummary(w, PF_COVER_LABELS.other, PF_COVER_LABELS.otherChip, otherActivitiesYearRange(others), others.length);
  if (observations.length > 0) writeJourneySummary(w, PF_COVER_LABELS.observations, PF_COVER_LABELS.observationChip, observationsYearRange(observations), observations.length);
}

function docxJourneyChildren(mod: DocxMod, activities: PortfolioActivity[], observations: TeacherObservation[]) {
  const research = activities.filter(hasResearchStructure);
  const others = activities.filter((a) => a.typeKey === "other");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [pfPageHeader(mod, PF_COVER_LABELS.journey, true), pfSubNote(mod, PF_COVER_LABELS.journeySub, PF_PAGE.journeyToList - 4)];

  if (research.length > 0) {
    children.push(pfEyebrowRule(mod, PF_COVER_LABELS.research));
    research.forEach((a, idx) => {
      children.push(
        ...pfJourneyEntry(
          mod,
          [
            { text: String(idx + 1).padStart(2, "0"), bg: PF_COLOR.orange, fg: "#FFFFFF" },
            { text: PF_TYPE_LABEL[a.typeKey], bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange },
          ],
          representativeTitle(a),
          journeyMetaOf(a) || null
        )
      );
    });
  }
  const summary = (heading: string, chipLabel: string, range: string | null, count: number) => {
    children.push(pfEyebrowRule(mod, heading));
    children.push(
      ...pfJourneyEntry(mod, [{ text: chipLabel, bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange }, ...(range ? [{ text: range, bg: PF_COLOR.yearChipBg, fg: PF_COLOR.gray }] : [])], null, `총 ${count}건`)
    );
  };
  if (others.length > 0) summary(PF_COVER_LABELS.other, PF_COVER_LABELS.otherChip, otherActivitiesYearRange(others), others.length);
  if (observations.length > 0) summary(PF_COVER_LABELS.observations, PF_COVER_LABELS.observationChip, observationsYearRange(observations), observations.length);
  return children;
}

/** "2023" 또는 "2023–2025" — 실제 학년도 범위 그대로, 전부 미정이면 null(그 경우
 * 호출부가 연도 chip 자체를 생략한다). 건수("총 N건")는 각 호출부가 별도 plain
 * text로 붙인다 — chip에는 이름+연도만, 건수는 chip과 분리해서 보여준다(요청사항). */
function otherActivitiesYearRange(sorted: PortfolioActivity[]): string | null {
  const years = [...new Set(sorted.map((a) => a.schoolYear).filter((y): y is string => !!y))].sort();
  if (years.length === 0) return null;
  return years.length === 1 ? years[0] : `${years[0]}–${years[years.length - 1]}`;
}

/** 교사 관찰 기록용 연도 범위 — observed_at 연도(observationAcademicYear) 기준,
 * 기타 활동과 같은 형식으로 통일한다. */
function observationsYearRange(observations: TeacherObservation[]): string | null {
  const years = [...new Set(observations.map((o) => observationAcademicYear(o)).filter((y): y is number => y != null))].sort((a, b) => a - b);
  if (years.length === 0) return null;
  return years.length === 1 ? `${years[0]}` : `${years[0]}–${years[years.length - 1]}`;
}

/** PROJECT 루프처럼 "이 writer에 이미 뭔가 그려져 있을 때만" 새 페이지로 넘긴다.
 * writePortfolioPDFContent(단일 shared writer)에서는 항상 이전 내용 뒤에 이어지므로
 * 실제로 새 페이지가 된다. buildMergedPortfolioPdfBytes(섹션마다 별도 PdfWriter를
 * 만들어 나중에 pdf-lib으로 병합)에서는 이 writer가 이미 빈 새 문서(y===marginTop)라
 * 무조건 newPage()를 부르면 빈 페이지가 하나 더 끼어든다 — 병합 시 이 writer 자체가
 * 곧 "새 페이지"이므로 y가 비어있으면 그대로 두고, 뭔가 그려져 있을 때만 넘긴다. */
function forceNewPageIfNeeded(w: PdfWriter): void {
  if (w.y > w.marginTop) w.newPage();
}

// ── OTHER ACTIVITIES / TEACHER OBSERVATIONS 공통 기록 항목 — [chip] 제목 → metadata → 본문 → (성과) → divider.
// PROJECT와 같은 orange/navy visual language(top line, 20pt title, chip row, 총 N건, 학년도 14pt heading + orange
// underline)를 쓰고 카드 박스는 쓰지 않는다. 모든 위치는 w.y(줄 상자 top)에서 이어 계산하므로 긴 항목이 자동으로
// 다음 페이지로 넘어간 뒤에도 cursor가 새 페이지 기준으로 유지된다(stale y 없음). ──
interface RecordItem {
  chip: string | null;
  title: string | null;
  meta: string | null;
  body: string | null;
  result: string | null;
}

const RECORD_TITLE_LINE_H = 5.6;

function recordTitleLines(w: PdfWriter, r: RecordItem): { lines: string[]; x: number } {
  if (!r.title) return { lines: [], x: w.margin };
  const cw = r.chip ? chipWidth(w, r.chip, 8.5) + PF_PAGE.activityChipToTitle : 0;
  return { lines: wrapText(w, r.title, PF_PT.journalTitle, true, w.contentW - cw), x: w.margin + cw };
}

/** 항목 시작부(chip+제목 전체, metadata, 본문 최소 2줄)가 들어갈 높이(mm). */
function recordMinHeight(w: PdfWriter, r: RecordItem): number {
  const { lines } = recordTitleLines(w, r);
  const headH = Math.max(lines.length, r.chip ? 1 : 0) * RECORD_TITLE_LINE_H;
  const metaH = r.meta ? PF_PAGE.titleToMeta + 4.3 : 0;
  const bodyLines = r.body ? Math.min(2, wrapText(w, r.body, PF_PT.body, false).length) : 0;
  const bodyH = r.body ? PF_PAGE.metaToBody + bodyLines * PF_MM.bodyLineH : 0;
  return headH + metaH + bodyH;
}

function writeRecord(w: PdfWriter, r: RecordItem): void {
  needSpace(w, recordMinHeight(w, r));
  const { lines, x } = recordTitleLines(w, r);
  const top = w.y;
  if (r.chip) writeChips(w, [{ text: r.chip, bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange }], top + (RECORD_TITLE_LINE_H - PF_PAGE.entryChipH) / 2, PF_PAGE.entryChipH, 8.5);
  setPfFont(w, PF_PT.journalTitle, true, PF_COLOR.navy);
  lines.forEach((line, i) => w.doc.text(line, x, top + i * RECORD_TITLE_LINE_H + RECORD_TITLE_LINE_H / 2 + PF_PT.journalTitle * PT_MM * 0.36));
  w.y = top + Math.max(lines.length, r.chip ? 1 : 0) * RECORD_TITLE_LINE_H;
  if (r.meta) {
    w.y += PF_PAGE.titleToMeta - 1.5;
    flowText(w, r.meta, { pt: 9, color: PF_COLOR.gray, lineH: 4.3 });
  }
  if (r.body) {
    w.y += PF_PAGE.metaToBody - 1.7;
    flowText(w, r.body);
  }
  if (r.result) {
    w.y += PF_PAGE.bodyToResult - 1.7;
    writeField(w, "성과", r.result, true, PF_PAGE.resultLabelToBody);
  }
}

/** top-level page(OTHER ACTIVITIES / TEACHER OBSERVATIONS) 시작 — 항상 새 페이지, top line → 20pt title → chip row → 총 N건. */
function writeTopLevelHeader(w: PdfWriter, title: string, chipLabel: string, range: string | null, count: number): void {
  forceNewPageIfNeeded(w);
  writeTopRule(w);
  writePageTitle(w, title);
  const chipTop = w.y + PF_PAGE.chipsAfterTitle;
  const chipBottom = writeChips(w, [{ text: chipLabel, bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange }, ...(range ? [{ text: range, bg: PF_COLOR.yearChipBg, fg: PF_COLOR.gray }] : [])], chipTop);
  w.y = chipBottom;
  writeSmallLine(w, `총 ${count}건`, 9, false, PF_COLOR.gray, PF_PAGE.countAfterChips);
}

/** 학년도(+학기) 그룹으로 나뉜 기록 목록 — year/semester heading은 뒤따르는 첫 항목 시작부와 함께 들어갈 때만 그린다. */
function writeGroupedRecords(w: PdfWriter, groups: { year: string; semester: string | null; item: RecordItem }[]): void {
  let prevYear: string | null = null;
  let prevSemester: string | null = null;
  let first = true;
  for (const g of groups) {
    const yearChanged = g.year !== prevYear;
    const semesterChanged = yearChanged || g.semester !== prevSemester;
    const minItem = recordMinHeight(w, g.item);
    const semesterBlock = g.semester && semesterChanged ? 4 + PF_PAGE.semesterToActivity : 0;

    if (yearChanged) {
      writeMajorHeading(w, g.year, semesterBlock + minItem, first ? 10 : PF_PAGE.yearBefore);
      prevYear = g.year;
      prevSemester = null;
    } else if (semesterChanged && g.semester) {
      w.y += 6;
      needSpace(w, semesterBlock + minItem);
    }
    if (semesterChanged && g.semester) {
      writeSmallLine(w, g.semester, PF_PT.basicHeading, true, PF_COLOR.gray, 0);
      w.y += PF_PAGE.semesterToActivity;
    }
    prevSemester = g.semester;

    const startsGroup = yearChanged || (semesterChanged && !!g.semester);
    if (!startsGroup) {
      // 앞 항목 끝 → 7.5mm → divider → 5.5mm → 다음 항목. 다음 항목 시작부가 안 들어가면 divider 없이 새 페이지에서 시작.
      w.y += PF_PAGE.bodyToDivider - 1.7;
      if (w.y + PF_PAGE.dividerToNext + minItem > w.pageH - w.marginBottom) w.newPage();
      else {
        writeDivider(w);
        w.y += PF_PAGE.dividerToNext;
      }
    }
    writeRecord(w, g.item);
    first = false;
  }
}

function otherActivityItem(a: PortfolioActivity): RecordItem | null {
  const other = a.otherActivity;
  if (!other) return null;
  return {
    chip: OTHER_ACTIVITY_SUBTYPE_LABEL[other.subtype],
    title: a.name,
    meta: [a.otherActivityDate ? fmtDate(a.otherActivityDate) : null, other.organizer].filter(Boolean).join(" · ") || null,
    body: other.content,
    result: other.result,
  };
}

function otherGroups(sorted: PortfolioActivity[]) {
  return sorted.flatMap((a) => {
    const item = otherActivityItem(a);
    return item ? [{ year: a.schoolYear ? `${a.schoolYear}학년도` : "학년도 미정", semester: a.otherSemesterLabel ?? null, item }] : [];
  });
}

function writeOtherActivitiesSection(w: PdfWriter, others: PortfolioActivity[]): void {
  if (others.length === 0) return;
  const sorted = sortOtherActivities(others);
  writeTopLevelHeader(w, PF_COVER_LABELS.other, PF_COVER_LABELS.otherChip, otherActivitiesYearRange(sorted), sorted.length);
  writeGroupedRecords(w, otherGroups(sorted));
}

function observationItem(o: TeacherObservation): RecordItem {
  const tags = o.tags.length > 0 ? o.tags.map((t) => `#${t}`).join(" ") : null;
  return { chip: null, title: o.activityType ? (PF_TYPE_LABEL[o.activityType as PortfolioTypeKey] ?? o.activityType) : null, meta: [o.observedAt ? fmtDate(o.observedAt) : null, tags].filter(Boolean).join(" · ") || null, body: o.content, result: null };
}

function observationGroups(sorted: TeacherObservation[]) {
  return sorted.map((o) => {
    const year = observationAcademicYear(o);
    return { year: year != null ? `${year}학년도` : "학년도 미상", semester: null, item: observationItem(o) };
  });
}

/** 교사 관찰 기록 — teacher export(호출부가 observations를 넘길 때)에서만 그려지는 문서 마지막 section. 데이터/가시성 로직은 그대로다. */
function writeTeacherObservationsSection(w: PdfWriter, observations: TeacherObservation[]): void {
  if (observations.length === 0) return;
  const sorted = sortObservationsForPortfolio(observations);
  writeTopLevelHeader(w, PF_COVER_LABELS.observations, PF_COVER_LABELS.observationChip, observationsYearRange(sorted), sorted.length);
  writeGroupedRecords(w, observationGroups(sorted));
}

// ── DOCX — 같은 RecordItem/그룹을 같은 순서로 그린다. ──
function docxRecordChildren(mod: DocxMod, groups: { year: string; semester: string | null; item: RecordItem }[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];
  let prevYear: string | null = null;
  let prevSemester: string | null = null;
  for (const g of groups) {
    const yearChanged = g.year !== prevYear;
    const semesterChanged = yearChanged || g.semester !== prevSemester;
    if (yearChanged) {
      children.push(pfMajorHeading(mod, g.year, prevYear === null ? 10 : PF_PAGE.yearBefore));
      prevYear = g.year;
    }
    if (semesterChanged && g.semester) children.push(pfSemesterHeading(mod, g.semester));
    prevSemester = g.semester;
    if (!(yearChanged || (semesterChanged && g.semester))) children.push(pfDivider(mod));

    const r = g.item;
    if (r.title || r.chip) children.push(pfChipTitle(mod, r.chip, r.title ?? "", !!r.meta));
    if (r.meta) children.push(pfMeta(mod, r.meta));
    if (r.body) children.push(...pfBody(mod, r.body, r.result ? PF_PAGE.bodyToResult - 1.3 : 0));
    if (r.result) children.push(...pfField(mod, { label: "성과", value: r.result }, true, PF_PAGE.resultLabelToBody));
  }
  return children;
}

function docxTopLevelHeader(mod: DocxMod, title: string, chipLabel: string, range: string | null, count: number) {
  return [
    pfPageHeader(mod, title, true),
    pfChips(mod, [{ text: chipLabel, bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange }, ...(range ? [{ text: range, bg: PF_COLOR.yearChipBg, fg: PF_COLOR.gray }] : [])]),
    pfSubNote(mod, `총 ${count}건`, 2),
  ];
}

function docxOtherActivitiesChildren(mod: DocxMod, others: PortfolioActivity[]) {
  if (others.length === 0) return [];
  const sorted = sortOtherActivities(others);
  return [...docxTopLevelHeader(mod, PF_COVER_LABELS.other, PF_COVER_LABELS.otherChip, otherActivitiesYearRange(sorted), sorted.length), ...docxRecordChildren(mod, otherGroups(sorted))];
}

function docxTeacherObservationsChildren(mod: DocxMod, observations: TeacherObservation[]) {
  if (observations.length === 0) return [];
  const sorted = sortObservationsForPortfolio(observations);
  return [...docxTopLevelHeader(mod, PF_COVER_LABELS.observations, PF_COVER_LABELS.observationChip, observationsYearRange(sorted), sorted.length), ...docxRecordChildren(mod, observationGroups(sorted))];
}

/**
 * 표지(Cover) → 한눈에 보기(Glance) → Research Journey — includeGlobalOverview=true
 * (전체 포트폴리오)일 때만, 셋 다 각자 강제 새 페이지로 그린다(의미 있는 divider 예외).
 * includeGlobalOverview=false(개별 프로젝트 export)면 이 조각 전체를 건너뛰고 프로젝트
 * 자신의 cover가 곧 문서 1페이지가 된다(빈 표지 페이지 없음).
 */
function writeFrontMatter(
  w: PdfWriter,
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions,
  activities: PortfolioActivity[],
  includeGlobalOverview: boolean,
  observations: TeacherObservation[] = []
): void {
  if (!includeGlobalOverview) return;
  writeCoverPage(w, portfolio, options.includeSummary);
  if (options.includeSummary && (activities.length > 0 || observations.length > 0)) {
    w.newPage();
    writeJourneyPage(w, activities, observations);
  }
}

/**
 * [PROJECT HEADER] — 위쪽 3pt orange line → "PROJECT NN"(11pt bold orange) → [유형][학년도] chip →
 * 제목(20pt bold navy) → "기본 정보". 모든 간격은 portfolio-layout.ts의 PF_MM(잉크 기준 mm)이고,
 * PdfWriter.line()의 line-box advance에 의존하지 않도록 baseline을 직접 계산해 배치한다.
 * 이 페이지에는 항상 PROJECT 하나만 시작한다(호출부가 새 페이지에서 부른다).
 */
function writeProjectCover(w: PdfWriter, a: PortfolioActivity, index: number): void {
  const [or, og, ob] = hexToRgb(PF_COLOR.orange);
  const ruleW = PF_MM.topRulePt * PT_MM;
  w.doc.setDrawColor(or, og, ob);
  w.doc.setLineWidth(ruleW);
  w.doc.line(w.margin, w.y + ruleW / 2, w.margin + w.contentW, w.y + ruleW / 2);

  const labelBaseline = w.y + ruleW + PF_MM.topRuleToLabel + PF_PT.projectNo * PT_MM * 0.72;
  setPfFont(w, PF_PT.projectNo, true, PF_COLOR.orange);
  w.doc.text(`PROJECT ${String(index + 1).padStart(2, "0")}`, w.margin, labelBaseline);

  const chipTop = labelBaseline + PF_MM.labelToChips;
  const chipBottom = writeChips(
    w,
    [
      { text: PF_TYPE_LABEL[a.typeKey], bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange },
      ...(a.schoolYear ? [{ text: `${a.schoolYear}학년도`, bg: PF_COLOR.yearChipBg, fg: PF_COLOR.gray }] : []),
    ],
    chipTop
  );

  const titleLines = wrapText(w, representativeTitle(a), PF_PT.title, true);
  const firstBaseline = chipBottom + PF_MM.chipToTitle + ascentMm(PF_PT.title);
  setPfFont(w, PF_PT.title, true, PF_COLOR.navy);
  titleLines.forEach((line, i) => w.doc.text(line, w.margin, firstBaseline + i * PF_MM.titleLineH));
  const titleBottom = firstBaseline + (titleLines.length - 1) * PF_MM.titleLineH + PF_PT.title * 0.05;

  const headBaseline = titleBottom + PF_MM.titleToBasicInfo + ascentMm(PF_PT.basicHeading);
  setPfFont(w, PF_PT.basicHeading, true, PF_COLOR.navy);
  w.doc.text(PF_SECTION.basicInfo, w.margin, headBaseline);

  let rowBaseline = headBaseline;
  for (const row of pfBasicInfoRows(a)) {
    rowBaseline += PF_MM.basicRowPitch;
    setPfFont(w, PF_PT.meta, true, PF_COLOR.gray);
    w.doc.text(`${row.label}`, w.margin, rowBaseline);
    const valueLines = wrapText(w, row.value, PF_PT.meta, false, w.contentW - PF_MM.basicLabelCol);
    setPfFont(w, PF_PT.meta, false, PF_COLOR.body);
    valueLines.forEach((line, i) => w.doc.text(line, w.margin + PF_MM.basicLabelCol, rowBaseline + i * 4.8));
    rowBaseline += (valueLines.length - 1) * 4.8;
  }
  w.y = rowBaseline + 2;
}

function docxProjectCoverChildren(mod: DocxMod, a: PortfolioActivity, index: number, pageBreakBefore: boolean) {
  return [
    pfProjectHeader(mod, index, pageBreakBefore),
    pfChips(mod, [
      { text: PF_TYPE_LABEL[a.typeKey], bg: PF_COLOR.typeChipBg, fg: PF_COLOR.orange },
      ...(a.schoolYear ? [{ text: `${a.schoolYear}학년도`, bg: PF_COLOR.yearChipBg, fg: PF_COLOR.gray }] : []),
    ]),
    pfTitle(mod, representativeTitle(a)),
    ...pfBasicInfo(mod, pfBasicInfoRows(a)),
  ];
}

/** "나의 기록" — 프로젝트 단위 나의 역할(연구일지 role 집계) + 학생이 실제로 저장한 personal record만. */
function writeMyRecordBlock(w: PdfWriter, fields: PfField[]): void {
  if (fields.length === 0) return;
  writeMajorHeading(w, PF_SECTION.myRecord, fieldMinHeight(w, fields[0].value));
  writeFields(w, fields);
}

/** includeFeedback=false면 renderer가 자체적으로 그리는 "교사 검토 의견"을 숨긴다. */
function withPlanOptions(payload: PlanExportPayload | null, includeFeedback: boolean): PlanExportPayload | null {
  if (!payload) return null;
  return includeFeedback ? payload : { ...payload, feedback: null };
}

/** includeFeedback=false면 "교사 검토 의견"을 숨긴다. EVIDENCE 머리말은 payload가 아니라
 * 호출부(실제 제출 PDF를 병합하는 PDF 경로)가 renderReportSectionPDF(showEvidence)로 결정한다. */
function withReportOptions(payload: ReportExportPayload | null, includeFeedback: boolean): ReportExportPayload | null {
  if (!payload) return null;
  return { ...payload, feedback: includeFeedback ? payload.feedback : null };
}

/** includeFeedback=false면 각 일지의 교사 피드백을 숨긴다. 역할은 연구일지 본문이 아니라 "나의 기록"에서 모아 보여준다. */
function withJournalOptions(payload: JournalExportPayload, includeFeedback: boolean): JournalExportPayload {
  if (includeFeedback) return payload;
  return { ...payload, entries: payload.entries.map((e) => ({ ...e, teacherFeedback: null })) };
}

/**
 * 나의 역할(전체 합계) + 수상·발표 — includeGlobalOverview=true일 때만, 프로젝트 루프가
 * 끝난 뒤의 "전체 종합 정보". 강제 새 페이지 목록에 없으므로, 내용이 짧으면 마지막
 * 프로젝트가 끝난 같은 페이지에 이어서 쓴다(한 줄 통계 때문에 페이지를 통째로 쓰지 않음).
 */
function writeClosingSections(
  w: PdfWriter,
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions,
  includeGlobalOverview: boolean,
  observations: TeacherObservation[] = [],
  stampFooters = true
): void {
  if (!includeGlobalOverview) {
    if (stampFooters) writePortfolioFooters(w);
    return;
  }
  const { roleCounts, awards: allAwards } = portfolio;
  const awards = options.includeAwards ? allAwards : [];

  const roleEntries = ACTIVITY_ROLE_CODES.filter((c) => (roleCounts[c] ?? 0) > 0);
  if (options.includeRoles && roleEntries.length > 0) {
    writeMajorHeading(w, "전체 종합 정보 — 나의 역할", 24);
    flowText(w, RAW_COUNT_NOTE, { pt: 8.5, color: PF_COLOR.gray, lineH: 4.5 });
    w.y += 2;
    for (const code of roleEntries) flowText(w, `- ${ACTIVITY_ROLE_LABEL[code]}: ${roleCounts[code]}회`, { lineH: 6 });
  }

  if (options.includeAwards && awards.length > 0) {
    writeMajorHeading(w, "수상·발표 기록", 20);
    for (const award of awards) {
      needSpace(w, 12);
      flowText(w, `${award.award_name}${award.grade ? ` (${award.grade})` : ""}`, { pt: PF_PT.journalTitle, bold: true, color: PF_COLOR.navy, lineH: 5.6 });
      const meta = [award.competition, award.organizer, fmtDate(award.award_date)].filter(Boolean).join(" · ");
      if (meta) flowText(w, meta, { pt: 9, color: PF_COLOR.gray, lineH: 4.5 });
      w.y += 3;
    }
  }

  // 문서 실제 마지막 — pageNumbers()가 이 시점까지 그려진 페이지 전부를 스탬프하므로
  // 반드시 이 호출 직전에 그린다(그 뒤에 내용을 추가하면 번호가 안 찍힌다).
  writeTeacherObservationsSection(w, observations);
  if (stampFooters) writePortfolioFooters(w);
}

/** 프로젝트 하나의 본문(header → 연구 계획 → 연구 일지 → 나의 기록 → 결과 보고서 → [EVIDENCE])을
 * 이미 있는 PdfWriter에 순서대로 그린다. 프로젝트 시작만 새 페이지(호출부 담당)이고, 내부 section
 * 사이는 강제 page break 없이 writeMajorHeading()/writeField()의 orphan 방지(heading + 최소 본문 2줄)만 적용한다.
 * reportEvidence: 실제 제출 PDF가 이 문서 바로 뒤에 병합될 때만 true — 그때만 EVIDENCE 머리말을 그린다. */
async function writeProjectBody(
  w: PdfWriter,
  a: PortfolioActivity,
  index: number,
  options: PortfolioExportOptions,
  generatedAt: string,
  studentId: string,
  studentName: string,
  reportEvidence = false
): Promise<void> {
  writeProjectCover(w, a, index);

  const planPayload = options.includeProcess ? withPlanOptions(planPayloadFromActivity(a, generatedAt), options.includeFeedback) : null;
  const journalPayloadRaw = journalPayloadFromActivity(a, studentId, studentName, generatedAt);
  const journalPayload = options.includeLogs && journalPayloadRaw.entries.length > 0 ? withJournalOptions(journalPayloadRaw, options.includeFeedback) : null;
  const reportPayload = options.includeReport ? withReportOptions(reportPayloadFromActivity(a, generatedAt), options.includeFeedback) : null;
  const myRecordFields = options.includeMyRecords ? pfMyRecordFields(a, options.includeRoles) : [];
  const showEvidence = !!reportPayload && reportEvidence && options.includeSubmittedPdf;

  const hasPlan = !!planPayload && pfPlanFields(planPayload).length > 0;
  const hasReport = (!!reportPayload && pfReportFields(reportPayload).length > 0) || showEvidence;
  if (!hasPlan && !journalPayload && myRecordFields.length === 0 && !hasReport) {
    w.y += PF_MM.majorBefore;
    flowText(w, "(아직 계획서/연구일지/결과보고서가 없습니다.)", { pt: PF_PT.meta, color: PF_COLOR.gray });
    return;
  }

  if (planPayload) renderPlanSectionPDF(w, planPayload, true);
  if (journalPayload) await renderJournalSectionPDF(w, journalPayload, "plain", true);
  writeMyRecordBlock(w, myRecordFields);
  if (reportPayload) renderReportSectionPDF(w, reportPayload, true, showEvidence);
}

/** 기존 동작 그대로 — 병합 없는 단일 PdfWriter 문서(빠르고 네트워크 fetch 없음). 일괄(bulk) export가 여전히 이 경로를 쓴다. */
async function writePortfolioPDFContent(
  w: PdfWriter,
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  includeGlobalOverview = true,
  observations: TeacherObservation[] = []
): Promise<void> {
  const activities = filteredActivitiesOf(portfolio, options);
  writeFrontMatter(w, portfolio, options, activities, includeGlobalOverview, observations);

  const generatedAt = new Date().toISOString();
  const researchActivities = activities.filter(hasResearchStructure);
  for (const [idx, a] of researchActivities.entries()) {
    if (idx > 0 || includeGlobalOverview) w.newPage();
    await writeProjectBody(w, a, idx, options, generatedAt, portfolio.student.id, portfolio.student.name);
  }

  writeOtherActivitiesSection(w, activities.filter((a) => a.typeKey === "other"));
  writeClosingSections(w, portfolio, options, includeGlobalOverview, observations);
}

/** 화면에서 바로 저장(다운로드)하는 단일 학생용 — 기존 동작 그대로.
 * observations는 교사가 다른 학생을 내보낼 때만 호출부(PortfolioExportDialog)가 넘겨준다 —
 * 기본값 []이면 "교사 관찰 기록" section 자체가 그려지지 않아(writeTeacherObservationsSection이
 * 빈 배열을 그냥 return) 기존 학생 export 동작과 완전히 같다. */
export async function generateFullPortfolioPDF(
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  includeGlobalOverview = true,
  observations: TeacherObservation[] = []
): Promise<{ warnings: string[] }> {
  // "실제 제출 보고서 PDF"/"PDF 첨부자료"가 꺼져 있으면 fetch가 전혀 필요 없는 더
  // 가벼운 경로(writePortfolioPDFContent)를 그대로 쓴다 — 기본값(둘 다 켜짐)에서는
  // 병합 경로를 탄다.
  if (!options.includeSubmittedPdf && !options.includePdfAttachments) {
    // textSample=""이면 항상 한글 폰트를 임베드한다 — 학생/프로젝트 이름이 영문뿐이어도 본문 한글이 깨지지 않게.
    const w = await PdfWriter.create("", PORTFOLIO_LAYOUT);
    await writePortfolioPDFContent(w, portfolio, options, includeGlobalOverview, observations);
    w.save(`${fileBaseName(portfolio, includeGlobalOverview)}.pdf`);
    return { warnings: [] };
  }
  const { bytes, warnings } = await buildMergedPortfolioPdfBytes(portfolio, options, includeGlobalOverview, observations);
  const { saveAs } = await import("file-saver");
  saveAs(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${fileBaseName(portfolio, includeGlobalOverview)}.pdf`);
  return { warnings };
}

/** 여러 학생을 하나로 합칠 때(교사 일괄 export) 쓰는 bytes 버전 — 렌더링 내용은 위와 완전히 동일하다.
 * 학생 수만큼 실제 제출 PDF fetch가 늘어나는 걸 피하려고 일괄 export는 이 "병합 없는" 경로를 그대로 쓴다 —
 * 실제 제출 PDF 병합은 아래 buildMergedPortfolioPdfBytes(단일 학생 대화형 export 전용)에서만 한다. */
export async function buildFullPortfolioPDFBytes(
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  includeGlobalOverview = true,
  observations: TeacherObservation[] = []
): Promise<Uint8Array> {
  const w = await PdfWriter.create("", PORTFOLIO_LAYOUT);
  await writePortfolioPDFContent(w, portfolio, options, includeGlobalOverview, observations);
  return new Uint8Array(w.toBytes());
}

function mergeCandidateOf(file: AttachmentRef | null): AttachmentRef | null {
  return file && isPdfUrl(file.url) ? file : null;
}

async function fetchSubmittedPdfBytes(file: AttachmentRef): Promise<Uint8Array> {
  const { resolveSubmissionFileUrl } = await import("@/lib/uploads/submissionPdf");
  const url = await resolveSubmissionFileUrl(file.url);
  if (!url) throw new Error("접근 권한이 없거나 파일을 찾을 수 없습니다.");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

/** "Evidence" divider — 실제 제출 원본 PDF가 시작되는 지점(강제 새 페이지 예외 대상). */
async function dividerPdfBytes(title: string, subtitle: string): Promise<Uint8Array> {
  const w = await PdfWriter.create("", PORTFOLIO_LAYOUT);
  writeSmallLine(w, PF_SECTION.evidence, PF_PT.chip, true, PF_COLOR.orange, 0);
  writeSmallLine(w, title, PF_PT.basicHeading, true, PF_COLOR.navy, 2.6);
  writeSmallLine(w, subtitle, 9, false, PF_COLOR.gray, 2);
  return new Uint8Array(w.toBytes());
}

/**
 * 실제 제출 PDF(연구계획서/결과보고서 submittedFile, 선택 시 PDF 첨부자료)까지
 * 병합한 "통합 PDF"의 buffer 목록 — submission-export.ts의 exportAsMergedPdf와
 * 완전히 같은 방식(작은 PdfWriter 조각 + 실제 제출 PDF bytes를 순서대로 모았다가
 * mergePdfDocuments 한 번으로 합침)을 재사용한다. PDF → image → PDF 재렌더링 없음.
 * 개별 제출 PDF fetch 실패는 그 파일만 건너뛰고 warnings에 남긴다(전체 실패 금지).
 *
 * 프로젝트 A의 divider~report~제출PDF~첨부자료가 전부 끝난 뒤에만 프로젝트 B로
 * 넘어간다 — 자료 종류별로 흩어 놓지 않는다. includeGlobalOverview=false면 표지/
 * 종합정보 조각을 아예 만들지 않는다(빈 페이지 방지).
 */
export async function buildMergedPortfolioPdfBytes(
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  includeGlobalOverview = true,
  observations: TeacherObservation[] = []
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const { mergePdfDocuments } = await import("./common");
  const warnings: string[] = [];
  const buffers: Uint8Array[] = [];
  const activities = filteredActivitiesOf(portfolio, options);
  const generatedAt = new Date().toISOString();

  // isGenerated[i] — buffers[i]가 우리가 만든 페이지(표지/본문/구분)인지, 학생 제출 원본 PDF인지(푸터를 찍지 않는다).
  const isGenerated: boolean[] = [];
  const pushBuf = (buf: Uint8Array, generated: boolean) => {
    buffers.push(buf);
    isGenerated.push(generated);
  };

  if (includeGlobalOverview) {
    const front = await PdfWriter.create("", PORTFOLIO_LAYOUT);
    writeFrontMatter(front, portfolio, options, activities, includeGlobalOverview, observations);
    pushBuf(new Uint8Array(front.toBytes()), true);
  }

  const researchActivities = activities.filter(hasResearchStructure);
  for (const [idx, a] of researchActivities.entries()) {
    const projectTitle = representativeTitle(a);

    // 결과보고서 제출 PDF는 본문을 그리기 "전에" 가져온다 — 실제로 가져온 경우에만 본문 끝에
    // EVIDENCE 머리말을 붙이고 그 바로 뒤에 원본 PDF를 잇기 위해서다(fetch 실패 시 빈 EVIDENCE 금지).
    const reportPdf = options.includeReport && options.includeSubmittedPdf ? mergeCandidateOf(a.report?.submittedFile ?? null) : null;
    let reportPdfBytes: Uint8Array | null = null;
    if (reportPdf) {
      try {
        reportPdfBytes = await fetchSubmittedPdfBytes(reportPdf);
      } catch {
        warnings.push(`${projectTitle}의 결과보고서 제출 PDF를 통합 PDF에 포함하지 못했습니다.`);
      }
    }

    const projW = await PdfWriter.create("", PORTFOLIO_LAYOUT);
    await writeProjectBody(projW, a, idx, options, generatedAt, portfolio.student.id, portfolio.student.name, !!reportPdfBytes);
    pushBuf(new Uint8Array(projW.toBytes()), true);

    // ⑦ 학생 제출 원본 PDF — 결과보고서(EVIDENCE 머리말은 위 본문 마지막에 이미 있다)
    if (reportPdfBytes) pushBuf(reportPdfBytes, false);
    // ⑧ PDF 첨부자료 — 결과보고서
    if (options.includeReport && options.includePdfAttachments && a.report) {
      const extras = a.report.attachments.filter((att) => att !== a.report!.submittedFile && isPdfUrl(att.url));
      for (const att of extras) {
        try {
          const bytes = await fetchSubmittedPdfBytes(att);
          pushBuf(await dividerPdfBytes("PDF 첨부자료 — 결과보고서", `${projectTitle} · ${att.name}`), true);
          pushBuf(bytes, false);
        } catch {
          warnings.push(`${projectTitle}의 결과보고서 첨부 PDF "${att.name}"를 포함하지 못했습니다.`);
        }
      }
    }

    // ⑦ 학생 제출 원본 PDF — 계획서
    const planPdf = options.includeSubmittedPdf ? mergeCandidateOf(a.plan?.submittedFile ?? null) : null;
    if (planPdf) {
      try {
        // fetch를 먼저 성공시킨 뒤에만 구분선을 추가한다 — 순서를 바꾸면 fetch 실패 시
        // 내용 없는 "학생 제출 원본" 구분선 페이지만 덩그러니 남는다.
        const bytes = await fetchSubmittedPdfBytes(planPdf);
        pushBuf(await dividerPdfBytes("학생 제출 원본 — 연구계획서", `${projectTitle} · ${planPdf.name}`), true);
        pushBuf(bytes, false);
      } catch {
        warnings.push(`${projectTitle}의 연구계획서 제출 PDF를 통합 PDF에 포함하지 못했습니다.`);
      }
    }
    // ⑧ PDF 첨부자료 — 계획서
    if (options.includePdfAttachments && a.plan) {
      const extras = a.plan.attachments.filter((att) => att !== a.plan!.submittedFile && isPdfUrl(att.url));
      for (const att of extras) {
        try {
          const bytes = await fetchSubmittedPdfBytes(att);
          pushBuf(await dividerPdfBytes("PDF 첨부자료 — 연구계획서", `${projectTitle} · ${att.name}`), true);
          pushBuf(bytes, false);
        } catch {
          warnings.push(`${projectTitle}의 연구계획서 첨부 PDF "${att.name}"를 포함하지 못했습니다.`);
        }
      }
    }
  }

  const otherActivities = activities.filter((a) => a.typeKey === "other");
  if (otherActivities.length > 0) {
    const otherW = await PdfWriter.create("", PORTFOLIO_LAYOUT);
    writeOtherActivitiesSection(otherW, otherActivities);
    pushBuf(new Uint8Array(otherW.toBytes()), true);
  }

  if (includeGlobalOverview) {
    const closing = await PdfWriter.create("", PORTFOLIO_LAYOUT);
    writeClosingSections(closing, portfolio, options, includeGlobalOverview, observations, false);
    pushBuf(new Uint8Array(closing.toBytes()), true);
  }

  const merged = await mergePdfDocuments(buffers);
  for (const f of merged.failures) warnings.push(`PDF 조각 ${f.index + 1}번을 병합하지 못해 건너뛰었습니다.`);
  // 조각마다 별도 문서라 jsPDF 쪽 페이지 번호는 조각 기준이다 — 병합 후 통합 파일 기준으로 다시 찍는다.
  const bytes = await stampPortfolioFooters(merged.bytes, isGenerated, merged.pageCounts);
  return { bytes, warnings };
}

type DocxMod = Awaited<ReturnType<typeof loadDocx>>;

async function buildPortfolioDocxChildren(
  mod: DocxMod,
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  includeGlobalOverview = true,
  observations: TeacherObservation[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const { awards: allAwards, roleCounts } = portfolio;
  const activities = filteredActivitiesOf(portfolio, options);
  const awards = options.includeAwards ? allAwards : [];
  const generatedAt = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  if (includeGlobalOverview) {
    children.push(...docxCoverChildren(mod, portfolio, options.includeSummary));
    if (options.includeSummary && (activities.length > 0 || observations.length > 0)) {
      children.push(...docxJourneyChildren(mod, activities, observations));
    }
  }

  const researchActivities = activities.filter(hasResearchStructure);
  for (const [idx, a] of researchActivities.entries()) {
    // 각 PROJECT는 새 페이지에서 시작(pageBreakBefore — 빈 paragraph 없이). 내부 section 사이는 강제 page break 없음.
    children.push(...docxProjectCoverChildren(mod, a, idx, idx > 0 || includeGlobalOverview));

    const planPayload = options.includeProcess ? withPlanOptions(planPayloadFromActivity(a, generatedAt), options.includeFeedback) : null;
    const journalPayloadRaw = journalPayloadFromActivity(a, portfolio.student.id, portfolio.student.name, generatedAt);
    const journalPayload = options.includeLogs && journalPayloadRaw.entries.length > 0 ? withJournalOptions(journalPayloadRaw, options.includeFeedback) : null;
    const reportPayload = options.includeReport ? withReportOptions(reportPayloadFromActivity(a, generatedAt), options.includeFeedback) : null;
    const myRecordFields = options.includeMyRecords ? pfMyRecordFields(a, options.includeRoles) : [];

    const planChildren = planPayload ? buildPlanSectionChildren(mod, planPayload, true, PORTFOLIO_DOCX_SPACING) : [];
    const journalChildren = journalPayload ? await buildJournalSectionChildren(mod, journalPayload, "plain", true, PORTFOLIO_DOCX_SPACING) : [];
    const myRecordChildren = myRecordFields.length > 0 ? [pfMajorHeading(mod, PF_SECTION.myRecord), ...pfFields(mod, myRecordFields)] : [];
    const reportChildren = reportPayload ? buildReportSectionChildren(mod, reportPayload, true, PORTFOLIO_DOCX_SPACING) : [];

    const sections = [...planChildren, ...journalChildren, ...myRecordChildren, ...reportChildren];
    if (sections.length === 0) {
      const { p } = makeDocxHelpers(mod, PORTFOLIO_DOCX_SPACING);
      children.push(p("(아직 계획서/연구일지/결과보고서가 없습니다.)", false, "9ca3af"));
      continue;
    }
    children.push(...sections);
  }

  children.push(...docxOtherActivitiesChildren(mod, activities.filter((a) => a.typeKey === "other")));

  if (includeGlobalOverview) {
    const roleEntries = ACTIVITY_ROLE_CODES.filter((c) => (roleCounts[c] ?? 0) > 0);
    if (options.includeRoles && roleEntries.length > 0) {
      children.push(pfMajorHeading(mod, "전체 종합 정보 — 나의 역할"));
      children.push(pfSubNote(mod, RAW_COUNT_NOTE, 2));
      for (const code of roleEntries) children.push(...pfBody(mod, `- ${ACTIVITY_ROLE_LABEL[code]}: ${roleCounts[code]}회`));
    }

    if (awards.length > 0) {
      children.push(pfMajorHeading(mod, "수상·발표 기록"));
      for (const award of awards) {
        children.push(pfChipTitle(mod, null, `${award.award_name}${award.grade ? ` (${award.grade})` : ""}`, false));
        const meta = [award.competition, award.organizer, fmtDate(award.award_date)].filter(Boolean).join(" · ");
        if (meta) children.push(pfMeta(mod, meta));
      }
    }

    // 문서 실제 마지막 — 교사가 다른 학생을 내보낼 때만(observations 존재) 그려진다.
    children.push(...docxTeacherObservationsChildren(mod, observations));
  }

  return children;
}

/** 화면에서 바로 저장(다운로드)하는 단일 학생용 — 기존 동작 그대로. */
export async function generateFullPortfolioDOCX(
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  includeGlobalOverview = true,
  observations: TeacherObservation[] = []
): Promise<void> {
  const mod = await loadDocx();
  const { saveAs } = await import("file-saver");
  const { Packer } = mod;
  const children = await buildPortfolioDocxChildren(mod, portfolio, options, includeGlobalOverview, observations);
  const doc = pfDocument(mod, children);
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${fileBaseName(portfolio, includeGlobalOverview)}.docx`);
}

/** 여러 학생을 각각 개별 DOCX로 묶을 때(교사 일괄 ZIP export) 쓰는 Blob 버전. */
export async function buildFullPortfolioDOCXBlob(
  portfolio: StudentPortfolio,
  options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  includeGlobalOverview = true,
  observations: TeacherObservation[] = []
): Promise<Blob> {
  const mod = await loadDocx();
  const { Packer } = mod;
  const children = await buildPortfolioDocxChildren(mod, portfolio, options, includeGlobalOverview, observations);
  return await Packer.toBlob(pfDocument(mod, children));
}

const ZIP_TYPE_ABBR: Record<PortfolioTypeKey, string> = {
  rne: "RNE",
  individual: "창의개인연구",
  club: "동아리",
  other: "기타활동",
};

export interface PortfolioZipResult {
  blob: Blob;
  warnings: string[];
}

async function addAttachmentsToZipFolder(
  zip: import("jszip"),
  folderPath: string,
  attachments: AttachmentRef[],
  label: string,
  warnings: string[],
  resolveSubmissionFileUrl: (v: string | null | undefined) => Promise<string | null>,
  dedupeNames: (files: { name: string; url: string }[]) => string[]
): Promise<void> {
  if (attachments.length === 0) return;
  const dir = zip.folder(folderPath);
  const names = dedupeNames(attachments);
  for (const [i, att] of attachments.entries()) {
    try {
      const resolved = await resolveSubmissionFileUrl(att.url);
      if (!resolved) {
        warnings.push(`${label}의 "${att.name}" 파일을 가져오지 못했습니다.`);
        continue;
      }
      const resp = await fetch(resolved);
      if (!resp.ok) {
        warnings.push(`${label}의 "${att.name}" 파일을 가져오지 못했습니다.`);
        continue;
      }
      dir?.file(names[i], await resp.blob());
    } catch {
      warnings.push(`${label}의 "${att.name}" 파일을 가져오지 못했습니다.`);
    }
  }
}

/**
 * "원본 첨부파일까지 함께 받기"가 켜졌을 때만 쓰는 ZIP — 00_포트폴리오에는 format이
 * "pdf"면 병합 PDF(buildMergedPortfolioPdfBytes, 실제 제출 PDF까지 포함), "docx"면
 * 편집 가능한 DOCX를 그대로 넣는다. 나머지 폴더는 최종 문서와 같은 project-centric
 * 순서로 "NN_타입_학년도_프로젝트명/" 단일 폴더에 담는다(storage UUID 노출 없음) —
 * submission-pdfs 같은 private 값은 download.ts와 동일하게 resolveSubmissionFileUrl로
 * signed URL을 받아온다(getPublicUrl 재구현 금지).
 */
export async function buildPortfolioZipBlob(
  portfolio: StudentPortfolio,
  format: "pdf" | "docx",
  options: PortfolioExportOptions = DEFAULT_PORTFOLIO_EXPORT_OPTIONS,
  includeGlobalOverview = true,
  observations: TeacherObservation[] = []
): Promise<PortfolioZipResult> {
  const { default: JSZip } = await import("jszip");
  const { resolveSubmissionFileUrl } = await import("@/lib/uploads/submissionPdf");
  const { dedupeNames } = await import("@/lib/submissions/download");
  const warnings: string[] = [];
  const zip = new JSZip();

  if (format === "pdf") {
    const { bytes, warnings: pdfWarnings } = await buildMergedPortfolioPdfBytes(portfolio, options, includeGlobalOverview, observations);
    warnings.push(...pdfWarnings);
    zip.folder("00_포트폴리오")?.file(`${fileBaseName(portfolio, includeGlobalOverview)}.pdf`, bytes);
  } else {
    const blob = await buildFullPortfolioDOCXBlob(portfolio, options, includeGlobalOverview, observations);
    zip.folder("00_포트폴리오")?.file(`${fileBaseName(portfolio, includeGlobalOverview)}.docx`, blob);
  }

  const activities = filteredActivitiesOf(portfolio, options).filter(hasResearchStructure);
  for (const [idx, a] of activities.entries()) {
    const seq = String(idx + 1).padStart(2, "0");
    const projectTitle = representativeTitle(a);
    const activityDir = `${seq}_${ZIP_TYPE_ABBR[a.typeKey]}_${a.schoolYear ?? "미정"}_${sanitizeDownloadName(projectTitle)}`;
    if (options.includeProcess && a.plan) {
      await addAttachmentsToZipFolder(zip, `${activityDir}/연구계획서`, a.plan.attachments, `${projectTitle} 연구계획서`, warnings, resolveSubmissionFileUrl, dedupeNames);
    }
    if (options.includeReport && a.report) {
      await addAttachmentsToZipFolder(zip, `${activityDir}/결과보고서`, a.report.attachments, `${projectTitle} 결과보고서`, warnings, resolveSubmissionFileUrl, dedupeNames);
    }
    if (options.includeLogs) {
      for (const log of a.logs) {
        if (log.attachments.length === 0) continue;
        await addAttachmentsToZipFolder(zip, `${activityDir}/연구일지/${log.logDate}`, log.attachments, `${projectTitle} ${log.logDate} 연구일지`, warnings, resolveSubmissionFileUrl, dedupeNames);
      }
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, warnings };
}

export { fileBaseName as portfolioFileBaseName };
