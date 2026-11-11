import { ACTIVITY_ROLE_LABEL } from "@/lib/database.types";
import { buildImageParagraph, exportFileName, fmtDate, loadDocx, makeDocxHelpers, PdfWriter, PDF_FONT, PDF_COLORS, type DocxModule, type DocxSpacingConfig } from "./common";
import type { JournalExportPayload } from "./types";
import { PF_COLOR, PF_MM, PF_PT, PF_SECTION, pfJournalFields, pfJournalHeading, type PfField } from "./portfolio-layout";
import { fieldMinHeight, flowText, needSpace, setPfFont, wrapText, writeDivider, writeField, writeMajorHeading } from "./portfolio-pdf";
import { pfDivider, pfFields, pfJournalHeader, pfMajorHeading, pfSubNote, pfRun } from "./portfolio-docx";

export type JournalRenderVariant = "plain" | "timeline";

/**
 * 단독 내보내기와 "전체 내보내기"가 공유하는 연구일지 섹션 렌더러.
 * variant는 완전히 하위호환 — 기본값 "plain"은 기존 호출부(submission-export.ts 등)와
 * 100% 동일한 출력이고, "timeline"을 넘긴 곳(포트폴리오 렌더러)만 날짜 옆에
 * dot+연결선을 그린다.
 * @param compact true면 포트폴리오 전용 — 프로젝트 헤더에 이미 나온 title/기간을
 * 반복하지 않고 "연구 일지" 중제목만 그린다(renderPlanSectionPDF와 동일 규칙).
 */

/** 포트폴리오 canonical layout(PDF) — 연구 일지: "date · title" header → 작성자 → field(orange bar) 순서. card/timeline 없이 문서 흐름형. */
async function renderPortfolioJournalsPDF(w: PdfWriter, data: JournalExportPayload): Promise<void> {
  const entries = data.entries;
  if (entries.length === 0) return;
  const HEAD_LINE_H = 5.9;
  const WRITER_H = 4.5;

  const headingLines = (e: JournalExportPayload["entries"][number]) => {
    const h = pfJournalHeading(e);
    if (!h) return { h, lines: [] as string[] };
    const full = h.date && h.title ? `${h.date} · ${h.title}` : h.date || h.title;
    return { h, lines: wrapText(w, full, PF_PT.journalTitle, true) };
  };
  const minStart = (e: JournalExportPayload["entries"][number]) => {
    const fields = pfJournalFields(e);
    const { lines } = headingLines(e);
    return lines.length * HEAD_LINE_H + PF_MM.journalTitleToWriter - 1.6 + WRITER_H + 4.3 + (fields[0] ? fieldMinHeight(w, fields[0].value) : 0);
  };

  writeMajorHeading(w, PF_SECTION.journal, 6 + PF_MM.journalCountToDivider + PF_MM.dividerToJournal + minStart(entries[0]));
  w.y += PF_MM.journalCountGap - 6;
  flowText(w, `총 ${entries.length}건`, { pt: 9, color: PF_COLOR.gray, lineH: 4.5 });
  w.y += PF_MM.journalCountToDivider - 2.3;
  writeDivider(w);
  w.y += PF_MM.dividerToJournal;

  for (const [i, entry] of entries.entries()) {
    if (i > 0) {
      // 앞 journal 끝 → 8mm → divider → 7.5mm → 다음 journal. 다음 journal 시작부가 이 페이지에 안 들어가면
      // divider 없이 새 페이지 맨 위에서 시작한다(divider만 페이지 하단에 남는 것 방지).
      w.y += PF_MM.journalToDivider - 1.7;
      if (w.y + PF_MM.dividerToJournal + minStart(entry) > w.pageH - w.marginBottom) {
        w.newPage();
      } else {
        writeDivider(w);
        w.y += PF_MM.dividerToJournal;
      }
    } else {
      needSpace(w, minStart(entry));
    }

    const { h, lines } = headingLines(entry);
    if (h) {
      lines.forEach((line, li) => {
        const baseline = w.y + HEAD_LINE_H / 2 + PF_PT.journalTitle * 0.3528 * 0.36;
        if (li === 0 && h.date && line.startsWith(h.date)) {
          setPfFont(w, PF_PT.journalTitle, true, PF_COLOR.orange);
          w.doc.text(h.date, w.margin, baseline);
          const dateW = w.doc.getTextWidth(h.date) as number;
          setPfFont(w, PF_PT.journalTitle, true, PF_COLOR.navy);
          w.doc.text(line.slice(h.date.length), w.margin + dateW, baseline);
        } else {
          setPfFont(w, PF_PT.journalTitle, true, PF_COLOR.navy);
          w.doc.text(line, w.margin, baseline);
        }
        w.y += HEAD_LINE_H;
      });
      w.y += PF_MM.journalTitleToWriter - 1.6;
    }
    // 작성자: 이름
    const wBaseline = w.y + WRITER_H / 2 + PF_PT.journalWriter * 0.3528 * 0.36;
    setPfFont(w, PF_PT.journalWriter, true, PF_COLOR.navy);
    w.doc.text(PF_SECTION.writer, w.margin, wBaseline);
    const labelW = w.doc.getTextWidth(PF_SECTION.writer) as number;
    setPfFont(w, PF_PT.journalWriter, false, PF_COLOR.gray);
    w.doc.text(entry.authorName, w.margin + labelW + 1.2, wBaseline);
    w.y += WRITER_H + 4.3;

    const fields: PfField[] = pfJournalFields(entry);
    if (entry.teacherFeedback) fields.push({ label: "교사 피드백", value: entry.teacherFeedback });
    const hasExtras = entry.images.length > 0 || entry.files.length > 0;
    fields.forEach((f, fi) => writeField(w, f.label, f.value, fi === fields.length - 1 && !hasExtras));
    for (const img of entry.images) await w.imageProportional(img.url);
    for (const f of entry.files) flowText(w, `[첨부] ${f.name}`, { pt: 9, color: PF_COLOR.gray, lineH: 5 });
  }
}

