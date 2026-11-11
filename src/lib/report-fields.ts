// 결과보고서(research_reports)를 보여주는 모든 화면(학생 작성/교사 검토, 포트폴리오,
// PDF/DOCX export, 제출물 허브/보관함, 제출 스냅샷)이 "서론 → 결론 → 연구 요약(기존 데이터)"
// 순서와 라벨을 여기 하나로 공유한다. summary는 introduction/conclusion 도입 이전 legacy
// 필드라 값이 있으면(신규 데이터와 동시에 있어도) 항상 마지막에 보존해서 보여준다.
// 빈 필드는 목록에서 그냥 빠진다("-" placeholder 없음) — 화면마다 다시 판단하지 않는다.

export interface ReportFieldsSource {
  introduction: string | null;
  conclusion: string | null;
  summary: string | null;
}

export interface ReportFieldEntry {
  label: string;
  value: string;
}

export function reportDisplayFields(source: ReportFieldsSource): ReportFieldEntry[] {
  const entries: ReportFieldEntry[] = [];
  if (source.introduction) entries.push({ label: "서론", value: source.introduction });
  if (source.conclusion) entries.push({ label: "결론", value: source.conclusion });
  if (source.summary) entries.push({ label: "연구 요약 (기존 데이터)", value: source.summary });
  return entries;
}

/** 결과보고서에 실제 작성 내용이 있는지 — title/introduction/conclusion/summary/파일 중
 * 하나라도 있으면 true. 허브/보관함이 "아직 작성 전"인지 판단하는 데 쓴다. */
export function hasReportContent(
  report: { title: string | null } & ReportFieldsSource,
  fileUrl: string | null
): boolean {
  return !!(report.title || report.introduction || report.conclusion || report.summary || fileUrl);
}
