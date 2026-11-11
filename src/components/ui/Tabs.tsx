"use client";

import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly TabItem<T>[];
  active: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            active === value
              ? "border-sky-500 text-sky-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
