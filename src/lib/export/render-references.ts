import { exportFileName, fmtDate, loadDocx, makeDocxHelpers, PdfWriter, type DocxModule } from "./common";
import type { ReferencesExportPayload } from "./types";

// 참고자료 내보내기는 첨부 파일 내용을 병합하지 않는다 — 등록된 자료의 메타데이터 목록(카탈로그)이다.

/** 단독 내보내기와 "전체 내보내기"가 공유하는 참고자료 섹션 렌더러. */
export function renderReferencesSectionPDF(w: PdfWriter, data: ReferencesExportPayload): void {
  w.line(data.entityName, 20, true);
  w.spacer(1);
  w.line("참고 자료 목록", 12, false, "#6b7280");
  if (data.periodLabel) w.line(data.periodLabel, 11, false, "#6b7280");
  w.line(`총 ${data.items.length}건`, 10, false, "#9ca3af");
  w.spacer(3);
  w.hline();

  if (data.items.length === 0) {
    w.line("등록된 참고 자료가 없습니다.", 11, false, "#9ca3af");
  }

  data.items.forEach((item, i) => {
    w.checkPage(20);
    w.line(`${i + 1}. ${item.title}`, 12, true);
    if (item.authors) w.labeledLine("저자", item.authors, 10);
    if (item.source) w.labeledLine("출처", item.source, 10);
    if (item.url) w.labeledLine("URL", item.url, 9.5);
    if (item.fileName) w.labeledLine("첨부 파일", item.fileName, 9.5);
    if (item.memo) w.labeledLine("메모", item.memo, 9.5);
    if (item.createdByName) w.labeledLine("등록자", item.createdByName, 9);
    w.line(`등록일: ${fmtDate(item.createdAt)}`, 9, false, "#9ca3af");
    w.spacer(2);
    w.hline();
  });
}

export async function generateReferencesExportPDF(data: ReferencesExportPayload): Promise<void> {
  const w = await PdfWriter.create(JSON.stringify(data));
  renderReferencesSectionPDF(w, data);
  w.pageNumbers();
  w.save(exportFileName(data.entityKind, data.entityName, "참고자료", "pdf"));
}

/** 단독 내보내기와 "전체 내보내기"가 공유하는 참고자료 섹션의 docx children. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildReferencesSectionChildren(mod: DocxModule, data: ReferencesExportPayload): any[] {
  const { h1, p, labeledP, divider } = makeDocxHelpers(mod);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  children.push(h1(data.entityName));
  children.push(p("참고 자료 목록", false, "6b7280"));
  if (data.periodLabel) children.push(p(data.periodLabel, false, "6b7280"));
  children.push(p(`총 ${data.items.length}건`, false, "9ca3af"));
  children.push(divider());

  if (data.items.length === 0) {
    children.push(p("등록된 참고 자료가 없습니다.", false, "9ca3af"));
  }

  data.items.forEach((item, i) => {
    children.push(p(`${i + 1}. ${item.title}`, true, "111827", 24));
    if (item.authors) children.push(labeledP("저자", item.authors));
    if (item.source) children.push(labeledP("출처", item.source));
    if (item.url) children.push(labeledP("URL", item.url));
    if (item.fileName) children.push(labeledP("첨부 파일", item.fileName));
    if (item.memo) children.push(labeledP("메모", item.memo));
    if (item.createdByName) children.push(labeledP("등록자", item.createdByName));
    children.push(p(`등록일: ${fmtDate(item.createdAt)}`, false, "9ca3af", 18));
    children.push(divider());
  });

  return children;
}

export async function generateReferencesExportDOCX(data: ReferencesExportPayload): Promise<void> {
  const mod = await loadDocx();
  const { saveAs } = await import("file-saver");
  const { Document, Packer } = mod;

  const children = buildReferencesSectionChildren(mod, data);
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, exportFileName(data.entityKind, data.entityName, "참고자료", "docx"));
}
