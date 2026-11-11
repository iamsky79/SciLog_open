import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { TeachingActivityKind } from "@/lib/portfolio/teaching";

// 포트폴리오 "본문"이 아니라 교사용 관리 context — 학생 계정에는 그대로 노출하지 않는다.
// 여기서 새 검토 시스템을 만들지 않고, getStudentPortfolio()가 이미 계산해 둔
// management 값(기존 review/actions.ts의 deriveReviewPhase 재사용 결과)만 보여준다.

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function TeacherManagementPanel({
  teachingKinds,
  management,
  reviewHref,
}: {
  teachingKinds: TeachingActivityKind[];
  management: { recentActivityAt: string | null; revisionNeededCount: number; pendingReviewCount: number };
  reviewHref: string;
}) {
  const isTeaching = teachingKinds.length > 0;
  return (
    <Card className="space-y-2 !bg-slate-50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">지도 학생 여부:</span>
        {isTeaching ? <Badge tone="blue">지도</Badge> : <span className="text-sm text-slate-400">비지도</span>}
        {isTeaching && <span className="text-xs text-slate-500">지도 활동: {teachingKinds.join(" · ")}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>최근 활동: {fmtDate(management.recentActivityAt)}</span>
        {management.revisionNeededCount > 0 && (
          <Link href={reviewHref} className="font-medium text-red-600 hover:underline">
            수정 요청 미반영 {management.revisionNeededCount}건
          </Link>
        )}
        {management.pendingReviewCount > 0 && (
          <Link href={reviewHref} className="font-medium text-amber-600 hover:underline">
            검토 대기 {management.pendingReviewCount}건
          </Link>
        )}
      </div>
    </Card>
  );
}
