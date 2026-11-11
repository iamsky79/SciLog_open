"use client";

import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

interface AccordionProps {
  title: string;
  summary?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function Accordion({ title, summary, open, onToggle, children }: AccordionProps) {
  return (
    <Card className="space-y-0 !p-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <span className="text-base font-semibold text-slate-900">{title}</span>
        <span className="flex items-center gap-3">
          {summary}
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="space-y-4 border-t border-slate-100 px-5 py-4">{children}</div>}
    </Card>
  );
}
