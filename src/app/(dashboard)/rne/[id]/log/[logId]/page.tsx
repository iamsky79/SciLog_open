"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FileAttachments } from "@/components/ActivityLogSection";
import { statusLabel, statusTone, REVIEW_STATUSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ActivityLog, ReviewStatus, Team } from "@/lib/database.types";

const FORM_A_FIELDS: { key: keyof ActivityLog; label: string }[] = [
  { key: "goal", label: "오늘의 목표" },
  { key: "experiment", label: "실험 내용" },
  { key: "result", label: "결과 및 관찰" },
  { key: "conclusion", label: "고찰 및 결론" },
  { key: "next_plan", label: "다음 계획" },
  { key: "free_memo", label: "자유 메모" },
];

export default function RneLogDetailPage() {
  const params = useParams<{ id: string; logId: string }>();
  const { id: teamId, logId } = params;
  const router = useRouter();
  const { userId, profile, loading: authLoading } = useAuth();

  const [log, setLog] = useState<ActivityLog | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);

  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("pending");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const load = async () => {
    const supabase = createClient();
    setLoading(true);

    const [{ data: logData }, { data: teamData }] = await Promise.all([
      supabase.from("activity_logs").select("*").eq("id", logId).single(),
      supabase.from("teams").select("*").eq("id", teamId).single(),
    ]);

    const logRow = logData as ActivityLog | null;
    setLog(logRow);
    setTeam((teamData as Team) ?? null);

    if (logRow) {
      setReviewStatus(logRow.status);
      setReviewFeedback(logRow.teacher_feedback ?? "");

      const { data: authorRow } = await supabase
        .from("users")
        .select("name")
        .eq("id", logRow.author_id)
        .single();
      setAuthorName((authorRow as { name: string } | null)?.name ?? "알 수 없음");
    }

    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || !logId || !teamId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, logId, teamId]);

  const submitReview = async () => {
    if (!log) return;
    setSavingReview(true);
    setReviewError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("activity_logs")
      .update({ status: reviewStatus, teacher_feedback: reviewFeedback })
      .eq("id", log.id);
    setSavingReview(false);
    if (error) {
      setReviewError(`저장 실패: ${error.message} (code: ${error.code})`);
      return;
    }
    load();
  };

  if (loading || authLoading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (!log) return <p className="text-sm text-slate-400">기록을 찾을 수 없습니다.</p>;

  const canReview =
    profile != null &&
    (profile.is_admin || (profile.role === "teacher" && team?.teacher_id === userId));
  const isAuthor = log.author_id === userId;
  const canEdit = isAuthor && log.status === "pending";
  const canDelete =
    (isAuthor && log.status !== "approved") ||
    profile?.is_admin ||
    (profile?.role === "teacher" && team?.teacher_id === userId);

  const handleDelete = async () => {
    const supabase = createClient();
    await supabase.from("activity_logs").delete().eq("id", logId);
    router.push(`/rne/${teamId}`);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/rne/${teamId}`}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          목록으로
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone[log.status]}>{statusLabel[log.status]}</Badge>
          {canEdit && (
            <button
              type="button"
              onClick={() => router.push(`/rne/${teamId}/log/${logId}/edit`)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Pencil className="h-4 w-4" />
              수정하기
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              삭제
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-400">{log.log_date ?? "날짜 미상"}</p>
        <p className="mt-0.5 text-sm text-slate-500">{authorName}</p>
      </div>

      <Card className="space-y-4">
        {FORM_A_FIELDS.map(({ key, label }) =>
          log[key] ? (
            <div key={String(key)}>
              <p className="mb-1 text-xs font-medium text-slate-400">{label}</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{String(log[key])}</p>
            </div>
          ) : null
        )}
        <FileAttachments urls={log.file_urls ?? []} />
      </Card>

      {/* 교사 피드백 */}
      {!canReview && log.teacher_feedback && (
        <Card>
          <p className="text-xs font-medium text-slate-400">교사 피드백</p>
          <p className="mt-2 text-sm text-slate-700">{log.teacher_feedback}</p>
        </Card>
      )}

      {canReview && (
        <Card>
          <p className="text-sm font-semibold text-slate-900">검토</p>
          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              {REVIEW_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setReviewStatus(status)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    reviewStatus === status
                      ? "bg-sky-500 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {statusLabel[status]}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={reviewFeedback}
              onChange={(e) => setReviewFeedback(e.target.value)}
              placeholder="학생에게 전달할 피드백을 입력하세요"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            {reviewError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{reviewError}</p>
            )}
            <button
              type="button"
              onClick={submitReview}
              disabled={savingReview}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-60"
            >
              {savingReview ? "저장 중..." : "저장"}
            </button>
          </div>
        </Card>
      )}

      {/* 삭제 확인 모달 */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">연구일지 삭제</h2>
            <p className="text-sm text-slate-600">
              이 연구일지를 삭제하면 데이터를 복구할 수 없습니다. 정말 삭제하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDelete}
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
