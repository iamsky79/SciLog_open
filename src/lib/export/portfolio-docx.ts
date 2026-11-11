import type { DocxModule } from "./common";
import { mmToTwips, PF_COLOR, PF_MM, PF_PAGE, PF_PT, type PfField } from "./portfolio-layout";

// 포트폴리오 PROJECT 본문 DOCX primitive — portfolio-pdf.ts와 같은 PF_* 값(색/pt/mm)을
// twips/half-point로 환산해 쓴다. Word pagination을 PDF에 맞추려고 빈 paragraph/수동
// 줄바꿈을 넣지 않고, keepNext/keepLines/widowControl만 쓴다.

export const PF_FONT_FAMILY = "Noto Sans KR";
const hex = (c: string): string => c.replace("#", "");
const halfPt = (pt: number): number => Math.round(pt * 2);
const ptToTwips = (pt: number): number => Math.round(pt * 20);

export interface PfRunOpts {
  pt: number;
  bold?: boolean;
  color?: string;
  shadingFill?: string;
}

export function pfRun(mod: DocxModule, text: string, o: PfRunOpts) {
  return new mod.TextRun({
    text,
    bold: o.bold ?? false,
    size: halfPt(o.pt),
    color: hex(o.color ?? PF_COLOR.body),
    font: { ascii: PF_FONT_FAMILY, eastAsia: PF_FONT_FAMILY, hAnsi: PF_FONT_FAMILY },
    ...(o.shadingFill ? { shading: { type: mod.ShadingType.CLEAR, fill: hex(o.shadingFill), color: "auto" } } : {}),
  });
}

/** 문서 기본 font/A4/22mm 여백/하단 중앙 "현재 / 전체" footer를 가진 Document. */
export function pfDocument(mod: DocxModule, children: unknown[]) {
  const { Document, Footer, Paragraph, TextRun, PageNumber, AlignmentType } = mod;
  const fontProps = { ascii: PF_FONT_FAMILY, eastAsia: PF_FONT_FAMILY, hAnsi: PF_FONT_FAMILY };
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], size: halfPt(PF_PT.footerCurrent), color: hex(PF_COLOR.body), font: fontProps }),
          new TextRun({ children: [" / ", PageNumber.TOTAL_PAGES], size: halfPt(PF_PT.footerTotal), color: hex(PF_COLOR.footerMuted), font: fontProps }),
        ],
      }),
    ],
  });
  return new Document({
    styles: { default: { document: { run: { font: fontProps, size: halfPt(PF_PT.body) } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: mmToTwips(PF_MM.pageW), height: mmToTwips(PF_MM.pageH) },
            margin: {
              top: mmToTwips(PF_MM.marginTop),
              bottom: mmToTwips(PF_MM.marginBottom),
              left: mmToTwips(PF_MM.margin),
              right: mmToTwips(PF_MM.margin),
              footer: mmToTwips(PF_MM.footerFromBottom - 3),
            },
          },
        },
        footers: { default: footer },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children: children as any[],
      },
    ],
  });
}

/** PROJECT NN — 위쪽 3pt orange line(paragraph top border) + 새 페이지 시작. */
export function pfProjectHeader(mod: DocxModule, index: number, pageBreakBefore: boolean) {
  const { Paragraph, BorderStyle } = mod;
  return new Paragraph({
    pageBreakBefore,
    keepNext: true,
    border: { top: { style: BorderStyle.SINGLE, size: PF_MM.topRulePt * 8, color: hex(PF_COLOR.orange), space: Math.round(PF_MM.topRuleToLabel / 0.3528) } },
    spacing: { before: 0, after: mmToTwips(1) },
    children: [pfRun(mod, `PROJECT ${String(index + 1).padStart(2, "0")}`, { pt: PF_PT.projectNo, bold: true, color: PF_COLOR.orange })],
  });
}

export function pfChips(mod: DocxModule, chips: { text: string; bg: string; fg: string }[]) {
  const runs = chips.flatMap((c, i) => [
    ...(i > 0 ? [pfRun(mod, " ", { pt: PF_PT.chip })] : []),
    pfRun(mod, ` ${c.text} `, { pt: PF_PT.chip, bold: true, color: c.fg, shadingFill: c.bg }),
  ]);
  return new mod.Paragraph({ keepNext: true, spacing: { before: mmToTwips(PF_MM.labelToChips - 3), after: 0 }, children: runs });
}

