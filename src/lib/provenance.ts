/**
 * 출처(provenance)와 workflow 상태(status)는 별개다.
 * - provenance="historical_import": 과거 활동을 사후에 기록한 데이터라는 "출처" 정보. 이 row가 draft/submitted/pending 등
 *   live workflow 상태로 전환돼도 남는다. 출처 때문에 수정이 막히거나 보관함에서 제외되지는 않는다.
 * - status="historical": 아직 live workflow로 전환되지 않은, 잠긴 과거 기록.
 */
export const HISTORICAL_IMPORT = "historical_import";

type SourceInfo = { status?: string | null; provenance?: string | null } | null | undefined;

/** 과거 import 출처인가 — 표시/집계용(관리교사 표기, 기록 문서 수). 편집 가능 여부에는 쓰지 않는다. */
export function isHistoricalImport(row: SourceInfo): boolean {
  return row?.status === "historical" || row?.provenance === HISTORICAL_IMPORT;
}

/** 아직 잠긴 과거 기록인가 — status가 historical인 경우만. provenance만으로는 잠기지 않는다. */
export function isLockedHistorical(row: SourceInfo): boolean {
  return row?.status === "historical";
}
