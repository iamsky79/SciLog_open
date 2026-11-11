"use client";

import { useEffect, useRef, useState } from "react";
import { Download, X, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Accordion } from "@/components/ui/Accordion";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ReviewActionButtons } from "@/components/ReviewActionButtons";
import { RevisionRequestModal } from "@/components/RevisionRequestModal";
import { isDocumentEditable } from "@/lib/review/editability";
import { approveSubmission, deriveReviewPhase, notifyReviewChanged, requestRevision, undoApproval, type ReviewTarget } from "@/lib/review/actions";
import { buildSnapshotContent, recordSubmissionSnapshot } from "@/lib/submissions/snapshot";
import { fetchProjectExportItems, type ProjectExportContext } from "@/lib/submissions/hub";
import type { ExportableSubmission } from "@/lib/export/submission-export";
import { SubmissionExportDialog } from "@/components/submissions/ExportDialog";
import { fileNameFromUrl as attachmentNameFromUrl } from "@/lib/export/common";
import type { IndividualResearch, PlanStatus, ReportSchedule, ResearchPlan } from "@/lib/database.types";

type EntityType = "rne" | "club" | "individual";

const STATUS_CONFIG: Record<PlanStatus, { label: string; tone: Tone }> = {
  draft: { label: "임시저장", tone: "gray" },
  submitted: { label: "검토 대기", tone: "gold" },
  approved: { label: "승인 완료", tone: "green" },
  rejected: { label: "수정 요청", tone: "red" },
  historical: { label: "과거 기록", tone: "gray" },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 5;

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "file";
}

function sanitizeFullFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return sanitizeFileName(name);
  const ext = name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, "");
  return `${sanitizeFileName(name.slice(0, dot))}.${ext || "bin"}`;
}