export function pfTitle(mod: DocxModule, title: string) {
  return new mod.Paragraph({
    keepNext: true,
    keepLines: true,
    spacing: { before: mmToTwips(PF_MM.chipToTitle - 2), after: 0, line: ptToTwips(26.5), lineRule: mod.LineRuleType.EXACT },
    children: [pfRun(mod, title, { pt: PF_PT.title, bold: true, color: PF_COLOR.navy })],
  });
}

export function pfBasicInfo(mod: DocxModule, rows: { label: string; value: string }[]) {
  const { Paragraph, TabStopType } = mod;
  const col = mmToTwips(PF_MM.basicLabelCol);
  const heading = new Paragraph({
    keepNext: true,
    spacing: { before: mmToTwips(PF_MM.titleToBasicInfo - 2), after: mmToTwips(2) },
    children: [pfRun(mod, "기본 정보", { pt: PF_PT.basicHeading, bold: true, color: PF_COLOR.navy })],
  });
  const items = rows.map(
    (r, i) =>
      new Paragraph({
        keepNext: i < rows.length - 1,
        keepLines: true,
        tabStops: [{ type: TabStopType.LEFT, position: col }],
        indent: { left: col, hanging: col },
        spacing: { before: 0, after: mmToTwips(2.3) },
        children: [pfRun(mod, r.label, { pt: PF_PT.meta, bold: true, color: PF_COLOR.gray }), pfRun(mod, `\t${r.value}`, { pt: PF_PT.meta })],
      })
  );
  return [heading, ...items];
}

/** major section — 14pt bold navy + 아래 1pt orange line. */
export function pfMajorHeading(mod: DocxModule, label: string, beforeMm: number = PF_MM.majorBefore) {
  const { Paragraph, BorderStyle, HeadingLevel } = mod;
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    keepLines: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: PF_MM.majorRulePt * 8, color: hex(PF_COLOR.orange), space: 4 } },
    spacing: { before: mmToTwips(beforeMm), after: mmToTwips(PF_MM.majorRuleToContent) },
    children: [pfRun(mod, label, { pt: PF_PT.major, bold: true, color: PF_COLOR.navy })],
  });
}

export function pfSubNote(mod: DocxModule, text: string, afterMm: number) {
  return new mod.Paragraph({ keepNext: true, spacing: { before: 0, after: mmToTwips(afterMm) }, children: [pfRun(mod, text, { pt: 9, color: PF_COLOR.gray })] });
}

/** orange vertical bar(paragraph left border) + field heading + 본문 paragraph(들). */
export function pfField(mod: DocxModule, f: PfField, last = false, gapToBody: number = PF_MM.fieldToBody) {
  const { Paragraph, BorderStyle, LineRuleType } = mod;
  const heading = new Paragraph({
    keepNext: true,
    keepLines: true,
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: hex(PF_COLOR.orange), space: 7 } },
    spacing: { before: 0, after: mmToTwips(gapToBody - 1.3), line: ptToTwips(14.35), lineRule: LineRuleType.EXACT },
    children: [pfRun(mod, f.label, { pt: PF_PT.field, bold: true, color: PF_COLOR.navy })],
  });
  const lines = f.value.split("\n");
  const body = lines.map(
    (line, i) =>
      new Paragraph({
        widowControl: true,
        spacing: { before: 0, after: i === lines.length - 1 && !last ? mmToTwips(PF_MM.bodyToNextField - 1.3) : 0, line: ptToTwips(19.8), lineRule: LineRuleType.EXACT },
        children: [pfRun(mod, line, { pt: PF_PT.body })],
      })
  );
  return [heading, ...body];
}

export function pfFields(mod: DocxModule, fields: PfField[]) {
  return fields.flatMap((f, i) => pfField(mod, f, i === fields.length - 1));
}

/** 연구 일지 header — "date · title" (date orange / 구분자·title navy). date/title 중 없는 쪽은 통째로 생략. */
export function pfJournalHeader(mod: DocxModule, h: { date: string; title: string } | null, writer: string) {
  const { Paragraph } = mod;
  const out = [];
  if (h) {
    const runs = [];
    if (h.date) runs.push(pfRun(mod, h.date, { pt: PF_PT.journalTitle, bold: true, color: PF_COLOR.orange }));
    if (h.date && h.title) runs.push(pfRun(mod, " · ", { pt: PF_PT.journalTitle, bold: true, color: PF_COLOR.navy }));
    if (h.title) runs.push(pfRun(mod, h.title, { pt: PF_PT.journalTitle, bold: true, color: PF_COLOR.navy }));
    out.push(new Paragraph({ keepNext: true, keepLines: true, spacing: { before: 0, after: mmToTwips(PF_MM.journalTitleToWriter - 2) }, children: runs }));
  }
  out.push(
    new Paragraph({
      keepNext: true,
      spacing: { before: 0, after: mmToTwips(4.5) },
      children: [pfRun(mod, "작성자: ", { pt: PF_PT.journalWriter, bold: true, color: PF_COLOR.navy }), pfRun(mod, writer, { pt: PF_PT.journalWriter, color: PF_COLOR.gray })],
    })
  );
  return out;
}

