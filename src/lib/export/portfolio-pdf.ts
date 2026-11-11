import { hexToRgb, type PdfWriter } from "./common";
import { PF_COLOR, PF_MM, PF_PAGE, PF_PT, type PfField } from "./portfolio-layout";

// 포트폴리오 PROJECT 본문 PDF primitive — PdfWriter의 line()은 y advance가 line-box 전체라
// 정확한 mm 간격을 맞출 수 없어(render-full-portfolio.ts writeProjectHeader 주석 참고),
// 여기서는 "줄 상자(top) 기준 cursor + 명시적 line-height(mm)"로 직접 배치한다.
// 모든 함수가 w.y(줄 상자 top)만 읽고 갱신하므로 기존 PdfWriter 메서드와 섞어 써도 안전하다.

export const PT_MM = 25.4 / 72;
/** 한글 글자 잉크 top이 baseline 위로 올라오는 높이(mm) — 기존 헤더 실측 비율(0.3*pt)을 그대로 쓴다. */
export const ascentMm = (pt: number): number => pt * 0.3;
/** 글자를 줄 상자 중앙에 두기 위한 baseline 오프셋(mm). */
const centerBaseline = (boxH: number, pt: number): number => boxH / 2 + pt * PT_MM * 0.36;

export function setPfFont(w: PdfWriter, pt: number, bold: boolean, color: string): void {
  w.doc.setFontSize(pt);
  w.doc.setFont(w.fontFamily, bold ? "bold" : "normal");
  const [r, g, b] = hexToRgb(color);
  w.doc.setTextColor(r, g, b);
}

export function wrapText(w: PdfWriter, text: string, pt: number, bold: boolean, width: number = w.contentW): string[] {
  w.doc.setFontSize(pt);
  w.doc.setFont(w.fontFamily, bold ? "bold" : "normal");
  return w.doc.splitTextToSize(text, width) as string[];
}

const limitY = (w: PdfWriter): number => w.pageH - w.marginBottom;
const atPageTop = (w: PdfWriter): boolean => w.y <= w.marginTop + 0.01;

/** 남은 공간이 h(mm)보다 적으면 새 페이지 — 이미 페이지 맨 위면 아무것도 하지 않는다(빈 페이지 방지). */
export function needSpace(w: PdfWriter, h: number): boolean {
  if (w.y + h <= limitY(w) || atPageTop(w)) return false;
  w.newPage();
  return true;
}

/** 문단 사이 간격(mm) — 약 4pt. 본문 줄 간격(7mm)보다 훨씬 작게 두어 "문단이 나뉘어 보이는" 정도만 준다. */
const PARAGRAPH_GAP_MM = 1.4;
const LIST_ITEM = /^\s*(?:[-•·*]\s+|\d+[.)]\s+|\(\d+\)\s+)/;

/**
 * 본문 text를 문단 단위로 나눈다. 저장 데이터가 문단을 "\n"(또는 빈 줄 "\n\n")으로 구분하므로
 * 줄바꿈 한 번도 문단 경계로 본다. 단 "- ", "•", "1." 같은 목록 항목이 이어지는 줄은 같은 문단(간격 없음)으로 묶고,
 * 연속된 빈 줄은 문단 경계 하나로 합친다. 각 문단은 원문 줄 배열이다.
 */
function splitParagraphs(text: string): string[][] {
  const paragraphs: string[][] = [];
  let prev: string | null = null;
  let sawBlank = false;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      sawBlank = true;
      continue;
    }
    const joinsPrev = prev !== null && !sawBlank && LIST_ITEM.test(prev) && LIST_ITEM.test(line);
    if (paragraphs.length === 0 || !joinsPrev) paragraphs.push([line]);
    else paragraphs[paragraphs.length - 1].push(line);
    prev = line;
    sawBlank = false;
  }
  return paragraphs;
}

/**
 * 본문 — 문단별로 줄바꿈한 뒤 페이지를 넘길 때 widow/orphan을 제어한다.
 *  - 문단 사이에 작은 간격(PARAGRAPH_GAP_MM)을 둔다(마지막 문단 뒤에는 없음 — field 간격은 호출부 몫).
 *  - 문단이 쪽을 넘기면 이전 쪽에 minOrphanLines 이상, 다음 쪽에 minWidowLines 이상 남도록 끊는다.
 *  - 3줄 이하의 짧은 문단은 쪼개지 않고, 안 들어가면 통째로 다음 쪽으로 보낸다(긴 문단을 통째로 옮기지는 않는다).
 */
