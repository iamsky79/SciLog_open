"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, FileText, Download } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Badge } from "@/components/ui/Badge";
import { statusLabel, statusTone } from "@/lib/status";
import { ACTIVITY_ROLE_CODES, ACTIVITY_ROLE_LABEL } from "@/lib/database.types";
import type { ActivityLog, ActivityLogParticipant, ActivityRoleCode, EntityType } from "@/lib/database.types";
import { ReviewActionButtons } from "@/components/ReviewActionButtons";
import { RevisionRequestModal } from "@/components/RevisionRequestModal";
import { isLockedHistorical } from "@/lib/provenance";
import { approveSubmission, deriveReviewPhase, notifyReviewChanged, requestRevision } from "@/lib/review/actions";
import { fetchProjectExportItems, type ProjectExportContext } from "@/lib/submissions/hub";
import type { ExportableSubmission } from "@/lib/export/submission-export";
import { SubmissionExportDialog } from "@/components/submissions/ExportDialog";

interface Member {
  id: string;
  name: string;
}

interface JournalTimelineProps {
  entityType: EntityType;
  entityId: string;
  currentUserId: string;
  canReview: boolean;
  /** 팀원 필터/참여자 선택용. 창의개인연구는 빈 배열. */
  members: Member[];
  showCompose: boolean;
  onOpenCompose: () => void;
  onCloseCompose: () => void;
  onStats?: (stats: { total: number; recentDate: string | null; rejectedMine: number; pendingReview: number; todayCount: number }) => void;
  /** 외부(제출물 허브 등)에서 특정 연구일지로 딥링크할 때 — 로드되면 자동으로 펼치고 스크롤한다. */
  focusLogId?: string | null;
  /** 이 연구일지들을 공용 SubmissionExportDialog로 내보내기 위한 조회 컨텍스트 — 없으면 항목별 내보내기 버튼을 표시하지 않는다. */
  exportCtx?: ProjectExportContext;
}

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function isImageUrl(url: string) {
  return /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
}

function fileNameFromUrl(url: string) {
  try {
    const parts = new URL(url).pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return url;
  }
}

