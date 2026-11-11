import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { PROJECT_KIND_LABEL, type ProjectKind, type ProjectProgress } from "@/lib/dashboard/journey";
import { reviewNeeded, revisionRequested } from "@/lib/dashboard/summary";

const KIND_ORDER: ProjectKind[] = ["rne", "club", "individual"];
const KIND_CHIP: Record<ProjectKind, string> = { rne: "bg-sky-100 text-sky-700", club: "bg-violet-100 text-violet-700", individual: "bg-amber-100 text-amber-700" };

const DOC_LABEL: Record<string, string> = { draft: "작성 중", submitted: "검토 대기", approved: "승인 완료", rejected: "수정 요청", historical: "과거 기록" };
const DOC_TONE: Record<string, Tone> = { draft: "gray", submitted: "gold", approved: "green", rejected: "red", historical: "gray" };

function DocBadge({ label, status }: { label: string; status: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
      {label}
      {status ? <Badge tone={DOC_TONE[status] ?? "gray"}>{DOC_LABEL[status] ?? status}</Badge> : <span className="text-slate-300">-</span>}
    </span>
  );
}

/** 연구별 계획서/결과보고서 상태와 연구일지 수 — 학생(내 연구)과 교사(담당 연구)가 같은 모양으로 쓴다. */
export function ProjectProgressList({
  title,
  projects,
  mode,
  loading,
}: {
  title: string;
  projects: ProjectProgress[];
  mode: "student" | "teacher";
  loading?: boolean;
}) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {loading ? (
        <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
      ) : projects.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">{mode === "student" ? "참여 중인 연구가 없습니다." : "담당하는 연구가 없습니다."}</p>
      ) : (
        <div className="mt-4 space-y-5">
          {KIND_ORDER.map((kind) => {
            const rows = projects
              .filter((p) => p.kind === kind)
              .sort((a, b) => reviewNeeded(b) - reviewNeeded(a) || (b.year ?? "").localeCompare(a.year ?? ""));
            if (rows.length === 0) return null;
            return (
              <section key={kind}>
                <p className="mb-1 text-xs font-semibold text-slate-500">
                  {PROJECT_KIND_LABEL[kind]} <span className="font-normal text-slate-400">· {rows.length}개</span>
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                  {rows.map((p) => {
                    const needs = reviewNeeded(p);
                    const rejected = revisionRequested(p);
                    const canSubmit = mode === "student" && p.report !== "submitted" && p.report !== "approved" && p.report !== "historical";
                    return (
                      <li key={`${p.kind}-${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5">
                        <div className="flex min-w-0 flex-1 basis-[220px] items-center gap-2">
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_CHIP[p.kind]}`}>{p.year ?? PROJECT_KIND_LABEL[p.kind]}</span>
                          <Link href={p.href} className="truncate text-sm font-medium text-slate-800 hover:text-sky-600">
                            {p.name}
                          </Link>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <DocBadge label="계획서" status={p.plan} />
                          <DocBadge label="보고서" status={p.report} />
                          <span className="text-xs text-slate-400">일지 {p.logTotal}건</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {needs > 0 && <Badge tone="gold">{mode === "teacher" ? `검토 필요 ${needs}` : `검토 중 ${needs}`}</Badge>}
                          {rejected > 0 && <Badge tone="red">수정 요청 {rejected}</Badge>}
                          {canSubmit && (
                            <Link href={`/submit-report?entity=${p.kind}&id=${p.id}`} className="rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-600 hover:bg-sky-100">
                              보고서 제출
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
