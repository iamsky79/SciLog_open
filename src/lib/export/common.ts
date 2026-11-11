// 연구 기록 내보내기(Word/PDF) 공용 유틸.
// 탭별 내보내기 5종(연구계획서/연구일지/결과보고서/참고자료/나의 기록)과
// "전체 내보내기"(render-full.ts)가 모두 공유하는 저수준 계층.

export function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
}

export function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

export function fileNameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return url;
  }
}

/** 다운로드 파일명용 sanitize. Storage 키와 달리 한글은 유지하고 파일시스템 금지 문자만 제거한다. */
export function sanitizeDownloadName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return (cleaned || "제목없음").slice(0, 80);
}

const ENTITY_KIND_FILE_LABEL: Record<"rne" | "club" | "individual", string> = {
  rne: "R&E",
  club: "동아리",
  individual: "창의개인연구",
};

export function exportFileName(
  entityKind: "rne" | "club" | "individual",
  entityName: string,
  docLabel: string,
  ext: string,
  year: string | number = new Date().getFullYear()
): string {
  return `${year}_${ENTITY_KIND_FILE_LABEL[entityKind]}_${sanitizeDownloadName(entityName)}_${docLabel}.${ext}`;
}

export function extOf(url: string): string {
  const name = fileNameFromUrl(url);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/**
 * "제출된 결과보고서 원본 파일"의 표준 이름 — 검토/제출물 관리 화면의
 * "학생 제출 보고서 PDF" 다운로드(downloadSubmittedPdf)가 쓰는 것과 동일한
 * 규칙이다. 같은 파일이 화면마다 원본/storage 파일명으로 다르게 다운로드되던
 * 문제를 없애기 위해, 이 파일을 attachment 목록에 넣는 모든 곳(hub.ts,
 * portfolio/detail.ts)이 이 함수 하나만 공유한다.
 */
export function submittedFileBaseName(params: { schoolYear: string | null; activityKind: string; who: string; docType: string }): string {
  return sanitizeDownloadName(`${params.schoolYear ?? "학년도미정"}_${params.activityKind}_${params.who}_${params.docType}`);
}

export function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function imageDims(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export function docxImageType(url: string): "jpg" | "png" | "gif" | "bmp" {
  if (/\.png(\?|$)/i.test(url)) return "png";
  if (/\.gif(\?|$)/i.test(url)) return "gif";
  if (/\.bmp(\?|$)/i.test(url)) return "bmp";
  return "jpg";
}

function pdfImageFormat(url: string): "PNG" | "JPEG" {
  return /\.png(\?|$)/i.test(url) ? "PNG" : "JPEG";
}

export function hexToRgb(color: string): [number, number, number] {
  const rgb = parseInt(color.slice(1), 16);
  return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
}

/** academic/restrained 팔레트 — accent는 primary 하나만 쓴다(타입/상태별 여러 색 배지 금지). */
export const PDF_COLORS = {
  primary: "#183153",
  text: "#1F2937",
  secondary: "#6B7280",
  bgLight: "#F5F7FA",
  border: "#D9DEE7",
} as const;

/** 문서 전체 타이포그래피 하이어라키를 한 곳에서 통일 — 값을 바꾸면 모든 섹션이 같이 바뀐다. */
export const PDF_FONT = {
  coverName: 28,
  coverSubtitle: 16,
  /** 프로젝트/기타 활동/교사 관찰 기록 — 문서 전체에서 가장 강한 top-level anchor
   * ("PROJECT 01" / "OTHER ACTIVITIES" / "TEACHER OBSERVATIONS")에 공통으로 쓴다. */
  projectNumber: 20,
  projectName: 19,
  eyebrow: 9.5,
  h2: 15,
  h3: 11.5,
  body: 10,
  metadata: 9,
  footer: 8,
} as const;

/** mm 단위 spacing 가이드 — 값을 바꾸면 표지/프로젝트 커버/종합정보가 같이 바뀐다. */
export const PDF_SPACE = {
  sectionBefore: 12,
  sectionAfter: 5,
  subBefore: 6,
  subAfter: 3,
  paragraph: 3,
  cardPad: 5,
  cardGap: 4,
} as const;

// ─── PDF: jsPDF 기반 텍스트 레이아웃 writer (스크린샷이 아닌 실제 선택 가능한 텍스트) ──────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsPdfDoc = any;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// 실제 쓰이는 글자만 골라 서브셋을 만드는 방식은 렌더링 시점 텍스트와 서브셋 요청 시점에
// 모아둔 글자 목록이 어긋나면 목록에 없던 글자가 PDF에서 통째로 사라지는 문제가 있어(직접 재현·확인)
// 완전한 폰트 파일을 받아 캐시하는 방식으로 바꿨다 — 어떤 한글이 와도 누락되지 않는다.
async function fetchKoreanFontTTF(weight: 400 | 700): Promise<ArrayBuffer | null> {
  try {
    const resp = await fetch(`/api/export/korean-font?weight=${weight}`);
    if (!resp.ok) return null;
    return await resp.arrayBuffer();
  } catch {
    return null;
  }
}

/** PdfWriter.create()에 넘기는 여백/줄간격 override — 생략하면 기존(탭별 내보내기/
 * submission-export.ts) 문서와 100% 동일한 값을 쓴다. 포트폴리오 렌더러만 명시적으로
 * 새 spacing guide 값을 넘긴다. */
export interface PdfLayoutConfig {
  /** 좌우 여백(mm). 기본 15(기존 그대로). */
  margin?: number;
  /** 상단 여백(mm). 기본은 margin과 동일(기존 그대로). */
  marginTop?: number;
  /** 하단 콘텐츠 한계(mm, 이 아래는 footer 영역). 기본 margin+10(기존 "-10 버퍼"와 동일). */
  marginBottom?: number;
  /** line() 줄간격 = fontSize * lineHeightRatio. 기본 0.4(기존 그대로) — 포트폴리오는 1.5배
   * line-height 가이드(≈0.53)를 쓴다. */
  lineHeightRatio?: number;
}

export class PdfWriter {
  doc: JsPdfDoc;
  pageW: number;
  pageH: number;
  margin: number;
  marginTop: number;
  marginBottom: number;
  lineHeightRatio: number;
  contentW: number;
  y: number;
  /** 한글 서브셋 폰트 임베드에 성공하면 "NotoSansKR", 실패하면 helvetica로 폴백(한글이 깨질 수 있음) */
  fontFamily: string = "helvetica";

  private constructor(doc: JsPdfDoc, layout: Required<PdfLayoutConfig>) {
    this.doc = doc;
    this.pageW = doc.internal.pageSize.getWidth();
    this.pageH = doc.internal.pageSize.getHeight();
    this.margin = layout.margin;
    this.marginTop = layout.marginTop;
    this.marginBottom = layout.marginBottom;
    this.lineHeightRatio = layout.lineHeightRatio;
    this.contentW = this.pageW - this.margin * 2;
    this.y = this.marginTop;
  }

  /**
   * @param textSample 이 문서에 한글(비ASCII) 텍스트가 있는지 판단하는 용도.
   * 값이 있으면(사실상 항상) 완전한 한글 폰트를 내려받아 임베드한다 —
   * 실제 쓰인 글자만 골라 서브셋을 만들면 목록에 없는 글자가 사라지는 문제가 있어(재현 확인)
   * 특정 글자만 받는 방식은 쓰지 않는다.
   * @param layoutConfig 생략하면 기존 문서(탭별 내보내기 등)와 완전히 동일한 여백/줄간격.
   */
  static async create(textSample = "", layoutConfig: PdfLayoutConfig = {}): Promise<PdfWriter> {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const margin = layoutConfig.margin ?? 15;
    const layout: Required<PdfLayoutConfig> = {
      margin,
      marginTop: layoutConfig.marginTop ?? margin,
      marginBottom: layoutConfig.marginBottom ?? margin + 10,
      lineHeightRatio: layoutConfig.lineHeightRatio ?? 0.4,
    };
    const writer = new PdfWriter(doc, layout);
    const hasNonAscii = /[^\x00-\x7F]/.test(textSample) || textSample === "";
    if (hasNonAscii) await writer.loadKoreanFont();
    return writer;
  }

  private async loadKoreanFont() {
    const [normalBuf, boldBuf] = await Promise.all([fetchKoreanFontTTF(400), fetchKoreanFontTTF(700)]);
    if (!normalBuf || !boldBuf) return; // helvetica로 폴백 (한글이 깨질 수 있음)
    try {
      this.doc.addFileToVFS("NotoSansKR-Regular.ttf", arrayBufferToBase64(normalBuf));
      this.doc.addFont("NotoSansKR-Regular.ttf", "NotoSansKR", "normal");
      this.doc.addFileToVFS("NotoSansKR-Bold.ttf", arrayBufferToBase64(boldBuf));
      this.doc.addFont("NotoSansKR-Bold.ttf", "NotoSansKR", "bold");
      this.fontFamily = "NotoSansKR";
    } catch {
      this.fontFamily = "helvetica";
    }
  }

  checkPage(neededHeight: number) {
    if (this.y + neededHeight > this.pageH - this.marginBottom) {
      this.doc.addPage();
      this.y = this.marginTop;
    }
  }

  /** 조건 없이 무조건 새 페이지로 넘어간다 (섹션 간 강제 구분용). */
  newPage() {
    this.doc.addPage();
    this.y = this.marginTop;
  }

  line(text: string, fontSize: number, bold = false, color = "#111827") {
    this.doc.setFontSize(fontSize);
    this.doc.setFont(this.fontFamily, bold ? "bold" : "normal");
    const [r, g, b] = hexToRgb(color);
    this.doc.setTextColor(r, g, b);
    const lines = this.doc.splitTextToSize(text, this.contentW) as string[];
    const lineHeight = fontSize * this.lineHeightRatio;
    const blockHeight = lines.length * lineHeight;
    const fullPageCapacity = this.pageH - this.marginTop - this.marginBottom;

    if (blockHeight <= fullPageCapacity) {
      // 기존 동작 그대로 — 한 페이지 안에 들어가는 블록은 최대 한 번만 새 페이지로 넘긴다.
      this.checkPage(blockHeight);
      this.doc.text(lines, this.margin, this.y);
      this.y += blockHeight + 2;
      return;
    }

    // 한 페이지보다 긴 블록(매우 긴 전체 원문 등) — checkPage 한 번으로 끝내지 않고,
    // 이 페이지의 남은 공간을 채운 뒤 나머지를 다음 페이지(들)로 계속 이어 그린다.
    // page bottom 아래로 잘리는 줄이 없도록 매 조각마다 실제 남은 높이를 다시 계산한다.
    let i = 0;
    while (i < lines.length) {
      const availableHeight = this.pageH - this.marginBottom - this.y;
      const linesThatFit = Math.floor(availableHeight / lineHeight);
      if (linesThatFit < 1) {
        this.newPage();
        continue;
      }
      const chunk = lines.slice(i, i + linesThatFit);
      this.doc.text(chunk, this.margin, this.y);
      this.y += chunk.length * lineHeight;
      i += chunk.length;
    }
    this.y += 2;
  }

  /** "라벨: 값" 형태. 값이 길면 자동 줄바꿈. */
  labeledLine(label: string, value: string, fontSize = 10) {
    this.line(`${label}: ${value}`, fontSize);
  }

  /** 실제 원문에서 앞 maxLines줄만 잘라 미리보기 문자열을 만든다(요약 생성 아님 — 전체
   * 원문은 이 미리보기와 별개로 뒤에 그대로 렌더링된다). 잘렸으면 "…"을 붙인다. */
  previewLines(text: string, maxLines: number, fontSize = PDF_FONT.body): string {
    this.doc.setFontSize(fontSize);
    this.doc.setFont(this.fontFamily, "normal");
    const lines = this.doc.splitTextToSize(text, this.contentW) as string[];
    if (lines.length <= maxLines) return text;
    return lines.slice(0, maxLines).join(" ").trim() + "…";
  }

  hline() {
    this.doc.setDrawColor(200, 200, 200);
    this.doc.line(this.margin, this.y, this.pageW - this.margin, this.y);
    this.y += 4;
  }

  /** 옅은 hairline 구분선 — 위/아래 여백을 충분히 둬서 선과 텍스트가 붙지 않게 한다.
   * "선으로 나누는 디자인"이 아니라 "여백/계층으로 구분"이 우선이라 색 포인트 바는 넣지 않는다.
   *
   * jsPDF의 text()는 y를 baseline으로 잡는다 — 그래서 뒤에 큰 글자(h2/h3 heading)가
   * 이어지면, 그 글자의 ascender(상승 부분, 대략 fontSize*0.2646mm)가 우리가 계산한
   * "여백" 안으로 파고들어 실제로는 훨씬 좁아 보인다(직접 렌더링해 픽셀로 검증 확인).
   * 선 아래 여백을 h2(15pt) 기준 ascender(~4mm)까지 흡수하도록 9mm로 넉넉히 잡는다. */
  sectionRule() {
    this.y += 7; // 선 위 여백 6~8mm
    const [r, g, b] = hexToRgb(PDF_COLORS.border);
    this.doc.setDrawColor(r, g, b);
    this.doc.setLineWidth(0.2); // ≈0.57pt, 0.4~0.7pt 범위
    this.doc.line(this.margin, this.y, this.pageW - this.margin, this.y);
    this.y += 9; // 선 아래 "체감" 여백 5~7mm가 되도록(뒤따르는 heading의 ascender 보정 포함)
  }

  spacer(h = 4) {
    this.y += h;
  }

  /** sectionRule()보다 가벼운 hairline — 큰 section이 아니라 같은 section 안의 항목
   * 사이(예: 기타 활동 카드 사이)를 나눌 때 쓴다. 위/아래 여백을 파라미터로 받아
   * sectionRule()과 달리 호출부가 breathing room을 직접 조절할 수 있다. */
  hairline(gapBefore = 3, gapAfter = 3, color: string = PDF_COLORS.border) {
    this.y += gapBefore;
    const [r, g, b] = hexToRgb(color);
    this.doc.setDrawColor(r, g, b);
    this.doc.setLineWidth(0.15); // ≈0.43pt, 0.4~0.5pt 범위
    this.doc.line(this.margin, this.y, this.pageW - this.margin, this.y);
    this.y += gapAfter;
  }

  /** 작은 원 마커 — 연구일지 timeline 스타일에 쓴다. */
  dot(x: number, y: number, color = PDF_COLORS.primary, radius = 1.3) {
    const [r, g, b] = hexToRgb(color);
    this.doc.setFillColor(r, g, b);
    this.doc.circle(x, y, radius, "F");
  }

  /** timeline 항목 사이를 잇는 세로선. */
  vline(x: number, y1: number, y2: number, color = "#cbd5e1") {
    const [r, g, b] = hexToRgb(color);
    this.doc.setDrawColor(r, g, b);
    this.doc.line(x, y1, x, y2);
  }

  /** outline 배지 하나(academic 톤 — 색 채움 대신 얇은 테두리+색 텍스트). 반환값은
   * 실제 그려진 너비(다음 chip을 이어 배치할 때 사용). */
  chip(text: string, x: number, y: number, color: string = PDF_COLORS.primary, fontSize: number = PDF_FONT.eyebrow): number {
    this.doc.setFontSize(fontSize);
    this.doc.setFont(this.fontFamily, "bold");
    const textW = this.doc.getTextWidth(text) as number;
    const padX = 3;
    const h = 6;
    const w = textW + padX * 2;
    const [br, bg, bb] = hexToRgb(PDF_COLORS.border);
    this.doc.setDrawColor(br, bg, bb);
    this.doc.setLineWidth(0.2);
    this.doc.roundedRect(x, y, w, h, 1.5, 1.5, "S");
    const [r, g, b] = hexToRgb(color);
    this.doc.setTextColor(r, g, b);
    this.doc.text(text, x + padX, y + h / 2 + 1.2);
    return w;
  }

  /** 배지 여러 개를 한 줄에 흘려 배치 — contentW를 넘으면 자동 줄바꿈. */
  chipRow(chips: { text: string; color?: string }[], gap = 3, fontSize: number = PDF_FONT.eyebrow) {
    if (chips.length === 0) return;
    const rowH = 6;
    this.checkPage(rowH + 3);
    let x = this.margin;
    this.doc.setFontSize(fontSize);
    this.doc.setFont(this.fontFamily, "bold");
    for (const c of chips) {
      const textW = this.doc.getTextWidth(c.text) as number;
      const chipW = textW + 3 * 2;
      if (x > this.margin && x + chipW > this.margin + this.contentW) {
        x = this.margin;
        this.y += rowH + 2.5;
        this.checkPage(rowH + 3);
      }
      this.chip(c.text, x, this.y, c.color, fontSize);
      x += chipW + gap;
    }
    this.y += rowH + PDF_SPACE.cardGap;
  }

  /** "한눈에 보기" 통계 카드 N개를 한 줄에 균등 배치(2~4 column). */
  statCards(items: { label: string; value: string }[]) {
    if (items.length === 0) return;
    const gap = PDF_SPACE.cardGap;
    const cardW = (this.contentW - gap * (items.length - 1)) / items.length;
    const cardH = 22;
    this.checkPage(cardH + 4);
    const [br, bgc, bb] = hexToRgb(PDF_COLORS.border);
    const [lr, lg, lb] = hexToRgb(PDF_COLORS.bgLight);
    for (const [i, it] of items.entries()) {
      const x = this.margin + i * (cardW + gap);
      this.doc.setFillColor(lr, lg, lb);
      this.doc.setDrawColor(br, bgc, bb);
      this.doc.setLineWidth(0.22);
      this.doc.roundedRect(x, this.y, cardW, cardH, 2.5, 2.5, "FD");
      const [pr, pg, pb] = hexToRgb(PDF_COLORS.primary);
      this.doc.setFontSize(17);
      this.doc.setFont(this.fontFamily, "bold");
      this.doc.setTextColor(pr, pg, pb);
      this.doc.text(it.value, x + cardW / 2, this.y + cardH / 2 - 1, { align: "center" });
      const [sr, sg, sb] = hexToRgb(PDF_COLORS.secondary);
      this.doc.setFontSize(PDF_FONT.metadata);
      this.doc.setFont(this.fontFamily, "normal");
      this.doc.setTextColor(sr, sg, sb);
      this.doc.text(it.label, x + cardW / 2, this.y + cardH / 2 + 5, { align: "center" });
    }
    this.y += cardH + PDF_SPACE.cardGap + 2;
  }

  async imageProportional(url: string, maxWmm = 80, maxHmm = 65) {
    const dataUrl = await loadImageDataUrl(url);
    if (!dataUrl) return false;
    const dims = await imageDims(dataUrl);
    let w = maxWmm;
    let h = maxHmm;
    if (dims && dims.w > 0 && dims.h > 0) {
      const ratio = dims.w / dims.h;
      if (maxWmm / ratio <= maxHmm) {
        w = maxWmm;
        h = maxWmm / ratio;
      } else {
        h = maxHmm;
        w = maxHmm * ratio;
      }
    }
    this.checkPage(h + 4);
    try {
      this.doc.addImage(dataUrl, pdfImageFormat(url), this.margin, this.y, w, h);
    } catch {
      return false;
    }
    this.y += h + 3;
    return true;
  }

  pageNumbers() {
    const totalPages = (this.doc.internal as { pages: unknown[] }).pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      this.doc.setPage(i);
      this.doc.setFontSize(9);
      this.doc.setTextColor(150, 150, 150);
      this.doc.text(`${i} / ${totalPages}`, this.pageW / 2, this.pageH - 8, { align: "center" });
    }
  }

  save(filename: string) {
    this.doc.save(filename);
  }

  /** 통합 PDF에서 다른 PDF(실제 제출 PDF 등)와 pdf-lib으로 병합하기 위한 원시 바이트. */
  toBytes(): ArrayBuffer {
    return this.doc.output("arraybuffer") as ArrayBuffer;
  }
}

// ─── PDF merge (pdf-lib) — 여러 PDF를 "페이지 그대로" 하나로 합친다 ────────────
// PDF → 이미지 → PDF로 재렌더링하지 않는다: 각 원본 PDF의 페이지 객체를 그대로 복사한다.

export interface PdfMergeFailure {
  index: number;
  reason: string;
}

/** 손상되었거나 암호화된 PDF가 섞여 있어도 전체 병합을 중단하지 않고, 그 조각만 건너뛴다. */
export async function mergePdfDocuments(buffers: (ArrayBuffer | Uint8Array)[]): Promise<{ bytes: Uint8Array; failures: PdfMergeFailure[]; pageCounts: number[] }> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  const failures: PdfMergeFailure[] = [];
  const pageCounts: number[] = [];
  for (let i = 0; i < buffers.length; i++) {
    pageCounts.push(0);
    try {
      const src = await PDFDocument.load(buffers[i], { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const pg of pages) merged.addPage(pg);
      pageCounts[i] = pages.length;
    } catch (e) {
      failures.push({ index: i, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  const bytes = await merged.save();
  return { bytes, failures, pageCounts };
}

// ─── DOCX: docx 패키지 기반 공용 헬퍼 ───────────────────────────────────────────

export async function loadDocx() {
  return await import("docx");
}

export type DocxModule = Awaited<ReturnType<typeof loadDocx>>;

/** makeDocxHelpers()에 넘기는 spacing/색 override — 생략하면 기존(탭별 내보내기/
 * submission-export.ts) 문서와 100% 동일한 값을 쓴다. 포트폴리오 렌더러만 명시적으로
 * 새 spacing guide 값을 넘긴다(PdfLayoutConfig와 같은 패턴). */
export interface DocxSpacingConfig {
  dividerBefore?: number;
  dividerAfter?: number;
  dividerColor?: string;
  h2Before?: number;
  h2After?: number;
  paragraphColor?: string;
}

export function makeDocxHelpers(mod: DocxModule, spacingConfig: DocxSpacingConfig = {}) {
  const { Paragraph, TextRun, HeadingLevel, BorderStyle, PageBreak, Table, TableRow, TableCell, WidthType, AlignmentType } = mod;

  const h1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 100 } });
  // spacing 값은 twips(1/20pt) — mm 가이드는 1mm≈56.7twips로 환산해 넘긴다.
  const h2 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: spacingConfig.h2Before ?? 200, after: spacingConfig.h2After ?? 100 } });

  const p = (text: string, bold = false, color = spacingConfig.paragraphColor ?? "111827", size = 22) =>
    new Paragraph({ children: [new TextRun({ text, bold, color, size })], spacing: { after: 80 } });

  const labeledP = (label: string, value: string) =>
    new Paragraph({
      children: [new TextRun({ text: `${label}: `, bold: true, size: 22 }), new TextRun({ text: value, size: 22 })],
      spacing: { after: 60 },
    });

  /** 구분선 — 기본값은 기존과 동일, 포트폴리오는 위/아래 여백을 넉넉히 둔 값(6~8mm/5~7mm)을 넘긴다. */
  const divider = () =>
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: spacingConfig.dividerColor ?? "cccccc" } },
      spacing: { before: spacingConfig.dividerBefore ?? 120, after: spacingConfig.dividerAfter ?? 120 },
    });

  const outlineBorders = {
    top: { style: BorderStyle.SINGLE, size: 3, color: "D9DEE7" },
    bottom: { style: BorderStyle.SINGLE, size: 3, color: "D9DEE7" },
    left: { style: BorderStyle.SINGLE, size: 3, color: "D9DEE7" },
    right: { style: BorderStyle.SINGLE, size: 3, color: "D9DEE7" },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
    insideVertical: { style: BorderStyle.SINGLE, size: 3, color: "D9DEE7" },
  };

  /** outline 배지의 docx 근사(academic 톤 — 색 채움 대신 얇은 테두리+색 텍스트) — N개를 한 줄로. */
  const chipRow = (chips: { text: string; color?: string }[]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: outlineBorders,
      rows: [
        new TableRow({
          children: chips.map(
            (c) =>
              new TableCell({
                width: { size: 100 / chips.length, type: WidthType.PERCENTAGE },
                margins: { top: 60, bottom: 60, left: 80, right: 80 },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: c.text, color: (c.color ?? "183153").replace("#", ""), bold: true, size: 16 })],
                  }),
                ],
              })
          ),
        }),
      ],
    });

  /** "한눈에 보기" 통계 카드의 docx 근사 — 옅은 배경 표 셀에 값+라벨 두 줄. */
  const statCards = (items: { label: string; value: string }[]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: outlineBorders,
      rows: [
        new TableRow({
          children: items.map(
            (it) =>
              new TableCell({
                width: { size: 100 / items.length, type: WidthType.PERCENTAGE },
                shading: { fill: "F5F7FA" },
                margins: { top: 120, bottom: 120, left: 80, right: 80 },
                children: [
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: it.value, bold: true, size: 28, color: "183153" })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: it.label, size: 16, color: "6B7280" })] }),
                ],
              })
          ),
        }),
      ],
    });

  /** 연구일지 timeline 스타일 — 항목 제목 문단에 색 포인트 왼쪽 테두리를 붙인다. */
  const timelineHeading = (text: string, color = "183153") =>
    new Paragraph({
      children: [new TextRun({ text, bold: true, color, size: 26 })],
      indent: { left: 200 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color, space: 8 } },
      spacing: { before: 160, after: 40 },
    });

  /** 섹션 간 강제 페이지 구분 (전체 내보내기에서 사용). */
  const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

  return { h1, h2, p, labeledP, divider, pageBreak, chipRow, statCards, timelineHeading };
}

export async function buildImageParagraph(mod: DocxModule, url: string, maxWpx = 420, maxHpx = 320) {
  const { Paragraph, ImageRun, AlignmentType } = mod;
  const dataUrl = await loadImageDataUrl(url);
  if (!dataUrl) return null;
  const dims = await imageDims(dataUrl);
  let w = maxWpx;
  let h = maxHpx;
  if (dims && dims.w > 0 && dims.h > 0) {
    const ratio = dims.w / dims.h;
    if (maxWpx / ratio <= maxHpx) {
      w = maxWpx;
      h = maxWpx / ratio;
    } else {
      h = maxHpx;
      w = maxHpx * ratio;
    }
  }
  const base64 = dataUrl.split(",")[1] ?? "";
  const buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  try {
    return new Paragraph({
      children: [
        new ImageRun({
          data: buf,
          transformation: { width: Math.round(w), height: Math.round(h) },
          type: docxImageType(url),
        }),
      ],
      spacing: { after: 80 },
      alignment: AlignmentType.LEFT,
    });
  } catch {
    return null;
  }
}