export async function renderJournalSectionPDF(w: PdfWriter, data: JournalExportPayload, variant: JournalRenderVariant = "plain", compact = false): Promise<void> {
  if (compact) {
    await renderPortfolioJournalsPDF(w, data);
    return;
  }
  if (!compact) {
    w.line(data.entityName, 20, true);
    w.spacer(1);
    w.line("연구일지", 12, false, "#6b7280");
    if (data.periodLabel) w.line(data.periodLabel, 11, false, "#6b7280");
    w.line(`총 ${data.entries.length}건`, 10, false, "#9ca3af");
    w.spacer(3);
    w.hline();
  } else {
    w.line("연구 일지", PDF_FONT.h2, true, PDF_COLORS.primary);
    w.line(`총 ${data.entries.length}건`, PDF_FONT.footer, false, PDF_COLORS.secondary);
    w.spacer(4);
  }

  if (data.entries.length === 0) {
    w.line("등록된 연구일지가 없습니다.", 11, false, "#9ca3af");
  }

  const timeline = variant === "timeline";
  const indent = 6;
  if (timeline) {
    w.margin += indent;
    w.contentW -= indent;
  }
  let prevDotY: number | null = null;

  for (const entry of data.entries) {
    w.checkPage(20);
    if (timeline) {
      const dotX = w.margin - indent + 2;
      const dotY = w.y + 2;
      if (prevDotY !== null) w.vline(dotX, prevDotY + 1.5, dotY - 1.5);
      w.dot(dotX, dotY);
      prevDotY = dotY;
    }
    w.line(entry.date ? `${fmtDate(entry.date)}  ·  ${entry.title || "(제목 없음)"}` : entry.title || "(제목 없음)", 13, true, "#0ea5e9");
    if (compact) w.spacer(1); // heading→작성자: line()의 자동 2mm + 1mm ≈ 3mm
    w.labeledLine("작성자", entry.authorName, 9.5);
    w.spacer(compact ? 3 : 1); // compact: 작성자→본문 필드 5mm 확보

    for (const { label, value } of entry.fields) {
      w.line(label, 10.5, true);
      w.line(value, 10);
      w.spacer(1);
    }

    for (const img of entry.images) {
      await w.imageProportional(img.url);
    }
    for (const f of entry.files) {
      w.line(`[첨부] ${f.name}`, 9, false, "#6b7280");
    }

    if (entry.participants.length > 0) {
      w.spacer(1);
      w.line("참여자별 역할", 10.5, true);
      for (const part of entry.participants) {
        const roleText = part.roles.length > 0 ? part.roles.map((r) => ACTIVITY_ROLE_LABEL[r]).join(" / ") : "역할 미입력";
        w.line(`- ${part.name}: ${roleText}`, 9.5);
        if (part.roleDescription) w.line(`   "${part.roleDescription}"`, 9, false, "#6b7280");
      }
    }

    if (entry.teacherFeedback) {
      w.spacer(1);
      w.line(`교사 피드백: ${entry.teacherFeedback}`, 9.5, false, "#b45309");
    }

    w.spacer(2);
    w.hline();
    if (compact) w.spacer(2); // divider→다음 entry heading: hline 자체 4mm + 2mm ≈ 6mm
  }

  if (timeline) {
    w.margin -= indent;
    w.contentW += indent;
  }
}