export function flowText(
  w: PdfWriter,
  text: string,
  opts: { pt?: number; bold?: boolean; color?: string; lineH?: number; x?: number; width?: number; paragraphGap?: number; minWidowLines?: number; minOrphanLines?: number } = {}
): void {
  const pt = opts.pt ?? PF_PT.body;
  const lineH = opts.lineH ?? PF_MM.bodyLineH;
  const x = opts.x ?? w.margin;
  const gap = opts.paragraphGap ?? PARAGRAPH_GAP_MM;
  const minWidow = opts.minWidowLines ?? 2;
  const minOrphan = opts.minOrphanLines ?? 2;
  const paragraphs = splitParagraphs(text);
  const draw = (lines: string[]) => {
    setPfFont(w, pt, opts.bold ?? false, opts.color ?? PF_COLOR.body);
    for (const line of lines) {
      w.doc.text(line, x, w.y + centerBaseline(lineH, pt));
      w.y += lineH;
    }
  };
  const fitCount = () => Math.floor((limitY(w) - w.y + 0.01) / lineH);

  paragraphs.forEach((srcLines, pi) => {
    let lines = srcLines.flatMap((l) => wrapText(w, l, pt, opts.bold ?? false, opts.width ?? w.contentW));
    if (lines.length === 0) return;
    if (pi > 0 && !atPageTop(w)) w.y += gap;
    let first = true;
    while (lines.length > 0) {
      const room = fitCount();
      if (lines.length <= room) {
        draw(lines);
        return;
      }
      if (first && lines.length <= 3) {
        // 짧은 문단: 쪼개지 않고 통째로 다음 쪽으로
        if (!atPageTop(w)) w.newPage();
        draw(lines);
        return;
      }
      const k = Math.min(room, lines.length - minWidow);
      const need = first ? minOrphan : 1;
      if (k >= need) {
        draw(lines.slice(0, k));
        lines = lines.slice(k);
        first = false;
      } else if (atPageTop(w)) {
        // 쪽 맨 위인데도 규칙을 만족할 수 없는 극단적인 경우 — 무한 루프 방지를 위해 들어가는 만큼만 그린다
        const m = Math.max(1, room);
        draw(lines.slice(0, m));
        lines = lines.slice(m);
        first = false;
      }
      if (lines.length > 0) w.newPage();
    }
  });
}

function bodyLineCount(w: PdfWriter, text: string): number {
  return wrapText(w, text, PF_PT.body, false).length;
}

/** field heading + 최소 본문 2줄이 들어갈 높이(mm). */
export function fieldMinHeight(w: PdfWriter, value: string): number {
  return PF_MM.fieldBarH + PF_MM.fieldToBody - 1.7 + Math.min(2, bodyLineCount(w, value)) * PF_MM.bodyLineH;
}

/** orange vertical bar + field heading + 본문 — 연구 계획/연구 일지/나의 기록/결과 보고서가 공유하는 field 스타일. */
export function writeField(w: PdfWriter, label: string, value: string, last = false, gapToBody: number = PF_MM.fieldToBody): void {
  needSpace(w, fieldMinHeight(w, value));
  const top = w.y;
  w.doc.setFillColor(...(hexToRgb(PF_COLOR.orange) as [number, number, number]));
  w.doc.rect(w.margin - PF_MM.fieldBarOffset - PF_MM.fieldBarW, top, PF_MM.fieldBarW, PF_MM.fieldBarH, "F");
  setPfFont(w, PF_PT.field, true, PF_COLOR.navy);
  w.doc.text(label, w.margin, top + centerBaseline(PF_MM.fieldBarH, PF_PT.field));
  // 줄 상자 상하 여백(≈1.7mm)을 빼 "잉크 기준" 4mm / 7mm 간격에 맞춘다.
  w.y = top + PF_MM.fieldBarH + gapToBody - 1.7;
  flowText(w, value);
  if (!last) w.y += PF_MM.bodyToNextField - 1.7;
}

/** top-level section heading(14pt navy + 1pt orange underline). 위 여백 13mm, 페이지 맨 위면 여백 없음.
 * minContentH: heading 뒤에 최소한 함께 있어야 하는 내용 높이(orphan heading 방지). */
export function writeMajorHeading(w: PdfWriter, label: string, minContentH: number, beforeMm: number = PF_MM.majorBefore): void {
  const headH = ascentMm(PF_PT.major) + PF_MM.majorToRule + PF_MM.majorRuleToContent;
  if (!atPageTop(w)) {
    const before = beforeMm;
    if (w.y + before + headH + minContentH > limitY(w)) w.newPage();
    else w.y += before;
  }
  const baseline = w.y + ascentMm(PF_PT.major);
  setPfFont(w, PF_PT.major, true, PF_COLOR.navy);
  w.doc.text(label, w.margin, baseline);
  const ruleY = baseline + PF_MM.majorToRule;
  const [r, g, b] = hexToRgb(PF_COLOR.orange);
  w.doc.setDrawColor(r, g, b);
  w.doc.setLineWidth(PF_MM.majorRulePt * PT_MM);
  w.doc.line(w.margin, ruleY, w.margin + w.contentW, ruleY);
  w.y = ruleY + PF_MM.majorRuleToContent;
}

