"use client";

import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Accordion } from "@/components/ui/Accordion";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ReviewActionButtons } from "@/components/ReviewActionButtons";
import { RevisionRequestModal } from "@/components/RevisionRequestModal";
import { isDocumentEditable } from "@/lib/review/editability";
import { approveSubmission, deriveReviewPhase, notifyReviewChanged, requestRevision, undoApproval, type ReviewTarget } from "@/lib/review/actions";
import { buildSnapshotContent, recordSubmissionSnapshot } from "@/lib/submissions/snapshot";
import { reportDisplayFields } from "@/lib/report-fields";
import { SUBMISSION_PDF_ACCEPT, validateSubmissionPdf } from "@/lib/uploads/validation";
import { resolveSubmissionFileUrl } from "@/lib/uploads/submissionPdf";
import { fetchProjectExportItems, type ProjectExportContext } from "@/lib/submissions/hub";
import type { ExportableSubmission } from "@/lib/export/submission-export";
import { SubmissionExportDialog } from "@/components/submissions/ExportDialog";
import type { PlanStatus, ReportSchedule, ResearchReport } from "@/lib/database.types";

type EntityType = "rne" | "club" | "individual";

const TYPE_LABEL: Record<EntityType, string> = { rne: "RnE", club: "동아리", individual: "창의개인" };

const STATUS_CONFIG: Record<PlanStatus, { label: string; tone: Tone }> = {
  draft: { label: "임시저장", tone: "gray" },
  submitted: { label: "검토 대기", tone: "gold" },
  approved: { label: "승인 완료", tone: "green" },
  rejected: { label: "수정 요청", tone: "red" },
  historical: { label: "과거 기록", tone: "gray" },
};

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || "file").slice(0, 60);
}

function sanitizeFullFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return sanitizeFileName(name);
  const ext = name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, "");
  return `${sanitizeFileName(name.slice(0, dot))}.${ext || "bin"}`;
}

function fmtDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ko-KR");
}

function findApplicableSchedule(schedules: ReportSchedule[], entityType: string, entityId: string): ReportSchedule | null {
  const byId = schedules.find((s) => s.entity_id === entityId);
  if (byId) return byId;
  const byType = schedules.find((s) => s.entity_type === entityType && !s.entity_id);
  if (byType) return byType;
  return schedules.find((s) => !s.entity_type && !s.entity_id) ?? null;
}