function fileNameFromUrl(url: string) {
  try {
    const parts = new URL(url).pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return url;
  }
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
        <span className={`text-sm font-semibold ${text}`}>계획서 제출 마감 · {label}</span>
        <span className={`text-xs ${text}`}>
          {deadline.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

interface PlanSectionProps {
  entityType: EntityType;
  entityId: string;
  /** rne/club은 team.id, individual은 null */
  teamId: string | null;
  currentUserId: string;
  /** 팀원 본인(team) 또는 연구 소유자 본인(individual) */
  canEdit: boolean;
  /** 교사/관리자 */
  canReview: boolean;
  entityName: string;
  /** 이 계획서를 공용 SubmissionExportDialog로 내보내기 위한 조회 컨텍스트 — 없으면 내보내기 버튼을 표시하지 않는다. */
  exportCtx?: ProjectExportContext;
  onChanged?: () => void;
}

export function PlanSection({
  entityType, entityId, teamId, currentUserId, canEdit, canReview, exportCtx, onChanged,
}: PlanSectionProps) {
  const isIndividual = entityType === "individual";

  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  const [saving, setSaving] = useState(false);

  const [teamPlan, setTeamPlan] = useState<ResearchPlan | null>(null);
  const [research, setResearch] = useState<IndividualResearch | null>(null);
  const [linkedPlan, setLinkedPlan] = useState<ResearchPlan | null>(null);
  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);

  const [title, setTitle] = useState("");
  const [motivation, setMotivation] = useState("");
  const [method, setMethod] = useState("");
  const [expectedResult, setExpectedResult] = useState("");

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCancelSubmitModal, setShowCancelSubmitModal] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);

  const [exportingDoc, setExportingDoc] = useState(false);
  const [exportItems, setExportItems] = useState<ExportableSubmission[] | null>(null);

  // 이 계획서 1건만 대상으로 공용 export dialog를 연다 — fetchProjectExportItems()가
  // 이 프로젝트의 계획서/연구일지/결과보고서를 모두 조회해오지만, 그중 연구계획서
  // 항목 하나만 걸러서 넘긴다(다른 문서가 섞이지 않게).
  const handleOpenExport = async () => {
    if (!exportCtx) return;
    setExportingDoc(true);
    try {
      const items = await fetchProjectExportItems(exportCtx);
      const plan = items.filter((i) => i.docType === "연구계획서");
      if (plan.length === 0) {
        alert("내보낼 수 있는 제출된 계획서가 없습니다.");
        return;
      }
      setExportItems(plan);
    } catch (e) {
      console.error("계획서 내보내기 자료 조회 실패:", e);
      alert("자료를 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      setExportingDoc(false);
    }
  };

  const load = async () => {
    const supabase = createClient();
    setLoading(true);
    if (isIndividual) {
      const [{ data: researchData }, { data: planData }, { data: scheduleRows }] = await Promise.all([
        supabase.from("individual_research").select("*").eq("id", entityId).single(),
        supabase.from("research_plans").select("*").eq("entity_type", "individual").eq("entity_id", entityId).maybeSingle(),
        supabase.from("report_schedules").select("*").eq("submission_type", "plan"),
      ]);
      const row = (researchData as IndividualResearch) ?? null;
      setResearch(row);
      setLinkedPlan((planData as ResearchPlan) ?? null);
      if (row) {
        setMotivation(row.plan_motivation ?? "");
        setMethod(row.plan_method ?? "");
        setExpectedResult(row.plan_expected ?? "");
      }
      setSchedule(findApplicableSchedule((scheduleRows as ReportSchedule[]) ?? [], "individual", entityId));
    } else {
      const [{ data: planData }, { data: scheduleRows }] = await Promise.all([
        supabase.from("research_plans").select("*").eq("team_id", teamId).eq("entity_type", entityType).maybeSingle(),
        supabase.from("report_schedules").select("*").eq("submission_type", "plan"),
      ]);
      const plan = (planData as ResearchPlan) ?? null;
      setTeamPlan(plan);
      setTitle(plan?.title ?? "");
      setMotivation(plan?.motivation ?? "");
      setMethod(plan?.method ?? "");
      setExpectedResult(plan?.expected_result ?? "");
      setSchedule(findApplicableSchedule((scheduleRows as ReportSchedule[]) ?? [], entityType, entityId));
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, teamId]);

  const status: PlanStatus = isIndividual ? ((research?.plan_status ?? "draft") as PlanStatus) : (teamPlan?.status ?? "draft");
  const hasContent = isIndividual
    ? !!(research?.plan_motivation || research?.plan_method || research?.plan_expected)
    : teamPlan != null;

  useEffect(() => {
    if (loading || autoOpened) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(!hasContent);
    setAutoOpened(true);
  }, [loading, autoOpened, hasContent]);

  const submittedAt = isIndividual ? research?.plan_submitted_at ?? null : teamPlan?.submitted_at ?? null;
  const feedback = isIndividual ? research?.plan_feedback ?? null : teamPlan?.feedback ?? null;
  const fileUrls = isIndividual ? research?.plan_file_urls ?? [] : [];
  const isEditable = isDocumentEditable(canEdit, status);
  const disabled = isIndividual ? !isEditable : !isEditable && !canReview;
  const canDelete = hasContent && status !== "approved" && (canEdit || canReview);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const newFiles = Array.from(e.target.files ?? []);
    const combined = [...selectedFiles, ...newFiles];
    if (combined.length > MAX_FILES) {
      setFileError(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있습니다.`);
      return;
    }
    const oversized = newFiles.find((f) => f.size > MAX_FILE_SIZE);
    if (oversized) {
      setFileError(`파일 크기는 50MB 이하여야 합니다: ${oversized.name}`);
      return;
    }
    setSelectedFiles(combined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeExistingFile = async (url: string) => {
    if (!research) return;
    const supabase = createClient();
    const next = (research.plan_file_urls ?? []).filter((u) => u !== url);
    const { data: updated, error } = await supabase
      .from("individual_research").update({ plan_file_urls: next }).eq("id", entityId).select().single();
    if (error) {
      console.error("첨부파일 삭제 실패:", error);
      alert(`첨부파일 삭제 실패: ${error.message}`);
      return;
    }
    if (updated) setResearch(updated as IndividualResearch);
  };

  const handleSave = async (submit: boolean) => {
    setSaving(true);
    const supabase = createClient();
    const now = new Date().toISOString();

    if (isIndividual) {
      if (!research) { setSaving(false); return; }
      const uploadedUrls: string[] = [];
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          // 파일마다(그리고 재제출마다) 경로가 유니크해야 한다 — 이전에는 모든 첨부가
          // "연도_individual_이름_plan.확장자"라는 같은 경로로 고정돼 있어, 같은
          // 확장자의 파일을 2개 이상 올리거나 재제출하면 이전 파일이 그대로 덮어써져
          // 사라졌다(스냅샷이 가리키는 과거 파일도 함께 훼손됨). Date.now()+원본
          // 파일명을 넣어 매 업로드가 별개의 storage object가 되도록 한다.
          const safeName = sanitizeFullFileName(file.name);
          const path = `individual/${entityId}/plans/${Date.now()}_${safeName}`;
          const { error: uploadError } = await supabase.storage.from("activity-files").upload(path, file, { upsert: true });
          if (uploadError) {
            console.error("계획서 파일 업로드 실패:", uploadError);
            alert(`파일 업로드 실패: ${uploadError.message}`);
          } else {
            const { data: urlData } = supabase.storage.from("activity-files").getPublicUrl(path);
            if (urlData?.publicUrl) uploadedUrls.push(urlData.publicUrl);
          }
        }
      }
      const allFileUrls = [...(research.plan_file_urls ?? []), ...uploadedUrls];
      const payload: Partial<IndividualResearch> = {
        plan_motivation: motivation || null,
        plan_method: method || null,
        plan_expected: expectedResult || null,
        plan_status: submit ? "submitted" : "draft",
        plan_submitted_at: submit ? now : research.plan_submitted_at,
        plan_file_urls: allFileUrls,
      };
      const { data: updated, error: updateError } = await supabase
        .from("individual_research").update(payload).eq("id", entityId).select().single();
      if (updateError) {
        console.error("계획서 저장 실패:", updateError);
        alert(`계획서 저장 실패: ${updateError.message}`);
        setSaving(false);
        return;
      }
      if (updated) setResearch(updated as IndividualResearch);

      if (submit) {
        const planBase = {
          entity_type: "individual", entity_id: entityId, title: research.title,
          motivation: motivation || null, method: method || null, expected_result: expectedResult || null,
          status: "submitted", submitted_at: now, created_by: currentUserId, updated_at: now,
        };
        const mirrorResult = linkedPlan?.id
          ? await supabase.from("research_plans").update(planBase).eq("id", linkedPlan.id)
          : await supabase.from("research_plans").insert({ ...planBase, team_id: null });
        if (mirrorResult.error) {
          console.error("계획서 제출 기록(research_plans) 저장 실패:", mirrorResult.error);
          alert(`계획서는 저장되었지만 제출 기록 등록에 실패했습니다: ${mirrorResult.error.message}`);
        }
        await recordSubmissionSnapshot({
          sourceTable: "individual_research",
          sourceId: entityId,
          submittedBy: currentUserId,
          content: buildSnapshotContent(
            { "연구 동기 및 목적": motivation || null, "연구 방법": method || null, "기대 결과": expectedResult || null },
            allFileUrls.map((u) => ({ name: attachmentNameFromUrl(u), url: u }))
          ),
        });
        setOpen(false);
      }
      setSelectedFiles([]);
    } else {
      const payload = {
        team_id: teamId, entity_type: entityType, entity_id: entityId,
        title, motivation, method, expected_result: expectedResult,
        status: submit ? "submitted" : "draft",
        submitted_at: submit ? now : teamPlan?.submitted_at ?? null,
        created_by: currentUserId, updated_at: now,
      };
      const result = teamPlan?.id
        ? await supabase.from("research_plans").update(payload).eq("id", teamPlan.id).select().single()
        : await supabase.from("research_plans").insert(payload).select().single();
      if (result.error) {
        console.error("계획서 저장 실패:", result.error);
        alert(`계획서 저장 실패: ${result.error.message}`);
        setSaving(false);
        return;
      }
      if (result.data) {
        setTeamPlan(result.data as ResearchPlan);
        if (submit) {
          await recordSubmissionSnapshot({
            sourceTable: "research_plans",
            sourceId: result.data.id,
            submittedBy: currentUserId,
            content: buildSnapshotContent({
              연구제목: title || null,
              "연구 동기 및 목적": motivation || null,
              "연구 방법": method || null,
              "기대 결과": expectedResult || null,
            }),
          });
          setOpen(false);
        }
      }
    }
    setSaving(false);
    if (submit) notifyReviewChanged(); // 제출/재제출 시 사이드바 "제출물" 배지 즉시 갱신
    onChanged?.();
  };

  const handleCancelSubmit = async () => {
    const supabase = createClient();
    if (isIndividual) {
      const { data: updated, error } = await supabase.from("individual_research")
        .update({ plan_status: "draft", plan_submitted_at: null }).eq("id", entityId).select().single();
      if (error) {
        console.error("제출 취소 실패:", error);
        alert(`제출 취소 실패: ${error.message}`);
        return;
      }
      if (updated) setResearch(updated as IndividualResearch);
    } else if (teamPlan?.id) {
      const { data: updated, error } = await supabase.from("research_plans")
        .update({ status: "draft", submitted_at: null, updated_at: new Date().toISOString() }).eq("id", teamPlan.id).select().single();
      if (error) {
        console.error("제출 취소 실패:", error);
        alert(`제출 취소 실패: ${error.message}`);
        return;
      }
      if (updated) setTeamPlan(updated as ResearchPlan);
    }
    setShowCancelSubmitModal(false);
    onChanged?.();
  };

  const handleDelete = async () => {
    const supabase = createClient();
    if (isIndividual) {
      const { error } = await supabase.from("individual_research").update({
        plan_motivation: null, plan_method: null, plan_expected: null,
        plan_status: "draft", plan_submitted_at: null, plan_feedback: null, plan_file_urls: [],
      }).eq("id", entityId);
      if (error) {
        console.error("계획서 삭제 실패:", error);
        alert(`계획서 삭제 실패: ${error.message}`);
        return;
      }
    } else if (teamPlan?.id) {
      const { error } = await supabase.from("research_plans").delete().eq("id", teamPlan.id);
      if (error) {
        console.error("계획서 삭제 실패:", error);
        alert(`계획서 삭제 실패: ${error.message}`);
        return;
      }
    }
    await load();
    setOpen(true);
    setShowDeleteModal(false);
    onChanged?.();
  };

  const reviewTarget: ReviewTarget = isIndividual
    ? { table: "individual_research", id: entityId, linkedPlanId: linkedPlan?.id ?? null }
    : { table: "research_plans", id: teamPlan?.id ?? "" };

  const handleApprove = async () => {
    setReviewBusy(true);
    const { error } = await approveSubmission(reviewTarget);
    setReviewBusy(false);
    if (error) {
      console.error("계획서 승인 실패:", error);
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

  if (loading) return <Card className="text-sm text-slate-400">계획서 불러오는 중...</Card>;

  const summary = (
    <>
      <Badge tone={STATUS_CONFIG[status].tone}>{STATUS_CONFIG[status].label}</Badge>
      {fmtDate(submittedAt) && <span className="text-xs text-slate-400">{fmtDate(submittedAt)}</span>}
      {fileUrls[0] && (
        <span onClick={(e) => e.stopPropagation()}>
          <a href={fileUrls[0]} target="_blank" rel="noopener noreferrer" title="다운로드">
            <Download className="h-3.5 w-3.5 text-sky-600 hover:text-sky-800" />
          </a>
        </span>
      )}
    </>
  );

  return (
    <>
      <Accordion title="연구 계획서" summary={summary} open={open} onToggle={() => setOpen((v) => !v)}>
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
            <p className="text-sm font-medium text-green-700">계획서 승인됨</p>
            {feedback && <p className="mt-1 text-sm text-green-600">피드백: {feedback}</p>}
            <p className="mt-1 text-xs text-green-600">승인된 계획서는 수정·삭제할 수 없습니다.</p>
          </div>
        )}
        {status === "rejected" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">계획서 수정 요청됨</p>
            {feedback && <p className="mt-1 text-sm text-red-600">수정 요청 사유: {feedback}</p>}
            <p className="mt-1 text-xs text-red-500">아래에서 내용을 수정 후 재제출하세요.</p>
          </div>
        )}

        {!isIndividual && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">연구 제목</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
            />
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">연구 동기 및 목적</label>
          <textarea
            rows={4}
            value={motivation}
            onChange={(e) => setMotivation(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">연구 방법</label>
          <textarea
            rows={4}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">기대 결과</label>
          <textarea
            rows={3}
            value={expectedResult}
            onChange={(e) => setExpectedResult(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
          />
        </div>

        {isIndividual && (
          <div className="rounded-lg border border-slate-200 p-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              첨부 파일 <span className="font-normal text-slate-400">(선택 · PDF, HWP, Word, 이미지 · 최대 50MB)</span>
            </label>
            {isEditable && (
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.hwp,.hwpx,.jpg,.jpeg,.png,.ppt,.pptx,.xls,.xlsx"
                onChange={handleFileChange}
                className="block w-full text-sm text-slate-500 file:mr-4 file:rounded file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-sky-700 hover:file:bg-sky-100"
              />
            )}
            {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}
            {fileUrls.length > 0 && (
              <ul className="mt-2 space-y-1">
                {fileUrls.map((url) => (
                  <li key={url} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1 text-sm text-slate-600">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 truncate hover:text-sky-600">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      {fileNameFromUrl(url)}
                    </a>
                    {isEditable && (
                      <button type="button" onClick={() => removeExistingFile(url)} className="ml-2 shrink-0 text-slate-400 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {selectedFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {selectedFiles.map((file, idx) => (
                  <li key={idx} className="flex items-center justify-between rounded bg-sky-50 px-3 py-1 text-sm text-sky-700">
                    <span className="truncate">{file.name}</span>
                    <button type="button" onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="ml-2 shrink-0 text-sky-400 hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {isEditable && (
            <>
              <button type="button" onClick={() => handleSave(false)} disabled={saving}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60">
                {saving ? "저장 중..." : "임시 저장"}
              </button>
              <button type="button" onClick={() => handleSave(true)}
                disabled={saving || (isIndividual ? (!motivation && !method && !expectedResult) : !title)}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? "저장 중..." : "제출하기"}
              </button>
            </>
          )}
          {exportCtx && hasContent && (
            <button type="button" onClick={handleOpenExport} disabled={exportingDoc}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              <Download className="h-3.5 w-3.5" />
              {exportingDoc ? "불러오는 중..." : "내보내기"}
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={() => setShowDeleteModal(true)}
              className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">
              삭제
            </button>
          )}
        </div>

        {canReview && hasContent && (status === "submitted" || status === "approved") && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold text-slate-700">계획서 검토</p>
            <div className="flex items-center gap-2">
              <ReviewActionButtons
                phase={deriveReviewPhase(status, feedback)}
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
        title="계획서 수정 요청"
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

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">연구계획서 삭제</h2>
            <p className="text-sm text-slate-600">이 연구계획서를 삭제하면 데이터를 복구할 수 없습니다. 정말 삭제하시겠습니까?</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowDeleteModal(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">취소</button>
              <button type="button" onClick={handleDelete}
                className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600">삭제</button>
            </div>
          </div>
        </div>
      )}

      {exportItems && <SubmissionExportDialog items={exportItems} onClose={() => setExportItems(null)} />}
    </>
  );
}
