import { STATUS_LABEL } from "@/lib/status";
import { reportDisplayFields } from "@/lib/report-fields";
import { exportFileName, fmtDate, loadDocx, makeDocxHelpers, PdfWriter, type DocxModule, type DocxSpacingConfig } from "./common";
import type { ReportExportPayload } from "./types";
import { PF_COLOR, PF_MM, PF_PT, PF_SECTION, pfReportFields } from "./portfolio-layout";
import { ascentMm, fieldMinHeight, needSpace, setPfFont, writeFields, writeMajorHeading } from "./portfolio-pdf";
import { pfFields, pfMajorHeading } from "./portfolio-docx";

const ENTITY_LABEL: Record<ReportExportPayload["entityKind"], string> = {
  rne: "R&E",
  club: "동아리",
  individual: "창의개인연구",
};

// 결과보고서의 실제 본문은 교사가 검토하는 업로드 원본 파일(pdf/hwp/doc/docx)에 있고,
// summary는 DB에 별도 저장된 요약 텍스트일 뿐이다. 원본 파일 형식이 임의적이라(특히 hwp)
// 내용을 신뢰성 있게 추출/재구성할 수 없으므로, 이 문서는 "제출 메타데이터 + 요약 확인서"로
// 만들고 원본 파일은 항상 별도 다운로드하도록 안내한다.
const CASE_B_NOTE =
  "본 문서는 결과보고서 제출 현황을 정리한 요약본입니다. 결과보고서 본문 전체는 첨부된 원본 파일에서 확인하세요.";

/** 단독 내보내기와 "전체 내보내기"가 공유하는 결과보고서 섹션 렌더러.
 * @param compact true면 포트폴리오 project-centric 렌더러 전용 — 프로젝트 헤더에 이미
 * 나온 title/학년도/지도교사/팀원/상태를 반복하지 않는다(renderPlanSectionPDF와 동일 규칙). */
export function renderReportSectionPDF(w: PdfWriter, data: ReportExportPayload, compact = false, showEvidence = false): void {
  if (compact) {
    // 포트폴리오 canonical layout — 서론/결론(legacy는 "연구 요약 (기존 데이터)") + 교사 검토 의견.
    // showEvidence는 실제 제출 PDF가 이 문서 뒤에 병합될 때만 true — 그때만 EVIDENCE 머리말을 붙인다.
    const fields = pfReportFields(data);
    if (fields.length === 0 && !showEvidence) return;
    writeMajorHeading(w, PF_SECTION.report, fields.length > 0 ? fieldMinHeight(w, fields[0].value) : 12);
    writeFields(w, fields);
    if (showEvidence) {
      const headH = ascentMm(PF_PT.chip) + 2.6 + ascentMm(PF_PT.basicHeading) + 2;
      if (fields.length > 0) w.y += PF_MM.reportToEvidence;
      needSpace(w, headH);
      setPfFont(w, PF_PT.chip, true, PF_COLOR.orange);
      w.doc.text(PF_SECTION.evidence, w.margin, w.y + ascentMm(PF_PT.chip));
      w.y += ascentMm(PF_PT.chip) + 2.6 + ascentMm(PF_PT.basicHeading);
      setPfFont(w, PF_PT.basicHeading, true, PF_COLOR.navy);
      w.doc.text(PF_SECTION.evidenceTitle, w.margin, w.y);
      w.y += 2;
    }
    return;
  }
  if (!compact) {
    w.line(data.title || data.entityName, 20, true);
    w.spacer(1);
    w.line(`결과보고서 · ${ENTITY_LABEL[data.entityKind]}`, 12, false, "#6b7280");
    if (data.periodLabel) w.line(data.periodLabel, 11, false, "#6b7280");
    w.spacer(3);
    w.hline();

    w.line("기본 정보", 13, true);
    if (data.teacherName) w.labeledLine("지도교사", data.teacherName, 10.5);
    if (data.members.length > 0) w.labeledLine(data.entityKind === "individual" ? "학생" : "팀원", data.members.join(", "), 10.5);
    w.labeledLine("상태", STATUS_LABEL[data.status] ?? data.status, 10.5);
    if (data.submittedAt) w.labeledLine("제출일", fmtDate(data.submittedAt), 10.5);
    w.spacer(3);
    w.hline();
  }
  const fields = reportDisplayFields(data);
  for (const [i, field] of fields.entries()) {
    if (i > 0) w.spacer(3);
    w.line(field.label, 13, true);
    w.spacer(1);
    w.line(field.value, 10.5);
  }

  w.spacer(2);
  w.hline();
  w.line("첨부 파일", 13, true);
  if (data.primaryFile) w.line(`- [원본] ${data.primaryFile.name}`, 10.5, false, "#0ea5e9");
  else w.line("- 첨부된 원본 파일이 없습니다.", 10.5, false, "#9ca3af");
  for (const f of data.extraFiles) w.line(`- ${f.name}`, 10, false, "#6b7280");

  if (data.feedback) {
    w.spacer(2);
    w.hline();
    w.line("지도교사 검토 의견", 13, true);
    w.line(data.feedback, 10.5);
  }

  w.spacer(3);
  w.line(CASE_B_NOTE, 9, false, "#9ca3af");
}

