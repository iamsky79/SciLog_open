"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowRight, X, FileText, ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { statusLabel, statusTone, REVIEW_STATUSES } from "@/lib/status";
import type { ActivityLog, EntityType, ReviewStatus } from "@/lib/database.types";

// ────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────
export const FORM_A_FIELDS: { key: keyof ActivityLog; label: string }[] = [
  { key: "goal", label: "오늘의 목표" },
  { key: "experiment", label: "실험 내용" },
  { key: "result", label: "결과 및 관찰" },
  { key: "conclusion", label: "고찰 및 결론" },
  { key: "next_plan", label: "다음 계획" },
  { key: "free_memo", label: "자유 메모" },
];

export const FORM_B_FIELDS: { key: keyof ActivityLog; label: string }[] = [
  { key: "activity_content", label: "활동 내용" },
  { key: "achievement", label: "성과 및 소감" },
];

const emptyForm = {
  log_date: new Date().toISOString().slice(0, 10),
  title: "",
  goal: "",
  experiment: "",
  result: "",
  conclusion: "",
  next_plan: "",
  free_memo: "",
  activity_content: "",
  achievement: "",
};

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export type FilterTab = "all" | "mine" | "others";

// ────────────────────────────────────────────────────────────────
// 헬퍼
// ────────────────────────────────────────────────────────────────

// Supabase Storage key는 ASCII만 허용 → 한글/특수문자를 언더스코어로 치환
function sanitizeStorageFileName(name: string): string {
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx !== -1 ? name.slice(dotIdx) : "";
  const base = dotIdx !== -1 ? name.slice(0, dotIdx) : name;
  const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 80);
  return (safeBase || "file") + ext;
}