/** 0.5pt light divider. */
export function writeDivider(w: PdfWriter): void {
  const [r, g, b] = hexToRgb(PF_COLOR.divider);
  w.doc.setDrawColor(r, g, b);
  w.doc.setLineWidth(PF_MM.dividerPt * PT_MM);
  w.doc.line(w.margin, w.y, w.margin + w.contentW, w.y);
}

export interface PfChip {
  text: string;
  bg: string;
  fg: string;
  /** 최소 너비(mm) — 번호 chip처럼 고정 폭이 필요할 때(텍스트는 가운데 정렬). */
  minW?: number;
}

/** [chip][chip] — 좌측부터 gap 1.5mm로 배치. top은 chip 상단 y, 반환값은 chip 하단 y. */
export function writeChips(w: PdfWriter, chips: PfChip[], top: number, h: number = PF_MM.chipH, pt: number = PF_PT.chip): number {
  let x = w.margin;
  w.doc.setFontSize(pt);
  w.doc.setFont(w.fontFamily, "bold");
  for (const c of chips) {
    const tw = w.doc.getTextWidth(c.text) as number;
    const cw = Math.max(tw + PF_MM.chipPadX * 2, c.minW ?? 0);
    const [br, bg, bb] = hexToRgb(c.bg);
    w.doc.setFillColor(br, bg, bb);
    w.doc.roundedRect(x, top, cw, h, Math.min(2, h / 2.4), Math.min(2, h / 2.4), "F");
    setPfFont(w, pt, true, c.fg);
    w.doc.text(c.text, x + (cw - tw) / 2, top + centerBaseline(h, pt));
    x += cw + PF_MM.chipGap;
  }
  return top + h;
}

/** chip 하나의 너비(mm) — 제목을 chip 오른쪽에 이어 배치할 때. */
export function chipWidth(w: PdfWriter, text: string, pt: number = PF_PT.chip, minW = 0): number {
  w.doc.setFontSize(pt);
  w.doc.setFont(w.fontFamily, "bold");
  return Math.max((w.doc.getTextWidth(text) as number) + PF_MM.chipPadX * 2, minW);
}

/** top-level page 시작의 3pt orange line. */
export function writeTopRule(w: PdfWriter): void {
  const [r, g, b] = hexToRgb(PF_COLOR.orange);
  const ruleW = PF_MM.topRulePt * PT_MM;
  w.doc.setDrawColor(r, g, b);
  w.doc.setLineWidth(ruleW);
  w.doc.line(w.margin, w.y + ruleW / 2, w.margin + w.contentW, w.y + ruleW / 2);
  w.y += ruleW;
}

/** top rule 아래 큰 page title(20pt bold navy). 이후 w.y는 title 잉크 하단. */
export function writePageTitle(w: PdfWriter, title: string, pt = 20): void {
  const base = w.y + PF_PAGE.titleGap + ascentMm(pt);
  setPfFont(w, pt, true, PF_COLOR.navy);
  w.doc.text(title, w.margin, base);
  w.y = base + pt * 0.05;
}

/** 작은 텍스트 한 줄(잉크 top = w.y + gap). 이후 w.y는 줄 하단. */
export function writeSmallLine(w: PdfWriter, text: string, pt: number, bold: boolean, color: string, gapBefore: number, charSpace = 0): void {
  const base = w.y + gapBefore + ascentMm(pt);
  setPfFont(w, pt, bold, color);
  const d = w.doc as { setCharSpace?: (n: number) => void };
  if (charSpace && d.setCharSpace) d.setCharSpace(charSpace);
  w.doc.text(text, w.margin, base);
  if (charSpace && d.setCharSpace) d.setCharSpace(0);
  w.y = base + pt * 0.05;
}

/** Journey 안의 section heading — 11pt bold orange(자간 약간) + 아래 0.75pt orange line. */
export function writeEyebrowRule(w: PdfWriter, text: string): void {
  writeSmallLine(w, text, PF_PT.projectNo, true, PF_COLOR.orange, 0, 0.25);
  const ruleY = w.y + 3;
  const [r, g, b] = hexToRgb(PF_COLOR.orange);
  w.doc.setDrawColor(r, g, b);
  w.doc.setLineWidth(0.75 * PT_MM);
  w.doc.line(w.margin, ruleY, w.margin + w.contentW, ruleY);
  w.y = ruleY + 5;
}

