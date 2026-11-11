import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export type StatTone = "sky" | "violet" | "amber" | "emerald" | "rose" | "slate" | "red";

const ACCENT: Record<StatTone, string> = {
  sky: "bg-sky-50 text-sky-600",
  violet: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-600",
  emerald: "bg-emerald-50 text-emerald-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
  red: "bg-red-50 text-red-600",
};

/** 큰 숫자와 라벨이 한눈에 읽히는 요약 카드. href가 있으면 해당 화면으로 이동한다. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "sky",
  href,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: StatTone;
  href?: string;
  hint?: string;
}) {
  const body = (
    <Card className={cn("h-full", href && "transition-shadow hover:shadow-md")}>
      <div className="flex items-center gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", ACCENT[tone])}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