/** journal 사이 0.5pt light divider — 위 8mm / 아래 7.5mm. 내용 없는 rule 전용 paragraph(1pt 글자 크기로 높이 최소화). */
export function pfDivider(mod: DocxModule) {
  const { Paragraph, BorderStyle } = mod;
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(PF_COLOR.divider), space: 1 } },
    spacing: { before: mmToTwips(PF_MM.journalToDivider - 3), after: mmToTwips(PF_MM.dividerToJournal - 1.5), line: 20, lineRule: mod.LineRuleType.EXACT },
    keepNext: true,
    children: [],
  });
}

/** 본문 paragraph(들) — 줄바꿈("\n")마다 paragraph 하나, 마지막에만 afterMm 간격. */
export function pfBody(mod: DocxModule, text: string, afterMm = 0, opts: { pt?: number; color?: string; keepNext?: boolean } = {}) {
  const lines = text.split("\n");
  return lines.map(
    (line, i) =>
      new mod.Paragraph({
        widowControl: true,
        keepNext: opts.keepNext && i === lines.length - 1,
        spacing: { before: 0, after: i === lines.length - 1 ? mmToTwips(afterMm) : 0, line: ptToTwips(19.8), lineRule: mod.LineRuleType.EXACT },
        children: [pfRun(mod, line, { pt: opts.pt ?? PF_PT.body, color: opts.color })],
      })
  );
}

/** top-level page 시작 — 3pt orange line(paragraph top border) + 큰 title. pageBreakBefore로 새 페이지. */
export function pfPageHeader(mod: DocxModule, title: string, pageBreakBefore: boolean, pt = 20) {
  return new mod.Paragraph({
    pageBreakBefore,
    keepNext: true,
    border: { top: { style: mod.BorderStyle.SINGLE, size: PF_MM.topRulePt * 8, color: hex(PF_COLOR.orange), space: Math.round(PF_PAGE.titleGap / 0.3528) } },
    spacing: { before: 0, after: mmToTwips(PF_PAGE.titleToNext) },
    children: [pfRun(mod, title, { pt, bold: true, color: PF_COLOR.navy })],
  });
}

export function pfCover(mod: DocxModule, name: string, yearLabel: string, createdLabel: string) {
  const { Paragraph, BorderStyle } = mod;
  return [
    new Paragraph({
      keepNext: true,
      border: { top: { style: BorderStyle.SINGLE, size: PF_MM.topRulePt * 8, color: hex(PF_COLOR.orange), space: Math.round(PF_PAGE.coverKickerGap / 0.3528) } },
      spacing: { before: mmToTwips(PF_PAGE.coverTop - PF_MM.marginTop), after: mmToTwips(1) },
      children: [pfRun(mod, "SciLog", { pt: 10, bold: true, color: PF_COLOR.orange })],
    }),
    new Paragraph({ keepNext: true, spacing: { before: 0, after: mmToTwips(PF_PAGE.coverNameGap - 3) }, children: [pfRun(mod, "RESEARCH PORTFOLIO", { pt: 11, bold: true, color: PF_COLOR.gray })] }),
    new Paragraph({ keepNext: true, spacing: { before: 0, after: mmToTwips(PF_PAGE.coverYearGap - 3) }, children: [pfRun(mod, name, { pt: 29, bold: true, color: PF_COLOR.navy })] }),
    new Paragraph({ keepNext: true, spacing: { before: 0, after: mmToTwips(PF_PAGE.coverCreatedGap) }, children: [pfRun(mod, yearLabel, { pt: 11, color: PF_COLOR.gray })] }),
    new Paragraph({ spacing: { before: 0, after: 0 }, children: [pfRun(mod, createdLabel, { pt: 9, color: PF_COLOR.gray })] }),
  ];
}

