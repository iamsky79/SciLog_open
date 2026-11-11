// 제출물(연구계획서/연구일지/결과보고서) 단위 공용 export.
// R&E 페이지가 이미 갖고 있는 섹션 렌더러(render-plan/report/journal.ts)를 그대로
// 재사용한다 — 같은 종류의 문서라면 "R&E 페이지에서 내보내기"와 "제출물 관리에서
// 내보내기"의 결과물이 100% 같은 스타일이어야 하기 때문이다. 새 렌더러를 만들지 않는다.
//
// "작성내용"은 현재 DB가 아니라 그 제출의 스냅샷(snapshots.at(-1)) 내용을 쓴다 —
// 스냅샷이 없는 과거 데이터는 currentContent로 폴백하되(기존 SubmissionContent와 동일한
// 원칙), 그 사실을 결과물에도 표시해 "지금 원본을 과거 제출본인 것처럼" 보여주지 않는다.

import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  PdfWriter,
  mergePdfDocuments,
  loadDocx,
  fmtDate,
  sanitizeDownloadName,
  submittedFileBaseName,
  extOf,
  isPdfUrl,
} from "./common";
import { renderPlanSectionPDF, buildPlanSectionChildren } from "./render-plan";
import { renderReportSectionPDF, buildReportSectionChildren } from "./render-report";
import { renderJournalSectionPDF, buildJournalSectionChildren } from "./render-journal";
import type { EntityKind, PlanExportPayload, ReportExportPayload, JournalExportPayload, JournalEntryExport } from "./types";
import type { HubItem, HubActivityKind } from "@/lib/submissions/hub";
import { latestAttachmentsOf } from "@/lib/submissions/hub";
import { downloadFile } from "@/lib/submissions/download";
import { resolveSubmissionFileUrl } from "@/lib/uploads/submissionPdf";

// ── 공통 shape: 학생 HubItem과 교사 TeacherArchiveItem 둘 다 만족한다 ─────────
export interface ExportableSubmission extends HubItem {
  /** 학생 화면에서는 항상 undefined — 프로젝트/팀명(projectName)을 그대로 쓴다. */
  studentNames?: string[];
}

const ACTIVITY_TO_ENTITY_KIND: Partial<Record<HubActivityKind, EntityKind>> = {
  "R&E": "rne",
  동아리: "club",
  창의개인연구: "individual",
};

function entityKindOf(item: ExportableSubmission): EntityKind {
  return ACTIVITY_TO_ENTITY_KIND[item.activityKind] ?? "individual";
}

function whoLabel(item: ExportableSubmission): string {
  if (item.studentNames && item.studentNames.length > 0) return item.studentNames.join(", ");
  return item.projectName;
}

function latestFields(item: ExportableSubmission): Record<string, unknown> | null {
  return item.snapshots.at(-1)?.content.fields ?? item.currentContent;
}

