"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { ACTIVITY_ROLE_CODES, ACTIVITY_ROLE_LABEL } from "@/lib/database.types";
import type { ActivityLog, ActivityLogParticipant, ActivityRoleCode, EntityType } from "@/lib/database.types";

interface MyRoleActivitySummaryProps {
  entityType: EntityType;
  entityId: string;
  studentId: string;
  /** 제공 시 이름 표시 (교사/관리자가 팀원별로 나열할 때) */
  studentName?: string;
}

interface RoleEntry {
  log: ActivityLog;
  participant: ActivityLogParticipant;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function MyRoleActivitySummary({ entityType, entityId, studentId, studentName }: MyRoleActivitySummaryProps) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<RoleEntry[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data: logsData } = await supabase
        .from("activity_logs")
        .select("*")
        .eq("entity_type", entityType).eq("entity_id", entityId).eq("log_type", "team")
        .neq("status", "draft");
      const logs = (logsData as ActivityLog[]) ?? [];
      const logMap = Object.fromEntries(logs.map((l) => [l.id, l]));
      const logIds = logs.map((l) => l.id);

      let rows: ActivityLogParticipant[] = [];
      if (logIds.length > 0) {
        const { data: pData } = await supabase
          .from("activity_log_participants")
          .select("*")
          .eq("student_id", studentId)
          .in("log_id", logIds);
        rows = (pData as ActivityLogParticipant[]) ?? [];
      }
      if (cancelled) return;

      const list = rows
        .map((p) => ({ log: logMap[p.log_id], participant: p }))
        .filter((e): e is RoleEntry => !!e.log)
        .sort((a, b) => (b.log.log_date ?? "").localeCompare(a.log.log_date ?? ""));
      setEntries(list);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entityType, entityId, studentId]);

  const roleCounts = Object.fromEntries(ACTIVITY_ROLE_CODES.map((c) => [c, 0])) as Record<ActivityRoleCode, number>;
  for (const e of entries) for (const r of e.participant.roles ?? []) roleCounts[r] = (roleCounts[r] ?? 0) + 1;

  if (loading) return <Card className="text-sm text-slate-400">불러오는 중...</Card>;

  return (
    <Card className="space-y-4">
      {studentName && <p className="text-sm font-semibold text-slate-800">{studentName}</p>}

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">참여 활동 요약</p>
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-slate-100 px-2.5 py-1">참여 연구일지 {entries.length}건</span>
          {ACTIVITY_ROLE_CODES.filter((c) => roleCounts[c] > 0).map((c) => (
            <span key={c} className="rounded-full bg-slate-100 px-2.5 py-1">{ACTIVITY_ROLE_LABEL[c]} {roleCounts[c]}회</span>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-400">아직 참여한 연구일지가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700">참여 기록</p>
          <ul className="divide-y divide-slate-100">
            {entries.map(({ log, participant }) => {
              const isExpanded = expandedLogId === log.id;
              return (
                <li key={log.id} className="py-2.5">
                  <button type="button" onClick={() => setExpandedLogId(isExpanded ? null : log.id)} className="w-full text-left">
                    <p className="text-xs text-slate-400">{log.log_date ? fmtDate(log.log_date) : "날짜 미상"}</p>
                    <p className="text-sm font-medium text-slate-800">{log.title || "(제목 없음)"}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {(participant.roles ?? []).length > 0
                        ? participant.roles.map((r) => ACTIVITY_ROLE_LABEL[r]).join(" / ")
                        : "역할 미입력"}
                    </p>
                  </button>
                  {isExpanded && (
                    <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                      {participant.role_description && (
                        <p><span className="font-medium text-slate-500">구체적으로 한 일: </span>{participant.role_description}</p>
                      )}
                      {log.experiment && <p><span className="font-medium text-slate-500">연구 활동: </span>{log.experiment}</p>}
                      {log.result && <p><span className="font-medium text-slate-500">주요 결과 및 관찰: </span>{log.result}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