/** Portfolio at a Glance 카드 — 표 셀: 상단 orange accent border + 0.5pt divider border, 값/라벨 두 줄. */
export function pfGlanceCards(mod: DocxModule, items: { label: string; value: string }[]) {
  const { Table, TableRow, TableCell, Paragraph, WidthType, AlignmentType, BorderStyle } = mod;
  const line = { style: BorderStyle.SINGLE, size: 4, color: hex(PF_COLOR.divider) };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [
      new TableRow({
        cantSplit: true,
        children: items.map(
          (it) =>
            new TableCell({
              width: { size: 100 / items.length, type: WidthType.PERCENTAGE },
              borders: { top: { style: BorderStyle.SINGLE, size: 16, color: hex(PF_COLOR.orange) }, bottom: line, left: line, right: line },
              margins: { top: 140, bottom: 140, left: 80, right: 80 },
              children: [
                new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [pfRun(mod, it.value, { pt: 17, bold: true, color: PF_COLOR.navy })] }),
                new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [pfRun(mod, it.label, { pt: 9, color: PF_COLOR.gray })] }),
              ],
            })
        ),
      }),
    ],
  });
}

/** Journey section heading — 11pt bold orange + 아래 0.75pt orange line. */
export function pfEyebrowRule(mod: DocxModule, text: string, beforeMm = 0) {
  return new mod.Paragraph({
    keepNext: true,
    border: { bottom: { style: mod.BorderStyle.SINGLE, size: 6, color: hex(PF_COLOR.orange), space: 4 } },
    spacing: { before: mmToTwips(beforeMm), after: mmToTwips(4) },
    children: [new mod.TextRun({ ...{}, text, bold: true, size: halfPt(PF_PT.projectNo), color: hex(PF_COLOR.orange), characterSpacing: 10, font: { ascii: PF_FONT_FAMILY, eastAsia: PF_FONT_FAMILY, hAnsi: PF_FONT_FAMILY } })],
  });
}

/** Journey project/summary entry — [번호][유형] chip → title → metadata. 한 entry가 페이지에서 갈라지지 않게 keepNext. */
export function pfJourneyEntry(mod: DocxModule, chips: { text: string; bg: string; fg: string }[], title: string | null, meta: string | null, afterMm = PF_PAGE.entryToEntry) {
  const { Paragraph } = mod;
  const out = [
    new Paragraph({
      keepNext: true,
      spacing: { before: 0, after: mmToTwips(PF_PAGE.entryChipToTitle - 2) },
      children: chips.flatMap((c, i) => [...(i > 0 ? [pfRun(mod, " ", { pt: PF_PT.chip })] : []), pfRun(mod, `\u00A0${c.text}\u00A0`, { pt: 8.5, bold: true, color: c.fg, shadingFill: c.bg })]),
    }),
  ];
  if (title) out.push(new Paragraph({ keepNext: !!meta, keepLines: true, spacing: { before: 0, after: mmToTwips(meta ? PF_PAGE.entryTitleToMeta : afterMm), line: ptToTwips(15.5), lineRule: mod.LineRuleType.EXACT }, children: [pfRun(mod, title, { pt: PF_PT.journalTitle, bold: true, color: PF_COLOR.navy })] }));
  if (meta) out.push(new Paragraph({ keepLines: true, spacing: { before: 0, after: mmToTwips(afterMm) }, children: [pfRun(mod, meta, { pt: 9, color: PF_COLOR.gray })] }));
  return out;
}

export function pfSemesterHeading(mod: DocxModule, label: string) {
  return new mod.Paragraph({ keepNext: true, spacing: { before: 0, after: mmToTwips(PF_PAGE.semesterToActivity - 1.5) }, children: [pfRun(mod, label, { pt: PF_PT.basicHeading, bold: true, color: PF_COLOR.gray })] });
}

/** [chip] 제목 — Other Activities/Teacher Observations 항목 header. chip이 없으면 제목만. */
export function pfChipTitle(mod: DocxModule, chip: string | null, title: string, hasMeta: boolean) {
  const runs = [];
  if (chip) runs.push(pfRun(mod, `\u00A0${chip}\u00A0`, { pt: 8.5, bold: true, color: PF_COLOR.orange, shadingFill: PF_COLOR.typeChipBg }), pfRun(mod, "  ", { pt: PF_PT.journalTitle }));
  runs.push(pfRun(mod, title, { pt: PF_PT.journalTitle, bold: true, color: PF_COLOR.navy }));
  return new mod.Paragraph({ keepNext: true, keepLines: true, spacing: { before: 0, after: mmToTwips(hasMeta ? PF_PAGE.titleToMeta : PF_PAGE.metaToBody) }, children: runs });
}

export function pfMeta(mod: DocxModule, text: string) {
  return new mod.Paragraph({ keepNext: true, spacing: { before: 0, after: mmToTwips(PF_PAGE.metaToBody - 2) }, children: [pfRun(mod, text, { pt: 9, color: PF_COLOR.gray })] });
}
