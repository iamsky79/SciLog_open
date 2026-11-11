"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { observationAcademicYear, sortObservationsForPortfolio, type TeacherObservation } from "@/lib/observations/actions";

// 교사 포트폴리오 화면(/student/[id])에서만 쓰는 "교사 관찰 기록" — 모든 프로젝트가
// 끝난 뒤 포트폴리오 맨 마지막에 별도 section으로 보여준다. getStudentPortfolio()가
// 반환하는 StudentPortfolio 안에는 절대 들어가지 않으므로(그 함수는 학생 본인 화면과
// export가 그대로 같이 쓰는 PRIVACY BOUNDARY), 이 컴포넌트는 항상 부모(/student/[id]
// page.tsx)가 fetchObservations()로 별도 조회해 준 데이터만 props로 받는다. 학생
// 본인 화면(/portfolio)에서는 이 컴포넌트 자체를 렌더링하지 않는다.
//
// 원 관찰 기록을 그대로 academic year 오름차순 → created_at 오름차순으로 나열할 뿐,
// AI 요약이나 자동 분류는 하지 않는다(요청사항).

export function TeacherObservationsSection({ observations }: { observations: TeacherObservation[] }) {
  const groups = useMemo(() => {
    const sorted = sortObservationsForPortfolio(observations);
    const result: { year: number | null; items: TeacherObservation[] }[] = [];
    for (const o of sorted) {
      const year = observationAcademicYear(o);
      const last = result[result.length - 1];
      if (last && last.year === year) last.items.push(o);
      else result.push({ year, items: [o] });
    }
    return result;
  }, [observations]);

  if (observations.length === 0) return null;

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">교사 관찰 기록</h2>
        <span className="text-sm text-slate-500">{observations.length}건</span>
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.year ?? "미상"} className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">{g.year != null ? `${g.year}학년도` : "학년도 미상"}</p>
            <ul className="space-y-2">
              {g.items.map((o) => (
                <li key={o.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {o.activityType && <Badge tone="gray">{o.activityType}</Badge>}
                    <Badge tone={o.isMine ? "blue" : "gray"}>{o.isMine ? "내 기록" : "교사 기록"}</Badge>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{o.content}</p>
                  {o.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {o.tags.map((t) => (
                        <span key={t} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-500">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
