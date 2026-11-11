import { STATUS_LABEL } from "@/lib/status";
import { exportFileName, fileNameFromUrl, fmtDate, loadDocx, makeDocxHelpers, PdfWriter, type DocxModule, type DocxSpacingConfig } from "./common";
import type { PlanExportPayload } from "./types";
import { pfPlanFields, PF_SECTION } from "./portfolio-layout";
import { fieldMinHeight, writeFields, writeMajorHeading } from "./portfolio-pdf";
import { pfFields, pfMajorHeading } from "./portfolio-docx";

const ENTITY_LABEL: Record<PlanExportPayload["entityKind"], string> = {
  rne: "R&E",
  club: "동아리",
  individual: "창의개인연구",
};

/**
 * 연구계획서 섹션을 이미 존재하는 PdfWriter에 그린다 — 단독 내보내기와 "전체 내보내기"가
 * 완전히 동일한 함수를 공유한다(별도 문서를 새로 그리지 않음).
 * @param compact true면 포트폴리오 project-centric 렌더러 전용 — 프로젝트 헤더에 이미
 * 나온 title/학년도/지도교사/팀원/상태를 반복하지 않고, "연구 계획" 중제목(hierarchy상
 * h2)만 그린 뒤 바로 본문으로 들어간다. 제출일처럼 section-specific 정보만 heading
 * 아래 작은 metadata로 남긴다. 단독 내보내기(compact=false, 기본값)는 기존 그대로.
 */
export function renderPlanSectionPDF(w: PdfWriter, data: PlanExportPayload, compact = false): void {
  if (compact) {
    // 포트폴리오 canonical layout — 연구 동기 및 목적/연구 방법/기대 결과(+교사 검토 의견). 제출일/상태/첨부 목록은 넣지 않는다.
    const fields = pfPlanFields(data);
    if (fields.length === 0) return;
    writeMajorHeading(w, PF_SECTION.plan, fieldMinHeight(w, fields[0].value));
    writeFields(w, fields);
    return;
  }
  if (!compact) {
    w.line(data.title || data.entityName, 20, true);
    w.spacer(1);
    w.line(`연구계획서 · ${ENTITY_LABEL[data.entityKind]}`, 12, false, "#6b7280");
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

  const SECTIONS: { label: string; value: string | null }[] = [
    { label: "연구 동기 및 목적", value: data.motivation },
    { label: "연구 방법", value: data.method },
    { label: "기대 결과", value: data.expectedResult },
  ];
  if (!compact) {
    w.line("연구 계획", 13, true);
    w.spacer(1);
  }
  let any = false;
  for (const { label, value } of SECTIONS) {
    if (!value) continue;
    any = true;
    w.line(label, 11, true, "#0ea5e9");
    w.line(value, 10.5);
    w.spacer(2);
  }
  if (!any) w.line("(작성된 내용이 없습니다)", 10.5, false, "#9ca3af");

  if (data.feedback) {
    w.spacer(2);
    w.hline();
    w.line("지도교사 검토 의견", 13, true);
    w.line(data.feedback, 10.5);
  }

  if (data.fileUrls.length > 0) {
    w.spacer(2);
    w.hline();
    w.line("첨부 파일", 13, true);
    for (const url of data.fileUrls) w.line(`- ${fileNameFromUrl(url)}`, 10, false, "#6b7280");
  }
}

export async function generatePlanExportPDF(data: PlanExportPayload): Promise<void> {
  const w = await PdfWriter.create(JSON.stringify(data));
  renderPlanSectionPDF(w, data);
  w.pageNumbers();
  w.save(exportFileName(data.entityKind, data.entityName, "연구계획서", "pdf"));
}

/** 연구계획서 섹션의 docx children — 단독 내보내기와 "전체 내보내기"가 동일한 함수를 공유한다.
 * compact/spacingConfig 의미는 renderPlanSectionPDF와 동일(포트폴리오 전용). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildPlanSectionChildren(mod: DocxModule, data: PlanExportPayload, compact = false, spacingConfig: DocxSpacingConfig = {}): any[] {
  const { Paragraph } = mod;
  const { h1, h2, p, labeledP, divider } = makeDocxHelpers(mod, spacingConfig);
  if (compact) {
    const fields = pfPlanFields(data);
    if (fields.length === 0) return [];
    return [pfMajorHeading(mod, PF_SECTION.plan), ...pfFields(mod, fields)];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  if (!compact) {
    children.push(h1(data.title || data.entityName));
    children.push(p(`연구계획서 · ${ENTITY_LABEL[data.entityKind]}`, false, "6b7280"));
    if (data.periodLabel) children.push(p(data.periodLabel, false, "6b7280"));
    children.push(divider());

    children.push(h2("기본 정보"));
    if (data.teacherName) children.push(labeledP("지도교사", data.teacherName));
    if (data.members.length > 0) children.push(labeledP(data.entityKind === "individual" ? "학생" : "팀원", data.members.join(", ")));
    children.push(labeledP("상태", STATUS_LABEL[data.status] ?? data.status));
    if (data.submittedAt) children.push(labeledP("제출일", fmtDate(data.submittedAt)));
    children.push(divider());

    children.push(h2("연구 계획"));
  }
  const SECTIONS: { label: string; value: string | null }[] = [
    { label: "연구 동기 및 목적", value: data.motivation },
    { label: "연구 방법", value: data.method },
    { label: "기대 결과", value: data.expectedResult },
  ];
  const any = SECTIONS.some((s) => s.value);
  if (!any) children.push(p("(작성된 내용이 없습니다)", false, "9ca3af"));
  for (const { label, value } of SECTIONS) {
    if (!value) continue;
    children.push(new Paragraph({ text: label, spacing: { before: 120, after: 40 } }));
    children.push(p(value));
  }

  if (data.feedback) {
    children.push(divider());
    children.push(h2("지도교사 검토 의견"));
    children.push(p(data.feedback));
  }

  if (data.fileUrls.length > 0) {
    children.push(divider());
    children.push(h2("첨부 파일"));
    for (const url of data.fileUrls) children.push(p(`- ${fileNameFromUrl(url)}`, false, "6b7280"));
  }

  return children;
}

export async function generatePlanExportDOCX(data: PlanExportPayload): Promise<void> {
  const mod = await loadDocx();
  const { saveAs } = await import("file-saver");
  const { Document, Packer } = mod;

  const children = buildPlanSectionChildren(mod, data);
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, exportFileName(data.entityKind, data.entityName, "연구계획서", "docx"));
}