function DeadlineBanner({ schedule }: { schedule: ReportSchedule }) {
  const deadline = new Date(schedule.deadline);
  const diff = Math.ceil((deadline.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isPast = deadline < new Date();
  const isUrgent = !isPast && diff <= 3;
  const bg = isPast ? "bg-red-50 border-red-200" : isUrgent ? "bg-orange-50 border-orange-200" : "bg-sky-50 border-sky-200";
  const text = isPast ? "text-red-700" : isUrgent ? "text-orange-700" : "text-sky-700";
  const label = isPast ? "마감 지남" : diff === 0 ? "D-day" : `D-${diff}`;
  return (
    <div className={`rounded-lg border ${bg} px-4 py-3`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${text}`}>결과보고서 제출 마감 · {label}</span>
        <span className={`text-xs ${text}`}>
          {deadline.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

interface ReportSectionProps {
  entityType: EntityType;
  entityId: string;
  /** rne/club은 team.id, individual은 null */
  teamId: string | null;
  currentUserId: string;
  canEdit: boolean;
  canReview: boolean;
  entityName: string;
  /** 이 결과보고서를 공용 SubmissionExportDialog로 내보내기 위한 조회 컨텍스트 — 없으면 내보내기 버튼을 표시하지 않는다. */
  exportCtx?: ProjectExportContext;
  onChanged?: () => void;
}

export function ReportSection({
  entityType, entityId, teamId, currentUserId, canEdit, canReview, entityName, exportCtx, onChanged,
}: ReportSectionProps) {
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [report, setReport] = useState<ResearchReport | null>(null);
  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);

  const [title, setTitle] = useState("");
  const [introduction, setIntroduction] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  const [showCancelSubmitModal, setShowCancelSubmitModal] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);

  // submission-pdfs가 private 버킷이라 report.file_url을 그대로 <a href>로 열 수
  // 없다 — 클릭 시점에 signed URL을 새로 받아 그 창으로 이동시킨다. 팝업 차단을
  // 피하려고 새 탭을 먼저(동기적으로) 연 뒤, signed URL이 오면 그 탭의 location만
  // 바꾼다.
  const openSubmittedPdf = async () => {
    if (!report?.file_url) return;
    const win = window.open("", "_blank");
    const url = await resolveSubmissionFileUrl(report.file_url);
    if (!url) {
      win?.close();
      alert("파일을 열 수 없습니다. 접근 권한을 확인해주세요.");
      return;
    }
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const [exportingDoc, setExportingDoc] = useState(false);
  const [exportItems, setExportItems] = useState<ExportableSubmission[] | null>(null);

  const handleOpenExport = async () => {
    if (!exportCtx) return;
    setExportingDoc(true);
    try {
      const items = await fetchProjectExportItems(exportCtx);
      const reportItems = items.filter((i) => i.docType === "결과보고서");
      if (reportItems.length === 0) {
        alert("내보낼 수 있는 제출된 결과보고서가 없습니다.");
        return;
      }
      setExportItems(reportItems);
    } catch (e) {
      console.error("결과보고서 내보내기 자료 조회 실패:", e);
      alert("자료를 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      setExportingDoc(false);
    }
  };

  const load = async () => {
    const supabase = createClient();
    setLoading(true);
    const [{ data: reportData }, { data: scheduleRows }] = await Promise.all([
      supabase.from("research_reports").select("*").eq("entity_type", entityType).eq("entity_id", entityId).maybeSingle(),
      supabase.from("report_schedules").select("*").eq("submission_type", "report"),
    ]);
    const rpt = (reportData as ResearchReport) ?? null;
    setReport(rpt);
    setTitle(rpt?.title ?? "");
    setIntroduction(rpt?.introduction ?? "");
    setConclusion(rpt?.conclusion ?? "");
    setSchedule(findApplicableSchedule((scheduleRows as ReportSchedule[]) ?? [], entityType, entityId));
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, teamId]);

  const status: PlanStatus = report?.status ?? "draft";
  const hasContent = report != null;

  useEffect(() => {
    if (loading || autoOpened) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(!hasContent);
    setAutoOpened(true);
  }, [loading, autoOpened, hasContent]);

  const isEditable = isDocumentEditable(canEdit, status);

  const handleSave = async (submit: boolean) => {
    setFileError(null);
    setSaving(true);
    const supabase = createClient();
    const now = new Date().toISOString();

    let fileUrl = report?.file_url ?? null;
    let fileName = report?.file_name ?? null;
    let originalFileName = report?.original_file_name ?? null;

    if (primaryFile) {
      const validation = validateSubmissionPdf(primaryFile);
      if (!validation.ok) {
        setFileError(validation.error!);
        setSaving(false);
        return;
      }
      setUploading(true);
      const year = new Date().getFullYear();
      const newFileName = sanitizeFullFileName(`${year}_${TYPE_LABEL[entityType]}_${sanitizeFileName(entityName)}.pdf`);
      const renamed = new File([primaryFile], newFileName, { type: "application/pdf" });
      // 제출 본문 파일은 PDF 전용 private 버킷에 저장한다 — 버킷 자체의
      // allowed_mime_types로도 PDF가 아니면 업로드가 거부된다
      // (supabase/migrations/036_submission_pdf_bucket.sql,
      // 037_submission_pdf_bucket_private.sql). private 버킷이라 공개 URL을 미리
      // 계산해봐야 그대로는 열리지 않으므로, getPublicUrl() 대신 storage object
      // path 자체를 저장한다 — 실제 열람은 항상 /api/submissions/pdf-signed-url을
      // 거쳐 그때그때 signed URL을 받는다(resolveSubmissionFileUrl).
      const storePath = `${currentUserId}/${entityType}/${entityId}/${Date.now()}_${newFileName}`;
      const { error: upErr } = await supabase.storage.from("submission-pdfs").upload(storePath, renamed, { upsert: true });
      setUploading(false);
      if (upErr) {
        setFileError(`파일 업로드 실패: ${upErr.message}`);
        setSaving(false);
        return;
      }
      fileUrl = storePath;
      fileName = newFileName;
      originalFileName = primaryFile.name;
    }

    if (submit && !fileUrl) {
      setFileError("결과보고서 파일을 첨부해주세요.");
      setSaving(false);
      return;
    }

    const extraUrls: string[] = [...(report?.extra_file_urls ?? [])];
    for (const ef of extraFiles) {
      const efName = sanitizeFullFileName(ef.name);
      const ep = `reports/${entityType}/${entityId}/${Date.now()}_extra_${efName}`;
      const { error: ee } = await supabase.storage.from("reports").upload(ep, new File([ef], efName, { type: ef.type }), { upsert: true });
      if (!ee) {
        const { data: eu } = supabase.storage.from("reports").getPublicUrl(ep);
        extraUrls.push(eu.publicUrl);
      }
    }

    const isLate = submit && schedule != null && new Date() > new Date(schedule.deadline);

    // summary는 절대 여기서 쓰지 않는다 — legacy 필드라 새 UI는 introduction/conclusion만
    // 저장하고, 기존 row의 summary 값은 payload에 아예 넣지 않아 그대로 보존한다.
    const payload = {
      team_id: teamId,
      entity_type: entityType, entity_id: entityId,
      title: title || null,
      introduction: introduction || null,
      conclusion: conclusion || null,
      file_url: fileUrl, file_name: fileName, original_file_name: originalFileName,
      extra_file_urls: extraUrls,
      status: submit ? "submitted" : "draft",
      submitted_at: submit ? now : report?.submitted_at ?? null,
      is_late: submit ? isLate : (report?.is_late ?? false),
      created_by: currentUserId, updated_at: now,
      schedule_id: schedule?.id ?? null,
    };
    const result = report?.id
      ? await supabase.from("research_reports").update(payload).eq("id", report.id).select().single()
      : await supabase.from("research_reports").insert(payload).select().single();

    if (result.data) {
      setReport(result.data as ResearchReport);
      setPrimaryFile(null);
      setExtraFiles([]);
      if (submit) {
        // 스냅샷은 이번에 저장한 title/introduction/conclusion과, 이 row에 이미 있던(수정하지
        // 않은) legacy summary까지 모두 포함한다 — 제출 시점의 row 전체 상태를 그대로 남긴다.
        const fields: Record<string, string | null> = { 제목: title || null };
        for (const f of reportDisplayFields({ introduction: introduction || null, conclusion: conclusion || null, summary: report?.summary ?? null })) {
          fields[f.label] = f.value;
        }
        await recordSubmissionSnapshot({
          sourceTable: "research_reports",
          sourceId: result.data.id,
          submittedBy: currentUserId,
          content: buildSnapshotContent(
            fields,
            [
              ...(fileUrl ? [{ name: originalFileName ?? fileName ?? fileUrl, url: fileUrl }] : []),
              ...extraUrls.map((u, i) => ({ name: `추가 자료 ${i + 1}`, url: u })),
            ]
          ),
        });
        setOpen(false);
      }
    } else if (result.error) {
      console.error("결과보고서 저장 실패:", result.error);
      setFileError(`저장 실패: ${result.error.message}`);
    }
    setSaving(false);
    if (submit && result.data) notifyReviewChanged(); // 제출/재제출 시 사이드바 "제출물" 배지 즉시 갱신
    onChanged?.();
  };

  const handleCancelSubmit = async () => {
    if (!report?.id) return;
    const supabase = createClient();
    const { data: updated, error } = await supabase.from("research_reports")
      .update({ status: "draft", submitted_at: null, updated_at: new Date().toISOString() })
      .eq("id", report.id).select().single();
    if (error) {
      console.error("제출 취소 실패:", error);
      alert(`제출 취소 실패: ${error.message}`);
      return;
    }
    if (updated) setReport(updated as ResearchReport);
    setShowCancelSubmitModal(false);
    onChanged?.();
  };

  const reviewTarget: ReviewTarget = { table: "research_reports", id: report?.id ?? "" };

  const handleApprove = async () => {
    setReviewBusy(true);
    const { error } = await approveSubmission(reviewTarget);
    setReviewBusy(false);
    if (error) {
      console.error("결과보고서 승인 실패:", error);
      alert(`승인 실패: ${error}`);
      return;
    }
    await load();
    onChanged?.();
  };

  const handleRequestRevision = async (reason: string) => {
    setReviewBusy(true);
    const { error } = await requestRevision(reviewTarget, reason);
    setReviewBusy(false);
    if (error) {
      console.error("수정 요청 실패:", error);
      alert(`수정 요청 실패: ${error}`);
      return;
    }
    setShowRevisionModal(false);
    await load();
    onChanged?.();
  };

  const handleUndoApproval = async () => {
    setReviewBusy(true);
    const { error } = await undoApproval(reviewTarget);
    setReviewBusy(false);
    if (error) {
      console.error("승인 취소 실패:", error);
      alert(`승인 취소 실패: ${error}`);
      return;
    }
    await load();
    onChanged?.();
  };

  if (loading) return <Card className="text-sm text-slate-400">결과보고서 불러오는 중...</Card>;

  const summaryBadge = (
    <>
      <Badge tone={STATUS_CONFIG[status].tone}>{STATUS_CONFIG[status].label}</Badge>
      {fmtDate(report?.submitted_at ?? null) && <span className="text-xs text-slate-400">{fmtDate(report?.submitted_at ?? null)}</span>}
      {report?.file_url && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openSubmittedPdf();
          }}
          title="다운로드"
        >
          <Download className="h-3.5 w-3.5 text-sky-600 hover:text-sky-800" />
        </button>
      )}
    </>
  );

  return (
    <>
      <Accordion title="결과보고서" summary={summaryBadge} open={open} onToggle={() => setOpen((v) => !v)}>
        {schedule && <DeadlineBanner schedule={schedule} />}

        {status === "submitted" && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-sm font-medium text-amber-700">지도교사 검토 대기 중</span>
            {canEdit && (
              <button type="button" onClick={() => setShowCancelSubmitModal(true)}
                className="text-xs font-medium text-amber-700 underline hover:text-amber-900">
                제출 취소
              </button>
            )}
          </div>
        )}
        {status === "approved" && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm font-medium text-green-700">결과보고서 승인됨</p>
            {report?.feedback && <p className="mt-1 text-sm text-green-600">피드백: {report.feedback}</p>}
            <p className="mt-1 text-xs text-green-600">승인된 결과보고서는 수정할 수 없습니다.</p>
          </div>
        )}
        {status === "rejected" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">결과보고서 수정 요청됨</p>
            {report?.feedback && <p className="mt-1 text-sm text-red-600">수정 요청 사유: {report.feedback}</p>}
            <p className="mt-1 text-xs text-red-500">아래에서 내용을 수정 후 재제출하세요.</p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">제목</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!isEditable}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">서론</label>
          <textarea
            rows={5}
            value={introduction}
            onChange={(e) => setIntroduction(e.target.value)}
            disabled={!isEditable}
            placeholder="연구 배경, 문제의식, 연구 목적 등을 작성하세요."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">결론</label>
          <textarea
            rows={5}
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            disabled={!isEditable}
            placeholder="주요 결과, 해석, 한계 및 연구의 의미를 작성하세요."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
          />
        </div>
        {report?.summary && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">연구 요약 (기존 데이터)</label>
            <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{report.summary}</p>
          </div>
        )}
        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">결과보고서 파일 {isEditable && <span className="text-red-500">*</span>}</label>
            {report?.file_url && (
              <div className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <button type="button" onClick={openSubmittedPdf} className="truncate text-left hover:text-sky-600">
                  {report.file_name ?? "첨부 파일"}
                </button>
              </div>
            )}
            {isEditable && (
              <input
                type="file"
                accept={SUBMISSION_PDF_ACCEPT}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFileError(null);
                  if (f) {
                    const v = validateSubmissionPdf(f);
                    if (!v.ok) {
                      setFileError(v.error!);
                      e.target.value = "";
                      setPrimaryFile(null);
                      return;
                    }
                  }
                  setPrimaryFile(f);
                }}
                className="block w-full text-sm text-slate-500 file:mr-4 file:rounded file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-sky-700 hover:file:bg-sky-100"
              />
            )}
            <p className="mt-1 text-xs text-slate-400">제출 파일은 PDF 형식으로 업로드해주세요.</p>
            {primaryFile && <p className="mt-1 text-xs text-sky-700">선택됨: {primaryFile.name}</p>}
          </div>

          {isEditable && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">추가 자료 <span className="font-normal text-slate-400">(선택, 여러 개 가능)</span></label>
              <input
                type="file"
                multiple
                onChange={(e) => setExtraFiles(Array.from(e.target.files ?? []))}
                className="block w-full text-sm text-slate-500 file:mr-4 file:rounded file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
            </div>
          )}
          {(report?.extra_file_urls ?? []).length > 0 && (
            <ul className="space-y-1">
              {(report?.extra_file_urls ?? []).map((url, i) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-sky-600">
                    <FileText className="h-3 w-3 shrink-0 text-slate-400" /> 추가 자료 {i + 1}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {fileError && <p className="text-xs text-red-600">{fileError}</p>}
        </div>

        {(isEditable || (exportCtx && report)) && (
          <div className="flex flex-wrap gap-3">
            {isEditable && (
              <>
                <button type="button" onClick={() => handleSave(false)} disabled={saving}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60">
                  {uploading ? "파일 업로드 중..." : saving ? "저장 중..." : "임시 저장"}
                </button>
                <button type="button" onClick={() => handleSave(true)} disabled={saving}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60">
                  {uploading ? "파일 업로드 중..." : saving ? "저장 중..." : "제출하기"}
                </button>
              </>
            )}
            {exportCtx && report && (
              <button type="button" onClick={handleOpenExport} disabled={exportingDoc}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                <Download className="h-3.5 w-3.5" />
                {exportingDoc ? "불러오는 중..." : "내보내기"}
              </button>
            )}
          </div>
        )}

        {canReview && report && (status === "submitted" || status === "approved") && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold text-slate-700">결과보고서 검토</p>
            <div className="flex items-center gap-2">
              <ReviewActionButtons
                phase={deriveReviewPhase(status, report?.feedback)}
                onApprove={handleApprove}
                onRequestRevision={() => setShowRevisionModal(true)}
                busy={reviewBusy}
              />
              {status === "approved" && (
                <button type="button" onClick={handleUndoApproval} disabled={reviewBusy}
                  className="text-xs font-medium text-slate-500 underline hover:text-slate-700 disabled:opacity-60">
                  승인 취소
                </button>
              )}
            </div>
          </div>
        )}
      </Accordion>

      <RevisionRequestModal
        open={showRevisionModal}
        title="결과보고서 수정 요청"
        onCancel={() => setShowRevisionModal(false)}
        onSubmit={handleRequestRevision}
        submitting={reviewBusy}
      />

      {showCancelSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">제출 취소</h2>
            <p className="text-sm text-slate-600">제출을 취소하면 검토 대기 상태가 해제됩니다. 취소하시겠습니까?</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowCancelSubmitModal(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">닫기</button>
              <button type="button" onClick={handleCancelSubmit}
                className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-semibold text-white hover:bg-amber-600">제출 취소</button>
            </div>
          </div>
        </div>
      )}

      {exportItems && <SubmissionExportDialog items={exportItems} onClose={() => setExportItems(null)} />}
    </>
  );
}