/** 요약 카드(Portfolio at a Glance) — 상단 2mm orange accent, 0.5pt divider border, 흰 배경. */
export function writeGlanceCards(w: PdfWriter, items: { label: string; value: string }[], perRow = 4): void {
  const gap = PF_PAGE.cardGap;
  const cw = (w.contentW - gap * (perRow - 1)) / perRow;
  for (let start = 0; start < items.length; start += perRow) {
    needSpace(w, PF_PAGE.cardH);
    items.slice(start, start + perRow).forEach((it, i) => {
      const x = w.margin + i * (cw + gap);
      const [br, bg, bb] = hexToRgb(PF_COLOR.divider);
      w.doc.setDrawColor(br, bg, bb);
      w.doc.setFillColor(255, 255, 255);
      w.doc.setLineWidth(PF_MM.dividerPt * PT_MM);
      w.doc.roundedRect(x, w.y, cw, PF_PAGE.cardH, 2.5, 2.5, "FD");
      const [or, og, ob] = hexToRgb(PF_COLOR.orange);
      w.doc.setFillColor(or, og, ob);
      w.doc.rect(x + 2.5, w.y, cw - 5, PF_PAGE.cardAccentH, "F");
      setPfFont(w, 17, true, PF_COLOR.navy);
      w.doc.text(it.value, x + cw / 2, w.y + 13.5, { align: "center" });
      setPfFont(w, 9, false, PF_COLOR.gray);
      w.doc.text(it.label, x + cw / 2, w.y + 19, { align: "center" });
    });
    w.y += PF_PAGE.cardH + gap;
  }
}
/** 페이지 하단 중앙 "현재 / 전체" — 현재 페이지 10pt #30343B, "/ 전체" 8.5pt #9AA0A8. */
export function writePortfolioFooters(w: PdfWriter): void {
  const total = (w.doc.internal as { pages: unknown[] }).pages.length - 1;
  const baseline = w.pageH - PF_MM.footerFromBottom;
  for (let i = 1; i <= total; i++) {
    w.doc.setPage(i);
    w.doc.setFontSize(PF_PT.footerCurrent);
    w.doc.setFont(w.fontFamily, "normal");
    const cur = String(i);
    const curW = w.doc.getTextWidth(cur) as number;
    w.doc.setFontSize(PF_PT.footerTotal);
    const tail = ` / ${total}`;
    const tailW = w.doc.getTextWidth(tail) as number;
    const x = (w.pageW - (curW + tailW)) / 2;
    setPfFont(w, PF_PT.footerCurrent, false, PF_COLOR.body);
    w.doc.text(cur, x, baseline);
    setPfFont(w, PF_PT.footerTotal, false, PF_COLOR.footerMuted);
    w.doc.text(tail, x + curW, baseline);
  }
}

export function writeFields(w: PdfWriter, fields: PfField[]): void {
  fields.forEach((f, i) => writeField(w, f.label, f.value, i === fields.length - 1));
}

/** 병합된 통합 PDF에서 "우리가 만든 페이지"(표지/본문/구분 페이지)에만 하단 중앙 "현재 / 전체"를 찍는다 —
 * 학생 제출 원본 PDF 페이지에는 아무것도 덧그리지 않는다. 숫자는 통합 파일의 실제 페이지 번호/전체 페이지 수다. */
export async function stampPortfolioFooters(bytes: Uint8Array, isGenerated: boolean[], pageCounts: number[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  const color = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return rgb(r / 255, g / 255, b / 255);
  };
  let pageIdx = 0;
  pageCounts.forEach((count, bufIdx) => {
    for (let k = 0; k < count; k++, pageIdx++) {
      if (!isGenerated[bufIdx]) continue;
      const page = doc.getPage(pageIdx);
      const cur = String(pageIdx + 1);
      const tail = ` / ${total}`;
      const curW = font.widthOfTextAtSize(cur, PF_PT.footerCurrent);
      const tailW = font.widthOfTextAtSize(tail, PF_PT.footerTotal);
      const { width } = page.getSize();
      const x = (width - (curW + tailW)) / 2;
      const y = PF_MM.footerFromBottom / PT_MM;
      page.drawText(cur, { x, y, size: PF_PT.footerCurrent, font, color: color(PF_COLOR.body) });
      page.drawText(tail, { x: x + curW, y, size: PF_PT.footerTotal, font, color: color(PF_COLOR.footerMuted) });
    }
  });
  return await doc.save();
}
