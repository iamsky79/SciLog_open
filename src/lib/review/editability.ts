/**
 * 계획서/결과보고서를 학생이 수정할 수 있는지 — 오직 workflow 상태(draft, rejected)와 권한(canEdit)으로만 정한다.
 * 출처(provenance="historical_import")는 여기에 영향을 주지 않는다. 아직 전환되지 않은 status="historical"은
 * draft/rejected가 아니므로 이 규칙만으로 계속 잠겨 있다.
 */
export function isDocumentEditable(canEdit: boolean, status: string | null | undefined): boolean {
  return canEdit && (status === "draft" || status === "rejected");
}