function hasSnapshotContent(item: ExportableSubmission): boolean {
  return item.snapshots.length > 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

// ── HubItem → 기존 export payload 변환 (기존 렌더러를 그대로 재사용하기 위한 어댑터) ──

function planPayloadFromItem(item: ExportableSubmission): PlanExportPayload {
  const fields = latestFields(item) ?? {};
  return {
    entityKind: entityKindOf(item),
    entityName: item.projectName,
    periodLabel: item.schoolYear ? `${item.schoolYear}학년도` : null,
    teacherName: null,
    members: item.studentNames ?? [],
    title: str(fields["연구제목"]) ?? item.title,
    motivation: str(fields["연구 동기 및 목적"]),
    method: str(fields["연구 방법"]),
    expectedResult: str(fields["기대 결과"]),
    status: item.phase === "not_started" ? "draft" : (item.phase === "revision_requested" ? "rejected" : item.phase === "approved" ? "approved" : "submitted"),
    submittedAt: item.submittedAt,
    feedback: item.feedback,
    fileUrls: latestAttachmentsOf(item).map((a) => a.url),
    generatedAt: new Date().toISOString(),
  };
}

function reportPayloadFromItem(item: ExportableSubmission): ReportExportPayload {
  const fields = latestFields(item) ?? {};
  const attachments = latestAttachmentsOf(item);
  const [primary, ...extra] = attachments;
  return {
    entityKind: entityKindOf(item),
    entityName: item.projectName,
    periodLabel: item.schoolYear ? `${item.schoolYear}학년도` : null,
    teacherName: null,
    members: item.studentNames ?? [],
    title: str(fields["제목"]) ?? item.title,
    introduction: str(fields["서론"]),
    conclusion: str(fields["결론"]),
    // "연구 요약 (기존 데이터)"는 이번 변경 이후의 라벨, "연구 요약"은 이전 스냅샷의 라벨 —
    // 과거에 저장된 스냅샷도 그대로 복원되도록 둘 다 확인한다.
    summary: str(fields["연구 요약 (기존 데이터)"]) ?? str(fields["연구 요약"]),
    status: item.phase === "not_started" ? "draft" : (item.phase === "revision_requested" ? "rejected" : item.phase === "approved" ? "approved" : "submitted"),
    submittedAt: item.submittedAt,
    feedback: item.feedback,
    primaryFile: primary ?? null,
    extraFiles: extra,
    generatedAt: new Date().toISOString(),
  };
}

function journalPayloadFromItem(item: ExportableSubmission): JournalExportPayload {
  const fields = latestFields(item) ?? {};
  const entries: JournalEntryExport[] = [
    {
      id: item.id,
      date: item.submittedAt ?? item.updatedAt ?? new Date().toISOString(),
      title: item.title,
      authorName: whoLabel(item),
      status: item.phase === "approved" ? "approved" : item.phase === "revision_requested" ? "rejected" : "submitted",
      fields: Object.entries(fields)
        .filter(([label, v]) => label !== "참여자" && typeof v === "string" && v.trim().length > 0)
        .map(([label, value]) => ({ label, value: value as string })),
      images: [],
      files: latestAttachmentsOf(item).map((a) => ({ url: a.url, name: a.name })),
      participants: [],
      teacherFeedback: item.feedback,
    },
  ];
  return {
    entityKind: entityKindOf(item),
    entityName: item.projectName,
    periodLabel: item.schoolYear ? `${item.schoolYear}학년도` : null,
    entries,
    generatedAt: new Date().toISOString(),
  };
}

async function renderAuthoredContentPDF(item: ExportableSubmission): Promise<Uint8Array> {
  const w = await PdfWriter.create(JSON.stringify(item.currentContent ?? {}));
  if (!hasSnapshotContent(item)) {
    w.line("이 제출본은 과거 제출내용 스냅샷이 저장되지 않아 현재 원본 내용을 표시합니다.", 9, false, "#b45309");
    w.spacer(2);
  }
  if (item.docType === "연구계획서") renderPlanSectionPDF(w, planPayloadFromItem(item));
  else if (item.docType === "결과보고서") renderReportSectionPDF(w, reportPayloadFromItem(item));
  else await renderJournalSectionPDF(w, journalPayloadFromItem(item));
  w.pageNumbers();
  return new Uint8Array(w.toBytes());
}

async function buildAuthoredContentDocxChildren(item: ExportableSubmission) {
  const mod = await loadDocx();
  const children =
    item.docType === "연구계획서"
      ? buildPlanSectionChildren(mod, planPayloadFromItem(item))
      : item.docType === "결과보고서"
      ? buildReportSectionChildren(mod, reportPayloadFromItem(item))
      : await buildJournalSectionChildren(mod, journalPayloadFromItem(item));
  return { mod, children };
}

async function renderAuthoredContentDOCXBlob(item: ExportableSubmission): Promise<Blob> {
  const { mod, children } = await buildAuthoredContentDocxChildren(item);
  const { Document, Packer } = mod;
  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBlob(doc);
}

/** "학생 제출 PDF" — 결과보고서 본문 파일 중 실제 PDF인 것만(레거시 doc/hwp는 병합 대상이 아님). */
function submittedPdfOf(item: ExportableSubmission): { name: string; url: string } | null {
  if (item.docType !== "결과보고서") return null;
  const [primary] = latestAttachmentsOf(item);
  if (primary && isPdfUrl(primary.url)) return primary;
  return null;
}

/** 첨부파일 — 결과보고서는 primary(제출 PDF)를 제외한 나머지만, 그 외 문서는 전체. */
function attachmentsOf(item: ExportableSubmission): { name: string; url: string }[] {
  const all = latestAttachmentsOf(item);
  if (item.docType === "결과보고서" && submittedPdfOf(item)) return all.slice(1);
  return all;
}

// ── export context: dialog가 항목 존재 여부만 보고 옵션을 켜고/끄고 할 수 있게 ──

export interface SubmissionExportContext {
  count: number;
  hasAuthoredContent: boolean;
  submittedPdfCount: number;
  attachmentCount: number;
  hasTeacherFeedback: boolean;
  hasReviewHistory: boolean;
}

export function getSubmissionExportContext(items: ExportableSubmission[]): SubmissionExportContext {
  return {
    count: items.length,
    hasAuthoredContent: items.length > 0,
    submittedPdfCount: items.filter((i) => submittedPdfOf(i)).length,
    attachmentCount: items.reduce((sum, i) => sum + attachmentsOf(i).length, 0),
    hasTeacherFeedback: items.some((i) => !!i.feedback),
    hasReviewHistory: items.some((i) => i.snapshots.length > 0),
  };
}

export interface SubmissionExportOptions {
  includeAuthoredContent: boolean;
  includeSubmittedPdf: boolean;
  includeAttachments: boolean;
  includeTeacherFeedback: boolean;
  includeReviewHistory: boolean;
  outputFormat: "pdf" | "zip";
  /** ZIP에서만 의미가 있다. individual_pdf = 제출물별 개별 PDF, docx = 통합 Word. */
  authoredContentFormat: "pdf" | "docx" | "individual_pdf";
}

export const DEFAULT_EXPORT_OPTIONS: SubmissionExportOptions = {
  includeAuthoredContent: true,
  includeSubmittedPdf: true,
  includeAttachments: true,
  includeTeacherFeedback: false,
  includeReviewHistory: false,
  outputFormat: "pdf",
  authoredContentFormat: "pdf",
};

/** 연구 흐름 순서: 계획서 → 일지(날짜순) → 보고서. 같은 순위끼리는 원래 순서 유지. */
function canonicalOrder(items: ExportableSubmission[]): ExportableSubmission[] {
  const rank: Record<string, number> = { 연구계획서: 0, 연구일지: 1, 결과보고서: 2 };
  return [...items].sort((a, b) => {
    const r = rank[a.docType] - rank[b.docType];
    if (r !== 0) return r;
    if (a.docType === "연구일지") return (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "");
    return 0;
  });
}

function reviewHistoryText(item: ExportableSubmission): string {
  const lines = [`${whoLabel(item)} · ${item.docType} 제출/검토 이력`, ""];
  if (item.snapshots.length === 0) {
    lines.push("(저장된 이력이 없습니다 — 과거 데이터)");
  } else {
    item.snapshots.forEach((s, i) => {
      lines.push(`${i + 1}차 제출 · ${fmtDate(s.submittedAt)} · ${s.status}`);
      if (s.feedback) lines.push(`  피드백: ${s.feedback}`);
    });
  }
  return lines.join("\n");
}

function feedbackText(item: ExportableSubmission): string {
  return `${whoLabel(item)} · ${item.docType} 교사 피드백\n\n${item.feedback ?? "(없음)"}`;
}

async function feedbackPdfBytes(item: ExportableSubmission): Promise<Uint8Array> {
  const w = await PdfWriter.create(feedbackText(item));
  w.line("교사 피드백", 14, true);
  w.spacer(1);
  w.labeledLine("제출물", `${whoLabel(item)} · ${item.docType}`, 10);
  w.spacer(2);
  w.line(item.feedback ?? "(없음)", 10.5);
  return new Uint8Array(w.toBytes());
}

async function historyPdfBytes(item: ExportableSubmission): Promise<Uint8Array> {
  const w = await PdfWriter.create(reviewHistoryText(item));
  w.line("제출/검토 이력", 14, true);
  w.spacer(1);
  w.labeledLine("제출물", `${whoLabel(item)} · ${item.docType}`, 10);
  w.spacer(2);
  if (item.snapshots.length === 0) {
    w.line("저장된 이력이 없습니다(과거 데이터).", 10, false, "#9ca3af");
  } else {
    item.snapshots.forEach((s, i) => {
      w.line(`${i + 1}차 제출 · ${fmtDate(s.submittedAt)} · ${s.status}`, 10.5, true);
      if (s.feedback) w.line(`피드백: ${s.feedback}`, 10);
      w.spacer(1);
    });
  }
  return new Uint8Array(w.toBytes());
}

async function dividerPdfBytes(item: ExportableSubmission): Promise<Uint8Array> {
  const w = await PdfWriter.create("학생 제출 원본 보고서");
  w.line("학생 제출 원본 보고서", 16, true);
  w.spacer(2);
  w.labeledLine("종류", item.docType, 11);
  w.labeledLine("학생/팀", whoLabel(item), 11);
  w.labeledLine("제출일", fmtDate(item.submittedAt) || "-", 11);
  const outcome = item.phase === "approved" ? "승인 완료" : item.phase === "revision_requested" ? "수정 요청" : "검토 중";
  w.labeledLine("상태", outcome, 11);
  return new Uint8Array(w.toBytes());
}

export interface ExportResult {
  warnings: string[];
}

function exportFileBaseName(items: ExportableSubmission[]): string {
  if (items.length === 1) {
    const item = items[0];
    return submittedFileBaseName({ schoolYear: item.schoolYear, activityKind: item.activityKind, who: whoLabel(item), docType: item.docType });
  }
  const years = [...new Set(items.map((i) => i.schoolYear).filter(Boolean))];
  const yearLabel = years.length === 1 ? years[0] : "선택학년도";
  return sanitizeDownloadName(`SciLog_${yearLabel}_선택제출물_${items.length}건_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
}

/** 통합 PDF — 작성내용(jsPDF)과 학생 제출 PDF(원본 페이지)를 pdf-lib으로 그대로 병합한다. */
async function exportAsMergedPdf(items: ExportableSubmission[], options: SubmissionExportOptions): Promise<ExportResult> {
  const ordered = canonicalOrder(items);
  const buffers: (ArrayBuffer | Uint8Array)[] = [];
  const warnings: string[] = [];

  for (const item of ordered) {
    if (options.includeAuthoredContent) buffers.push(await renderAuthoredContentPDF(item));
    if (options.includeTeacherFeedback && item.feedback) buffers.push(await feedbackPdfBytes(item));
    if (options.includeReviewHistory) buffers.push(await historyPdfBytes(item));
    if (options.includeSubmittedPdf) {
      const pdf = submittedPdfOf(item);
      if (pdf) {
        try {
          const url = await resolveSubmissionFileUrl(pdf.url);
          if (!url) throw new Error("접근 권한이 없거나 파일을 찾을 수 없습니다.");
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
          const bytes = await resp.arrayBuffer();
          buffers.push(await dividerPdfBytes(item));
          buffers.push(bytes);
        } catch {
          warnings.push(`${whoLabel(item)}의 제출 PDF 1개를 통합 PDF에 병합하지 못했습니다.`);
        }
      }
    }
  }

  if (options.includeAttachments && items.some((i) => attachmentsOf(i).some((a) => !isPdfUrl(a.url)))) {
    warnings.push("선택한 첨부파일 중 일부는 통합 PDF에 포함할 수 없습니다. 첨부파일 원본까지 포함하려면 ZIP 묶음을 선택해주세요.");
  }

  const { bytes, failures } = await mergePdfDocuments(buffers);
  for (const f of failures) warnings.push(`PDF 조각 ${f.index + 1}번을 병합하지 못해 건너뛰었습니다.`);
  saveAs(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${exportFileBaseName(items)}.pdf`);
  return { warnings };
}

/** ZIP — 원본 형식을 그대로 보존한다(첨부파일을 PDF로 변환하지 않음). */
async function exportAsZip(items: ExportableSubmission[], options: SubmissionExportOptions): Promise<ExportResult> {
  const zip = new JSZip();
  const warnings: string[] = [];
  const ordered = canonicalOrder(items);

  // "작성내용 = 하나의 통합 PDF" 옵션만 zip 루트에 별도로 둔다.
  // (개별 PDF/개별 Word는 아래에서 제출물별 폴더 안에 각각 만든다.)
  if (options.includeAuthoredContent && options.authoredContentFormat === "pdf") {
    const buffers: (ArrayBuffer | Uint8Array)[] = [];
    for (const item of ordered) buffers.push(await renderAuthoredContentPDF(item));
    const { bytes } = await mergePdfDocuments(buffers);
    zip.file("작성내용.pdf", bytes as unknown as ArrayBuffer);
  }

  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    const folder = sanitizeDownloadName(`${String(i + 1).padStart(2, "0")}_${item.docType}_${whoLabel(item)}`);
    const dir = zip.folder(folder);
    if (!dir) continue;

    if (options.includeAuthoredContent && options.authoredContentFormat === "individual_pdf") {
      dir.file("작성내용.pdf", await renderAuthoredContentPDF(item));
    } else if (options.includeAuthoredContent && options.authoredContentFormat === "docx") {
      dir.file("작성내용.docx", await renderAuthoredContentDOCXBlob(item));
    }

    if (options.includeSubmittedPdf) {
      const pdf = submittedPdfOf(item) ?? (item.docType === "결과보고서" ? latestAttachmentsOf(item)[0] ?? null : null);
      if (pdf) {
        try {
          const url = await resolveSubmissionFileUrl(pdf.url);
          if (!url) throw new Error("접근 권한이 없거나 파일을 찾을 수 없습니다.");
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(String(resp.status));
          dir.file(`main${extOf(pdf.url)}`, await resp.blob());
        } catch {
          warnings.push(`${whoLabel(item)}의 제출 파일을 내려받지 못해 ZIP에서 제외했습니다.`);
        }
      }
    }

    if (options.includeAttachments) {
      const attachments = attachmentsOf(item);
      for (let a = 0; a < attachments.length; a++) {
        try {
          const resp = await fetch(attachments[a].url);
          if (!resp.ok) throw new Error(String(resp.status));
          dir.file(`att${String(a + 1).padStart(2, "0")}${extOf(attachments[a].url)}`, await resp.blob());
        } catch {
          warnings.push(`${whoLabel(item)}의 첨부파일 1개를 내려받지 못해 ZIP에서 제외했습니다.`);
        }
      }
    }

    if (options.includeTeacherFeedback && item.feedback) dir.file("feedback.txt", feedbackText(item));
    if (options.includeReviewHistory) dir.file("history.txt", reviewHistoryText(item));
  }

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, `${exportFileBaseName(items)}.zip`);
  return { warnings };
}

