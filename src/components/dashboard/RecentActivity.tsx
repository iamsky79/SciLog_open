import Link from "next/link";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { statusLabel, statusTone } from "@/lib/status";
import type { FeedItem } from "@/lib/dashboard/data";
import type { EntityType } from "@/lib/database.types";

const TYPE_LABEL: Record<EntityType, string> = { team: "팀 활동", individual: "창의개인연구", other: "기타 활동" };

export function RecentActivity({ feed, loading }: { feed: FeedItem[]; loading?: boolean }) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-slate-900">최근 활동</h2>
      {loading ? (
        <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
      ) : feed.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">최근 활동 기록이 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {feed.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 transition-colors hover:text-sky-600">
                <div className="flex min-w-0 items-center gap-3">
                  <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate text-sm text-slate-700">{item.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={statusTone[item.status]}>{statusLabel[item.status]}</Badge>
                  <span className="text-xs text-slate-400">{TYPE_LABEL[item.entityType]}</span>
                  <span className="text-xs text-slate-400">{item.logDate ?? "날짜 미상"}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