export async function generateJournalExportPDF(data: JournalExportPayload): Promise<void> {
  const w = await PdfWriter.create(JSON.stringify(data));
  await renderJournalSectionPDF(w, data);
  w.pageNumbers();
  w.save(exportFileName(data.entityKind, data.entityName, "연구일지", "pdf"));
}


/** 포트폴리오 canonical layout(DOCX) — renderPortfolioJournalsPDF와 같은 순서/라벨. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildPortfolioJournalChildren(mod: DocxModule, data: JournalExportPayload): Promise<any[]> {
  if (data.entries.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [pfMajorHeading(mod, PF_SECTION.journal), pfSubNote(mod, `총 ${data.entries.length}건`, PF_MM.journalCountToDivider - 3), pfDivider(mod)];
  for (const [i, entry] of data.entries.entries()) {
    if (i > 0) children.push(pfDivider(mod));
    children.push(...pfJournalHeader(mod, pfJournalHeading(entry), entry.authorName));
    const fields: PfField[] = pfJournalFields(entry);
    if (entry.teacherFeedback) fields.push({ label: "교사 피드백", value: entry.teacherFeedback });
    children.push(...pfFields(mod, fields));
    for (const img of entry.images) {
      const para = await buildImageParagraph(mod, img.url);
      if (para) children.push(para);
    }
    for (const f of entry.files) children.push(new mod.Paragraph({ spacing: { after: 40 }, children: [pfRun(mod, `[첨부] ${f.name}`, { pt: 9, color: PF_COLOR.gray })] }));
  }
  return children;
}

/** 단독 내보내기와 "전체 내보내기"가 공유하는 연구일지 섹션의 docx children. variant는 renderJournalSectionPDF와 동일한 하위호환 규칙.
 * compact/spacingConfig 의미는 buildPlanSectionChildren과 동일(포트폴리오 전용). */
export async function buildJournalSectionChildren(
  mod: DocxModule,
  data: JournalExportPayload,
  variant: JournalRenderVariant = "plain",
  compact = false,
  spacingConfig: DocxSpacingConfig = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const { Paragraph, TextRun } = mod;
  const { h1, h2, p, labeledP, divider, timelineHeading } = makeDocxHelpers(mod, spacingConfig);

  if (compact) return await buildPortfolioJournalChildren(mod, data);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  if (!compact) {
    children.push(h1(data.entityName));
    children.push(p("연구일지", false, "6b7280"));
    if (data.periodLabel) children.push(p(data.periodLabel, false, "6b7280"));
    children.push(p(`총 ${data.entries.length}건`, false, "9ca3af"));
    children.push(divider());
  } else {
    children.push(h2("연구 일지"));
    children.push(p(`총 ${data.entries.length}건`, false, "6B7280", 16));
  }

  if (data.entries.length === 0) {
    children.push(p("등록된 연구일지가 없습니다.", false, "9ca3af"));
  }

  for (const entry of data.entries) {
    const heading = entry.date ? `${fmtDate(entry.date)}  ·  ${entry.title || "(제목 없음)"}` : entry.title || "(제목 없음)";
    children.push(
      variant === "timeline"
        ? timelineHeading(heading)
        : new Paragraph({
            children: [new TextRun({ text: heading, bold: true, color: "0ea5e9", size: 24 })],
            spacing: { before: 200, after: 40 },
          })
    );
    children.push(labeledP("작성자", entry.authorName));

    for (const { label, value } of entry.fields) {
      children.push(new Paragraph({ text: label, spacing: { before: 80, after: 20 } }));
      children.push(p(value));
    }

    for (const img of entry.images) {
      const para = await buildImageParagraph(mod, img.url);
      if (para) children.push(para);
    }
    for (const f of entry.files) {
      children.push(p(`[첨부] ${f.name}`, false, "6b7280"));
    }

    if (entry.participants.length > 0) {
      children.push(new Paragraph({ text: "참여자별 역할", spacing: { before: 100, after: 20 } }));
      for (const part of entry.participants) {
        const roleText = part.roles.length > 0 ? part.roles.map((r) => ACTIVITY_ROLE_LABEL[r]).join(" / ") : "역할 미입력";
        children.push(p(`- ${part.name}: ${roleText}`));
        if (part.roleDescription) children.push(p(`   "${part.roleDescription}"`, false, "6b7280"));
      }
    }

    if (entry.teacherFeedback) {
      children.push(p(`교사 피드백: ${entry.teacherFeedback}`, false, "b45309"));
    }

    children.push(divider());
  }

  return children;
}

export async function generateJournalExportDOCX(data: JournalExportPayload): Promise<void> {
  const mod = await loadDocx();
  const { saveAs } = await import("file-saver");
  const { Document, Packer } = mod;

  const children = await buildJournalSectionChildren(mod, data);
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, exportFileName(data.entityKind, data.entityName, "연구일지", "docx"));
}
