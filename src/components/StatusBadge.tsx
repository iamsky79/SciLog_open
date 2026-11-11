import { STATUS_LABEL, STATUS_COLOR } from "@/lib/status";

const clsMap: Record<string, string> = {
  gray:   "bg-slate-100 text-slate-500",
  yellow: "bg-amber-100 text-amber-700",
  green:  "bg-green-100 text-green-700",
  red:    "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const color = STATUS_COLOR[status] ?? "gray";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${clsMap[color]}`}>
      {label}
    </span>
  );
}
