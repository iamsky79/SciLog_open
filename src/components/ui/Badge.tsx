import { cn } from "@/lib/utils";

const toneStyles = {
  green: "bg-emerald-100 text-emerald-700",
  blue: "bg-blue-100 text-blue-700",
  red: "bg-red-100 text-red-700",
  gold: "bg-yellow-100 text-yellow-800",
  gray: "bg-slate-200 text-slate-700",
  copper: "bg-orange-100 text-orange-800",
} as const;

export type Tone = keyof typeof toneStyles;

export function Badge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        toneStyles[tone]
      )}
    >
      {children}
    </span>
  );
}