function sanitizeStorageFileName(name: string): string {
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx !== -1 ? name.slice(dotIdx) : "";
  const base = dotIdx !== -1 ? name.slice(0, dotIdx) : name;
  const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 80);
  return (safeBase || "file") + ext;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="my-1 flex items-center gap-2 text-xs font-medium text-slate-400">
      <div className="h-px flex-1 bg-slate-200" />
      {label}
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function RoleCheckboxes({
  selected, onChange, disabled,
}: { selected: ActivityRoleCode[]; onChange: (roles: ActivityRoleCode[]) => void; disabled?: boolean }) {
  const toggle = (code: ActivityRoleCode) => {
    onChange(selected.includes(code) ? selected.filter((r) => r !== code) : [...selected, code]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {ACTIVITY_ROLE_CODES.map((code) => (
        <label
          key={code}
          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
            selected.includes(code) ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-600"
          } ${disabled ? "opacity-60" : "hover:bg-slate-50"}`}
        >
          <input
            type="checkbox"
            checked={selected.includes(code)}
            onChange={() => toggle(code)}
            disabled={disabled}
            className="sr-only"
          />
          {ACTIVITY_ROLE_LABEL[code]}
        </label>
      ))}
    </div>
  );
}

export function JournalTimeline({
  entityType, entityId, currentUserId, canReview, members, showCompose, onOpenCompose, onCloseCompose, onStats, focusLogId, exportCtx,
}: JournalTimelineProps) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [exportingLogId, setExportingLogId] = useState<string | null>(null);
  const [exportItems, setExportItems] = useState<ExportableSubmission[] | null>(null);
  const [participantsByLog, setParticipantsByLog] = useState<Record<string, ActivityLogParticipant[]>>({});
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filterAuthor, setFilterAuthor] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const [draftId, setDraftId] = useState<string | null>(null);
  const [logDate, setLogDate] = useState(today());
  const [title, setTitle] = useState("");
  const [experiment, setExperiment] = useState("");
  const [resultText, setResultText] = useState("");
  const [interpretation, setInterpretation] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [myRoles, setMyRoles] = useState<ActivityRoleCode[]>([]);
  const [myRoleDescription, setMyRoleDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [draftSaved, setDraftSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [revisionModalLogId, setRevisionModalLogId] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  const [roleEditingLogId, setRoleEditingLogId] = useState<string | null>(null);
  const [roleEditRoles, setRoleEditRoles] = useState<ActivityRoleCode[]>([]);
  const [roleEditDescription, setRoleEditDescription] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const supabase = createClient();
    // 초안(draft)은 작성자 본인에게만 보이도록 제외 — 그 외 상태는 모두 표시
    const { data } = await supabase
      .from("activity_logs")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("log_type", "team")
      .or(`status.neq.draft,author_id.eq.${currentUserId}`)
      .order("log_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    const rows = (data as ActivityLog[]) ?? [];
    setLogs(rows);

    const logIds = rows.map((r) => r.id);
    let participantRows: ActivityLogParticipant[] = [];
    if (logIds.length > 0) {
      const { data: pData } = await supabase.from("activity_log_participants").select("*").in("log_id", logIds);
      participantRows = (pData as ActivityLogParticipant[]) ?? [];
    }
    const byLog: Record<string, ActivityLogParticipant[]> = {};
    for (const p of participantRows) (byLog[p.log_id] ??= []).push(p);
    setParticipantsByLog(byLog);

    const nameIds = Array.from(new Set([...rows.map((r) => r.author_id), ...participantRows.map((p) => p.student_id)]));
    if (nameIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, name").in("id", nameIds);
      setUserNames(Object.fromEntries((users ?? []).map((u) => [u.id, u.name])));
    }
    setLoading(false);

    const t = today();
    const finalized = rows.filter((r) => r.status !== "draft");
    onStats?.({
      total: finalized.length,
      recentDate: finalized[0]?.log_date ?? null,
      rejectedMine: finalized.filter((r) => r.author_id === currentUserId && r.status === "rejected").length,
      pendingReview: finalized.filter((r) => r.status === "pending" || r.status === "submitted").length,
      todayCount: finalized.filter((r) => r.log_date === t).length,
    });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  // "제출물" 허브 등에서 ?log=<id>로 들어왔을 때 해당 연구일지를 자동으로 펼치고 스크롤한다.
  useEffect(() => {
    if (!focusLogId || logs.length === 0) return;
    if (!logs.some((l) => l.id === focusLogId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedId(focusLogId);
    const el = document.getElementById(`log-${focusLogId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusLogId, logs]);

  // 작성 폼을 열 때 본인의 기존 임시저장이 있으면 이어서 편집, 없으면 기본 참여자 설정
  useEffect(() => {
    if (!showCompose) return;
    const existingDraft = logs.find((l) => l.author_id === currentUserId && l.status === "draft");
    const defaultParticipants = entityType === "individual" ? [currentUserId] : members.map((m) => m.id);
    if (!existingDraft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParticipantIds(defaultParticipants);
      return;
    }
    setDraftId(existingDraft.id);
    setLogDate(existingDraft.log_date ?? today());
    setTitle(existingDraft.title ?? "");
    setExperiment(existingDraft.experiment ?? existingDraft.free_memo ?? "");
    setResultText(existingDraft.result ?? "");
    setInterpretation(existingDraft.interpretation ?? "");
    setConclusion(existingDraft.conclusion ?? "");
    setNextPlan(existingDraft.next_plan ?? "");

    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("activity_log_participants").select("*").eq("log_id", existingDraft.id);
      const rows = (data as ActivityLogParticipant[]) ?? [];
      setParticipantIds(rows.length > 0 ? rows.map((r) => r.student_id) : defaultParticipants);
      const mine = rows.find((r) => r.student_id === currentUserId);
      if (mine) {
        setMyRoles(mine.roles ?? []);
        setMyRoleDescription(mine.role_description ?? "");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompose]);

  const filtered = useMemo(() => {
    let list = logs;
    if (filterAuthor === "mine") list = list.filter((l) => l.author_id === currentUserId);
    else if (filterAuthor !== "all") list = list.filter((l) => l.author_id === filterAuthor);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((l) =>
        (l.title ?? "").toLowerCase().includes(q) ||
        (l.experiment ?? "").toLowerCase().includes(q) ||
        (l.free_memo ?? "").toLowerCase().includes(q) ||
        (userNames[l.author_id] ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [logs, filterAuthor, search, userNames, currentUserId]);

  const grouped = useMemo(() => {
    const map = new Map<string, ActivityLog[]>();
    for (const l of filtered) {
      const key = l.log_date ?? ""; // "" = 날짜 미상(historical)
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files ?? []).slice(0, MAX_FILES - files.length);
    setFiles((prev) => [...prev, ...newFiles].slice(0, MAX_FILES));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetCompose = () => {
    setDraftId(null);
    setLogDate(today());
    setTitle("");
    setExperiment("");
    setResultText("");
    setInterpretation("");
    setConclusion("");
    setNextPlan("");
    setMyRoles([]);
    setMyRoleDescription("");
    setFiles([]);
    setDraftSaved(false);
  };

  const persist = async (status: "draft" | "pending", withFiles: boolean): Promise<ActivityLog | null> => {
    setSaving(true);
    const supabase = createClient();
    const payload = {
      entity_type: entityType, entity_id: entityId, author_id: currentUserId, log_type: "team",
      log_date: logDate, title: title || null,
      experiment: experiment || null,
      result: resultText || null,
      interpretation: interpretation || null,
      conclusion: conclusion || null,
      next_plan: nextPlan || null,
      status,
    };

    const result = draftId
      ? await supabase.from("activity_logs").update(payload).eq("id", draftId).select().single()
      : await supabase.from("activity_logs").insert({ ...payload, file_urls: [] }).select().single();

    if (result.error || !result.data) {
      setSaving(false);
      const label = status === "draft" ? "임시저장" : "제출";
      console.error(`연구일지 ${label} 실패:`, result.error);
      alert(`${label} 실패: ${result.error?.message ?? "알 수 없는 오류"}`);
      return null;
    }
    const log = result.data as ActivityLog;
    setDraftId(log.id);

    if (withFiles && files.length > 0) {
      const fileUrls: string[] = [...(log.file_urls ?? [])];
      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) continue;
        const safeName = sanitizeStorageFileName(file.name);
        const path = `${currentUserId}/${log.id}/${safeName}`;
        const { error: uploadError } = await supabase.storage.from("activity-files").upload(path, file, { upsert: true });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("activity-files").getPublicUrl(path);
          if (urlData?.publicUrl) fileUrls.push(urlData.publicUrl);
        }
      }
      await supabase.from("activity_logs").update({ file_urls: fileUrls }).eq("id", log.id);
    }

    // 참여자 등록 + 본인 역할 저장 (다른 참여자는 빈 역할로 자리만 등록, 이미 있으면 건드리지 않음)
    const targetParticipantIds = entityType === "individual" ? [currentUserId] : participantIds;
    const now = new Date().toISOString();
    const writes = targetParticipantIds.map((sid) =>
      sid === currentUserId
        ? supabase.from("activity_log_participants").upsert(
            { log_id: log.id, student_id: sid, roles: myRoles, role_description: myRoleDescription || null, updated_at: now },
            { onConflict: "log_id,student_id" }
          )
        : supabase.from("activity_log_participants").upsert(
            { log_id: log.id, student_id: sid },
            { onConflict: "log_id,student_id", ignoreDuplicates: true }
          )
    );
    const participantResults = await Promise.all(writes);
    const participantError = participantResults.find((r) => r.error)?.error;
    if (participantError) {
      console.error("참여자/역할 저장 실패:", participantError);
      alert(`연구 기록은 저장되었지만 참여자/역할 정보 저장에 실패했습니다: ${participantError.message}`);
    }

    setSaving(false);
    return log;
  };

  const handleSaveDraft = async () => {
    const log = await persist("draft", false);
    if (log) {
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 1500);
      load();
    }
  };

  const handleSubmit = async () => {
    const log = await persist("pending", true);
    if (log) {
      resetCompose();
      onCloseCompose();
      load();
      notifyReviewChanged(); // 제출 시 사이드바 "제출물" 배지 즉시 갱신
    }
  };

  const startEdit = (log: ActivityLog) => {
    setEditingId(log.id);
    setEditContent(log.experiment ?? log.free_memo ?? "");
  };

  // 검토 대기(pending) 일지는 내용만 고치고, 수정 요청(rejected) 일지는 같은 행을 고친 뒤 곧바로
  // pending으로 되돌려 재제출한다(새 행을 만들지 않는다). 이전 교사 피드백은 지우지 않아서
  // 기존 deriveReviewPhase가 "재검토 필요"로 구분해 보여준다.
  const saveEdit = async (log: ActivityLog) => {
    const supabase = createClient();
    const resubmit = log.status === "rejected";
    const patch: { experiment: string | null; status?: "pending" } = { experiment: editContent || null };
    if (resubmit) patch.status = "pending";
    const { data, error } = await supabase.from("activity_logs").update(patch).eq("id", log.id).select("id");
    if (error || !data || data.length === 0) {
      console.error("연구일지 수정 실패:", error);
      alert(`수정 실패: ${error?.message ?? "반영되지 않았습니다. 권한을 확인해주세요."}`);
      return;
    }
    setEditingId(null);
    load();
    if (resubmit) notifyReviewChanged(); // 재제출 시 사이드바 "제출물" 배지 즉시 갱신
  };

  const handleApproveLog = async (logId: string) => {
    setReviewBusy(true);
    const { error } = await approveSubmission({ table: "activity_logs", id: logId });
    setReviewBusy(false);
    if (error) {
      console.error("연구일지 승인 실패:", error);
      alert(`승인 실패: ${error}`);
      return;
    }
    load();
  };

  const handleRequestLogRevision = async (reason: string) => {
    if (!revisionModalLogId) return;
    setReviewBusy(true);
    const { error } = await requestRevision({ table: "activity_logs", id: revisionModalLogId }, reason);
    setReviewBusy(false);
    if (error) {
      console.error("수정 요청 실패:", error);
      alert(`수정 요청 실패: ${error}`);
      return;
    }
    setRevisionModalLogId(null);
    load();
  };

  // 이 연구일지 1건만 대상으로 공용 export dialog를 연다 — 다른 연구일지가 섞이지 않게
  // fetchProjectExportItems()가 돌려준 항목 중 이 log.id에 해당하는 것 하나만 걸러낸다.
  const handleExportLog = async (logId: string) => {
    if (!exportCtx) return;
    setExportingLogId(logId);
    try {
      const items = await fetchProjectExportItems(exportCtx);
      const target = items.filter((i) => i.id === `log-${logId}`);
      if (target.length === 0) {
        alert("이 연구일지는 아직 제출된 내용이 없어 내보낼 수 없습니다.");
        return;
      }
      setExportItems(target);
    } catch (e) {
      console.error("연구일지 내보내기 자료 조회 실패:", e);
      alert("자료를 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      setExportingLogId(null);
    }
  };

  const startRoleEdit = (logId: string, mine: ActivityLogParticipant | undefined) => {
    setRoleEditingLogId(logId);
    setRoleEditRoles(mine?.roles ?? []);
    setRoleEditDescription(mine?.role_description ?? "");
  };

  const saveMyRole = async (logId: string) => {
    setRoleSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("activity_log_participants")
      .update({ roles: roleEditRoles, role_description: roleEditDescription || null, updated_at: new Date().toISOString() })
      .eq("log_id", logId)
      .eq("student_id", currentUserId);
    setRoleSaving(false);
    if (error) {
      console.error("역할 저장 실패:", error);
      alert(`역할 저장 실패: ${error.message}`);
      return;
    }
    setRoleEditingLogId(null);
    load();
  };

  const filterChips: { value: string; label: string }[] = [
    { value: "all", label: "전체" },
    { value: "mine", label: "내 기록" },
    ...members.filter((m) => m.id !== currentUserId).map((m) => ({ value: m.id, label: m.name })),
  ];

  return (
    <div className="space-y-4">
      {showCompose && (
        <div className="rounded-xl border-2 border-sky-400 p-4">
          <div className="mb-3 flex flex-wrap gap-3">
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목 (실험명, 회의 등)"
              className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-1 text-sm"
            />
          </div>

          {entityType !== "individual" && members.length > 0 && (
            <div className="mb-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-500">참여자</label>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const isSelf = m.id === currentUserId;
                  const checked = participantIds.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                        checked ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-600"
                      } ${isSelf ? "opacity-70" : "cursor-pointer hover:bg-slate-50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isSelf}
                        onChange={() =>
                          setParticipantIds((prev) => (prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id]))
                        }
                        className="sr-only"
                      />
                      {m.name}{isSelf ? " (본인)" : ""}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <SectionDivider label="연구 내용" />
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">오늘의 연구 활동</label>
              <textarea
                value={experiment}
                onChange={(e) => setExperiment(e.target.value)}
                placeholder="오늘 어떤 연구 활동을 했나요?"
                rows={3}
                className="w-full rounded border border-slate-300 p-2.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">주요 결과 및 관찰</label>
              <textarea
                value={resultText}
                onChange={(e) => setResultText(e.target.value)}
                placeholder="연구 과정에서 어떤 결과나 현상을 확인했나요?"
                rows={3}
                className="w-full rounded border border-slate-300 p-2.5 text-sm"
              />
              {files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center gap-1 rounded bg-sky-50 px-2 py-1 text-xs text-sky-700">
                      {f.name}
                      <button type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="mt-2 text-xs" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">해석 및 판단</label>
              <textarea
                value={interpretation}
                onChange={(e) => setInterpretation(e.target.value)}
                placeholder="결과를 어떻게 해석했나요? 예상과 달랐다면 그 이유는 무엇이라고 생각하나요?"
                rows={3}
                className="w-full rounded border border-slate-300 p-2.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">문제점 / 특이사항</label>
              <textarea
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value)}
                placeholder="연구 과정에서 발생한 문제나 특이사항이 있었나요?"
                rows={2}
                className="w-full rounded border border-slate-300 p-2.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">다음 활동과 그 이유</label>
              <textarea
                value={nextPlan}
                onChange={(e) => setNextPlan(e.target.value)}
                placeholder="다음에는 무엇을 할 예정이며, 왜 그렇게 하려고 하나요?"
                rows={2}
                className="w-full rounded border border-slate-300 p-2.5 text-sm"
              />
            </div>
          </div>

          <SectionDivider label="나의 역할" />
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">이번 연구에서 내가 한 역할</label>
              <RoleCheckboxes selected={myRoles} onChange={setMyRoles} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">구체적으로 한 일 (선택)</label>
              <textarea
                value={myRoleDescription}
                onChange={(e) => setMyRoleDescription(e.target.value)}
                placeholder="선택한 역할에서 본인이 실제로 담당한 내용을 간단히 작성하세요."
                rows={2}
                className="w-full rounded border border-slate-300 p-2.5 text-sm"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => { resetCompose(); onCloseCompose(); }}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm">취소</button>
            <button type="button" onClick={handleSaveDraft} disabled={saving}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-60">
              {draftSaved ? "저장됨" : saving ? "저장 중..." : "임시저장"}
            </button>
            <button type="button" onClick={handleSubmit} disabled={saving}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-60">
              {saving ? "제출 중..." : "제출"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {filterChips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => setFilterAuthor(chip.value)}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              filterAuthor === chip.value ? "bg-sky-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {chip.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색"
              className="rounded-lg border border-slate-300 py-1 pl-7 pr-3 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={onOpenCompose}
            className="whitespace-nowrap rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
          >
            + 연구일지 작성
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-slate-400">{logs.length === 0 ? "아직 연구일지가 없습니다." : "해당 기록이 없습니다."}</p>
      ) : (
        <div>
          {grouped.map(([date, dateLogs]) => (
            <div key={date}>
              <div className="flex items-center gap-2 py-2">
                <div className="h-2 w-2 rounded-full bg-sky-400" />
                <span className="text-sm font-medium text-slate-600">{date ? fmtDate(date) : "날짜 미상"}</span>
              </div>
              {dateLogs.map((log) => {
                const imageUrls = (log.file_urls ?? []).filter(isImageUrl);
                const fileUrls = (log.file_urls ?? []).filter((u) => !isImageUrl(u));
                const isExpanded = expandedId === log.id;
                // 본인 일지는 검토 대기(pending)와 수정 요청(rejected) 상태에서만 수정할 수 있다 — approved/historical은 잠금.
                const canEditLog = log.author_id === currentUserId && (log.status === "pending" || log.status === "rejected");
                const activityText = log.experiment || log.free_memo;
                const participants = participantsByLog[log.id] ?? [];
                const myParticipant = participants.find((p) => p.student_id === currentUserId);
                const isRoleEditing = roleEditingLogId === log.id;
                return (
                  <div
                    key={log.id}
                    id={`log-${log.id}`}
                    className="ml-4 rounded-r-lg border-l-2 border-slate-100 p-3 pb-4 pl-4 hover:bg-slate-50"
                  >
                    <div
                      className="flex cursor-pointer items-start justify-between"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-800">{log.title || "(제목 없음)"}</p>
                        <p className="mt-0.5 text-sm text-slate-500">
                          {userNames[log.author_id] ?? "알 수 없음"}
                          {activityText && ` · ${activityText.slice(0, 40)}`}
                        </p>
                        <div className="mt-1 flex gap-3 text-xs text-slate-400">
                          {imageUrls.length > 0 && <span>🖼 사진 {imageUrls.length}</span>}
                          {fileUrls.length > 0 && <span>📎 파일 {fileUrls.length}</span>}
                          {log.teacher_feedback && <span>💬 피드백</span>}
                        </div>
                      </div>
                      <Badge tone={statusTone[log.status]}>{statusLabel[log.status]}</Badge>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 space-y-3 border-t border-slate-100 pt-3" onClick={(e) => e.stopPropagation()}>
                        {editingId === log.id ? (
                          <>
                            <textarea
                              rows={4}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full rounded border border-slate-300 p-2 text-sm"
                            />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => saveEdit(log)}
                                className="rounded bg-sky-600 px-3 py-1 text-xs text-white">{log.status === "rejected" ? "저장 후 재제출" : "저장"}</button>
                              <button type="button" onClick={() => setEditingId(null)}
                                className="rounded border border-slate-300 px-3 py-1 text-xs">취소</button>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-2 text-sm text-slate-700">
                            {log.goal && (
                              <p><span className="font-medium text-slate-500">오늘의 목표: </span><span className="whitespace-pre-wrap">{log.goal}</span></p>
                            )}
                            {activityText && (
                              <p><span className="font-medium text-slate-500">연구 활동: </span><span className="whitespace-pre-wrap">{activityText}</span></p>
                            )}
                            {log.result && (
                              <p><span className="font-medium text-slate-500">주요 결과 및 관찰: </span><span className="whitespace-pre-wrap">{log.result}</span></p>
                            )}
                            {log.interpretation && (
                              <p><span className="font-medium text-slate-500">해석 및 판단: </span><span className="whitespace-pre-wrap">{log.interpretation}</span></p>
                            )}
                            {log.conclusion && (
                              <p><span className="font-medium text-slate-500">문제점 / 특이사항: </span><span className="whitespace-pre-wrap">{log.conclusion}</span></p>
                            )}
                            {log.next_plan && (
                              <p><span className="font-medium text-slate-500">다음 활동과 그 이유: </span><span className="whitespace-pre-wrap">{log.next_plan}</span></p>
                            )}
                          </div>
                        )}

                        {(imageUrls.length > 0 || fileUrls.length > 0) && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {imageUrls.map((url) => (
                              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={fileNameFromUrl(url)} className="h-16 w-16 rounded border border-slate-200 object-cover" />
                              </a>
                            ))}
                            {fileUrls.map((url) => (
                              <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                                <FileText className="h-3 w-3" /> {fileNameFromUrl(url)}
                              </a>
                            ))}
                          </div>
                        )}

                        {log.teacher_feedback && (
                          <div className="rounded bg-amber-50 p-2 text-sm text-amber-800">💬 교사 피드백: {log.teacher_feedback}</div>
                        )}

                        {participants.length > 0 && (
                          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                            <p className="mb-1.5 text-xs font-semibold text-slate-500">참여자별 역할</p>
                            <ul className="space-y-1.5">
                              {participants.map((p) => (
                                <li key={p.id} className="text-sm text-slate-700">
                                  <span className="font-medium">{userNames[p.student_id] ?? "알 수 없음"}</span>
                                  <span className="ml-2 text-slate-500">
                                    {(p.roles ?? []).length > 0 ? p.roles.map((r) => ACTIVITY_ROLE_LABEL[r]).join(" / ") : "아직 역할 미입력"}
                                  </span>
                                  {p.role_description && <p className="ml-0.5 mt-0.5 text-xs text-slate-500">&ldquo;{p.role_description}&rdquo;</p>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          {canEditLog && editingId !== log.id && (
                            <button type="button" onClick={() => startEdit(log)} className="text-xs text-sky-600">{log.status === "rejected" ? "수정 후 재제출" : "수정"}</button>
                          )}
                          {myParticipant && !isRoleEditing && (
                            <button type="button" onClick={() => startRoleEdit(log.id, myParticipant)} className="text-xs text-sky-600">
                              {(myParticipant.roles ?? []).length > 0 ? "내 역할 수정" : "내 역할 기록하기"}
                            </button>
                          )}
                          {canReview && log.status !== "draft" && !isLockedHistorical(log) && (
                            <ReviewActionButtons
                              phase={deriveReviewPhase(log.status, log.teacher_feedback)}
                              onApprove={() => handleApproveLog(log.id)}
                              onRequestRevision={() => setRevisionModalLogId(log.id)}
                              busy={reviewBusy}
                              size="xs"
                            />
                          )}
                          {exportCtx && log.status !== "draft" && (
                            <button
                              type="button"
                              onClick={() => handleExportLog(log.id)}
                              disabled={exportingLogId === log.id}
                              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-60"
                            >
                              <Download className="h-3 w-3" />
                              {exportingLogId === log.id ? "불러오는 중..." : "내보내기"}
                            </button>
                          )}
                        </div>

                        {isRoleEditing && (
                          <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
                            <RoleCheckboxes selected={roleEditRoles} onChange={setRoleEditRoles} />
                            <textarea
                              rows={2}
                              value={roleEditDescription}
                              onChange={(e) => setRoleEditDescription(e.target.value)}
                              placeholder="선택한 역할에서 본인이 실제로 담당한 내용을 간단히 작성하세요."
                              className="w-full rounded border border-slate-300 p-2 text-sm"
                            />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => saveMyRole(log.id)} disabled={roleSaving}
                                className="rounded bg-sky-600 px-3 py-1 text-xs text-white disabled:opacity-60">
                                {roleSaving ? "저장 중..." : "저장"}
                              </button>
                              <button type="button" onClick={() => setRoleEditingLogId(null)}
                                className="rounded border border-slate-300 px-3 py-1 text-xs">취소</button>
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <RevisionRequestModal
        open={revisionModalLogId != null}
        title="연구일지 수정 요청"
        onCancel={() => setRevisionModalLogId(null)}
        onSubmit={handleRequestLogRevision}
        submitting={reviewBusy}
      />

      {exportItems && <SubmissionExportDialog items={exportItems} onClose={() => setExportItems(null)} />}
    </div>
  );
}
