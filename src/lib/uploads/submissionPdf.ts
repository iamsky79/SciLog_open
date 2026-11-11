// submission-pdfs는 private 버킷이다(037_submission_pdf_bucket_private.sql) —
// 이 버킷에 든 값은 더 이상 그냥 fetch/<a href>로 열 수 있는 공개 URL이 아니다.
// 업로드 시점(ReportSection.tsx)부터는 storage object path를 그대로
// research_reports.file_url에 저장하고(공개 URL을 미리 계산하지 않는다), 열람은
// 항상 /api/submissions/pdf-signed-url을 거쳐 짧은 유효시간의 signed URL을 받는다.
//
// 036이 잠깐 public 버킷이었던 동안 저장된 값은 여전히
// "https://.../object/public/submission-pdfs/..." 형태의 공개 URL일 수 있다 —
// 그 값도 여기서 그대로 path만 뽑아내 같은 signed URL 경로로 처리한다(레거시 호환).

const BUCKET_MARKER = "/object/public/submission-pdfs/";

/** 이 값이 submission-pdfs 버킷을 가리키는가 — path 그 자체(스킴 없음) 이거나, 그 버킷의 공개 URL(레거시)인 경우. */
export function isSubmissionPdfValue(value: string): boolean {
  return !value.includes("://") || value.includes(BUCKET_MARKER);
}

/** 공개 URL이든 이미 path든, storage object path만 뽑아낸다. */
export function extractSubmissionPdfPath(value: string): string {
  if (!value.includes("://")) return value;
  const i = value.indexOf(BUCKET_MARKER);
  return i === -1 ? value : decodeURIComponent(value.slice(i + BUCKET_MARKER.length));
}

/**
 * submission-pdfs에 든 값(path 또는 레거시 공개 URL)을 실제로 fetch/열람 가능한 URL로
 * 바꾼다. 다른 버킷(reports/activity-files 등, 여전히 public)의 값은 그대로 돌려준다 —
 * 이 함수는 항상 안전하게 호출해도 된다.
 *
 * 권한이 없거나(RLS가 막음) 파일이 없으면 null을 돌려준다 — 호출부는 항상 이 경우를
 * "이 파일은 내려받을 수 없다"로 취급해야 한다(예외를 던지지 않음).
 */
export async function resolveSubmissionFileUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (!isSubmissionPdfValue(value)) return value;

  const path = extractSubmissionPdfPath(value);
  try {
    const resp = await fetch("/api/submissions/pdf-signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}