function isImage(url: string) {
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

// ────────────────────────────────────────────────────────────────
// 파일 첨부 표시
// ────────────────────────────────────────────────────────────────
export function FileAttachments({ urls }: { urls: string[] }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-medium text-slate-500">첨부 파일</p>
      <div className="flex flex-wrap gap-2">
        {urls.map((url) =>
          isImage(url) ? (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={fileNameFromUrl(url)}
                className="h-20 w-20 rounded-lg border border-slate-200 object-cover hover:opacity-90"
              />
            </a>
          ) : (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
            >
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              {fileNameFromUrl(url)}
            </a>
          )
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 파일 업로드 미리보기
// ────────────────────────────────────────────────────────────────
function FileUploadPreview({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file, idx) => {
        const isImg = file.type.startsWith("image/");
        const previewUrl = isImg ? URL.createObjectURL(file) : null;
        return (
          <div key={idx} className="relative">
            {isImg && previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={file.name} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
            ) : (
              <div className="flex h-20 w-32 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{file.name}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(idx)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────────────────────────
interface ActivityLogSectionProps {
  entityType: EntityType;
  entityId: string;
  currentUserId: string;
  canReview: boolean;
  /** 제공 시 목록을 접힌 형태로 표시하고 클릭 시 해당 경로로 이동. 예: /rne/{teamId}/log */
  logBasePath?: string;
  filterTab?: FilterTab;
  onFilterTabChange?: (tab: FilterTab) => void;
  /** true 시 필터 탭 숨김 — canReview면 전체, 아니면 본인 기록만 표시 */
  hideFilterTabs?: boolean;
  /** 'team'(팀 공동 일지, 기본값) | 'personal'(매일 쓰는 개인 일지 — 작성자 본인 + 교사/관리자만 열람) */
  logType?: "team" | "personal";
  /** logType="personal"일 때 필수 — 누구의 개인 일지를 보여줄지 */
  authorFilter?: string;
  /** 섹션 제목 (기본값 "활동 기록") */
  title?: string;
}

export function ActivityLogSection({
  entityType,
  entityId,
  currentUserId,
  canReview,
  logBasePath,
  filterTab: controlledFilterTab,
  onFilterTabChange,
  hideFilterTabs = false,
  logType = "team",
  authorFilter,
  title = "활동 기록",
}: ActivityLogSectionProps) {
  const router = useRouter();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("pending");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [internalFilterTab, setInternalFilterTab] = useState<FilterTab>("all");
  const filterTab = controlledFilterTab ?? internalFilterTab;
  const setFilterTab = (tab: FilterTab) => {
    setInternalFilterTab(tab);
    onFilterTabChange?.(tab);
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fields = entityType === "other" ? FORM_B_FIELDS : FORM_A_FIELDS;
  const collapsed = !!logBasePath;

  const loadLogs = async () => {
    const supabase = createClient();
    setLoading(true);
    let query = supabase
      .from("activity_logs")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("log_type", logType);
    if (logType === "personal" && authorFilter) query = query.eq("author_id", authorFilter);
    const { data } = await query
      .order("log_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    const rows = (data as ActivityLog[]) ?? [];
    setLogs(rows);

    const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
    if (authorIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, name").in("id", authorIds);
      const map: Record<string, string> = {};
      for (const u of users ?? []) map[u.id] = u.name;
      setAuthorNames(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, logType, authorFilter]);

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
      setFileError(`파일 크기는 10MB 이하여야 합니다: ${oversized.name}`);
      return;
    }
    setSelectedFiles(combined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setUploadingFiles(selectedFiles.length > 0);
    const supabase = createClient();

    const { data: log, error: insertError } = await supabase
      .from("activity_logs")
      .insert({ entity_type: entityType, entity_id: entityId, author_id: currentUserId, log_type: logType, ...form, file_urls: [] })
      .select()
      .single();

    if (insertError || !log) { setSaving(false); setUploadingFiles(false); return; }

    const fileUrls: string[] = [];
    const failedFiles: string[] = [];
    for (const file of selectedFiles) {
      const safeName = sanitizeStorageFileName(file.name);
      const path = `${currentUserId}/${log.id}/${safeName}`;
      console.log("[upload] 파일 업로드 시도:", { name: file.name, safeName, size: file.size, type: file.type, path });
      const { data: uploadData, error: uploadError } = await supabase.storage.from("activity-files").upload(path, file, { upsert: true });
      if (uploadError) {
        console.error("[upload] 업로드 실패:", { file: file.name, message: uploadError.message, statusCode: (uploadError as { statusCode?: string }).statusCode, error: uploadError });
        failedFiles.push(file.name);
      } else {
        console.log("[upload] 업로드 성공:", uploadData);
        const { data: urlData } = supabase.storage.from("activity-files").getPublicUrl(path);
        if (urlData?.publicUrl) fileUrls.push(urlData.publicUrl);
      }
    }
    if (failedFiles.length > 0) {
      setFileError(`다음 파일 업로드 실패: ${failedFiles.join(", ")} (개발자 콘솔에서 에러 확인)`);
    }
    if (fileUrls.length > 0) {
      await supabase.from("activity_logs").update({ file_urls: fileUrls }).eq("id", log.id);
    }

    setSaving(false);
    setUploadingFiles(false);
    if (failedFiles.length === 0) {
      setShowForm(false);
      setForm(emptyForm);
      setSelectedFiles([]);
    }
    loadLogs();
  };

  const startReview = (log: ActivityLog) => {
    setReviewingId(log.id);
    setReviewStatus(log.status);
    setReviewFeedback(log.teacher_feedback ?? "");
  };

  const submitReview = async (logId: string) => {
    const supabase = createClient();
    await supabase.from("activity_logs").update({ status: reviewStatus, teacher_feedback: reviewFeedback }).eq("id", logId);
    setReviewingId(null);
    loadLogs();
  };

  const canDeleteLog = (log: ActivityLog) => {
    if (log.status === "pending") return log.author_id === currentUserId || canReview;
    return canReview;
  };

  const handleDeleteLog = async (logId: string) => {
    const supabase = createClient();
    await supabase.from("activity_logs").delete().eq("id", logId);
    setDeleteConfirmId(null);
    loadLogs();
  };

  const canAddLog = logType === "personal" ? authorFilter === currentUserId : true;

  const filteredLogs = logType === "personal"
    ? logs
    : logs.filter((log) => {
        if (hideFilterTabs) return canReview || log.author_id === currentUserId;
        if (filterTab === "mine") return log.author_id === currentUserId;
        if (filterTab === "others") return log.author_id !== currentUserId;
        return true;
      });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {canAddLog && (
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-600"
          >
            <Plus className="h-4 w-4" />
            기록 추가
          </button>
        )}
      </div>

      {showForm && (
        <Card>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">제목 <span className="text-red-500">*</span></label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="예: 1차 실험 기록"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">날짜</label>
              <input
                type="date"
                required
                value={form.log_date}
                onChange={(e) => setForm({ ...form, log_date: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            {fields.map(({ key, label }) => (
              <div key={String(key)}>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
                <textarea
                  rows={2}
                  value={String(form[key as keyof typeof form] ?? "")}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            ))}

            {/* 파일 업로드 */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                파일 첨부 ({selectedFiles.length}/{MAX_FILES})
              </label>
              <p className="mb-1.5 text-xs text-slate-400">사진, PDF, 문서 등 · 최대 5개 · 각 10MB 이하</p>
              <FileUploadPreview files={selectedFiles} onRemove={removeFile} />
              {selectedFiles.length < MAX_FILES && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
                  <ImageIcon className="h-4 w-4" />
                  파일 선택
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.hwp,.ppt,.pptx,.xls,.xlsx"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              )}
              {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadingFiles ? "파일 업로드 중..." : saving ? "저장 중..." : "저장"}
            </button>
          </form>
        </Card>
      )}

      {/* 필터 탭 */}
      {!loading && logs.length > 0 && !hideFilterTabs && logType !== "personal" && (
        <div className="flex gap-1 border-b border-slate-200">
          {([["all", "전체"], ["mine", "내 기록"], ["others", "팀원 기록"]] as [FilterTab, string][]).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilterTab(value)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  filterTab === value
                    ? "border-sky-500 text-sky-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                {label}
              </button>
            )
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중...</p>
      ) : filteredLogs.length === 0 ? (
        <p className="text-sm text-slate-400">
          {logs.length === 0 ? "아직 활동 기록이 없습니다." : "해당 기록이 없습니다."}
        </p>
      ) : collapsed ? (
        // ── 접힌 목록 (logBasePath 제공 시) ──
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {filteredLogs.map((log) => (
            <button
              key={log.id}
              type="button"
              onClick={() => router.push(`${logBasePath}/${log.id}`)}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50"
            >
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium text-slate-700">{log.title || "(제목 없음)"}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{log.log_date ?? "날짜 미상"}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">{authorNames[log.author_id] ?? "알 수 없음"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone[log.status]}>{statusLabel[log.status]}</Badge>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        // ── 펼쳐진 카드 목록 (logBasePath 없을 때) ──
        <div className="space-y-3">
          {filteredLogs.map((log) => (
            <Card
              key={log.id}
              className={cn(canReview && "cursor-pointer")}
              onClick={canReview ? () => startReview(log) : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{log.title || "(제목 없음)"}</p>
                  <p className="text-sm text-slate-500">
                    {log.log_date ?? "날짜 미상"} · {authorNames[log.author_id] ?? "알 수 없음"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone[log.status]}>{statusLabel[log.status]}</Badge>
                  {canDeleteLog(log) && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(log.id); }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                {fields.map(
                  ({ key, label }) =>
                    log[key] && (
                      <p key={String(key)}>
                        <span className="font-medium text-slate-500">{label}: </span>
                        {String(log[key])}
                      </p>
                    )
                )}
              </div>
              <FileAttachments urls={log.file_urls ?? []} />
              {log.teacher_feedback && (
                <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  <span className="font-medium text-slate-500">교사 피드백: </span>
                  {log.teacher_feedback}
                </p>
              )}
              {canReview && reviewingId === log.id && (
                <div
                  className="mt-4 space-y-3 border-t border-slate-100 pt-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex gap-2">
                    {REVIEW_STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setReviewStatus(status)}
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                          reviewStatus === status ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        {statusLabel[status]}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    value={reviewFeedback}
                    onChange={(e) => setReviewFeedback(e.target.value)}
                    placeholder="피드백을 입력하세요"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => submitReview(log.id)}
                    className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600"
                  >
                    저장
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">활동 기록 삭제</h2>
            <p className="text-sm text-slate-600">
              삭제하면 데이터를 복구할 수 없습니다. 정말 삭제하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => handleDeleteLog(deleteConfirmId)}
                className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