export async function exportSubmissions(items: ExportableSubmission[], options: SubmissionExportOptions): Promise<ExportResult> {
  if (items.length === 0) return { warnings: ["선택된 제출물이 없습니다."] };
  return options.outputFormat === "pdf" ? exportAsMergedPdf(items, options) : exportAsZip(items, options);
}

/** 제출물 하나에 대한 개별 다운로드 메뉴에서 쓰는 헬퍼들 — 새 로직 없이 기존 downloadFile 재사용. */
export async function downloadAuthoredContentPdf(item: ExportableSubmission): Promise<void> {
  const bytes = await renderAuthoredContentPDF(item);
  saveAs(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), `${exportFileBaseName([item])}_작성내용.pdf`);
}

export async function downloadAuthoredContentDocx(item: ExportableSubmission): Promise<void> {
  const blob = await renderAuthoredContentDOCXBlob(item);
  saveAs(blob, `${exportFileBaseName([item])}_작성내용.docx`);
}

export async function downloadSubmittedPdf(item: ExportableSubmission): Promise<void> {
  const pdf = submittedPdfOf(item) ?? (item.docType === "결과보고서" ? latestAttachmentsOf(item)[0] ?? null : null);
  if (!pdf) return;
  // downloadFile 내부에서 submission-pdfs 값이면 signed URL로 알아서 바꾼다.
  await downloadFile(pdf.url, `${exportFileBaseName([item])}_제출파일${extOf(pdf.url)}`);
}

export { submittedPdfOf, attachmentsOf };