export async function generateReportExportPDF(data: ReportExportPayload): Promise<void> {
  const w = await PdfWriter.create(JSON.stringify(data));
  renderReportSectionPDF(w, data);
  w.pageNumbers();
  w.save(exportFileName(data.entityKind, data.entityName, "결과보고서_요약", "pdf"));
}

/** 단독 내보내기와 "전체 내보내기"가 공유하는 결과보고서 섹션의 docx children.
 * compact/spacingConfig 의미는 buildPlanSectionChildren과 동일(포트폴리오 전용). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildReportSectionChildren(mod: DocxModule, data: ReportExportPayload, compact = false, spacingConfig: DocxSpacingConfig = {}): any[] {
  const { h1, h2, p, labeledP, divider } = makeDocxHelpers(mod, spacingConfig);

  if (compact) {
    // PDF와 동일한 hierarchy — EVIDENCE는 실제 PDF를 병합하는 PDF export에서만 나오므로 DOCX에는 없다.
    const fields = pfReportFields(data);
    if (fields.length === 0) return [];
    return [pfMajorHeading(mod, PF_SECTION.report), ...pfFields(mod, fields)];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  if (!compact) {
    children.push(h1(data.title || data.entityName));
    children.push(p(`결과보고서 · ${ENTITY_LABEL[data.entityKind]}`, false, "6b7280"));
    if (data.periodLabel) children.push(p(data.periodLabel, false, "6b7280"));
    children.push(divider());

    children.push(h2("기본 정보"));
    if (data.teacherName) children.push(labeledP("지도교사", data.teacherName));
    if (data.members.length > 0) children.push(labeledP(data.entityKind === "individual" ? "학생" : "팀원", data.members.join(", ")));
    children.push(labeledP("상태", STATUS_LABEL[data.status] ?? data.status));
    if (data.submittedAt) children.push(labeledP("제출일", fmtDate(data.submittedAt)));
    children.push(divider());

    for (const field of reportDisplayFields(data)) {
      children.push(h2(field.label));
      children.push(p(field.value));
    }
    children.push(divider());

    children.push(h2("첨부 파일"));
    if (data.primaryFile) children.push(p(`- [원본] ${data.primaryFile.name}`, false, "0ea5e9"));
    else children.push(p("- 첨부된 원본 파일이 없습니다.", false, "9ca3af"));
    for (const f of data.extraFiles) children.push(p(`- ${f.name}`, false, "6b7280"));

    if (data.feedback) {
      children.push(divider());
      children.push(h2("지도교사 검토 의견"));
      children.push(p(data.feedback));
    }

    children.push(p(CASE_B_NOTE, false, "9ca3af", 18));
  }

  return children;
}

export async function generateReportExportDOCX(data: ReportExportPayload): Promise<void> {
  const mod = await loadDocx();
  const { saveAs } = await import("file-saver");
  const { Document, Packer } = mod;

  const children = buildReportSectionChildren(mod, data);
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, exportFileName(data.entityKind, data.entityName, "결과보고서_요약", "docx"));
}
