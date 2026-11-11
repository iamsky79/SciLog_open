// "제출 본문 파일"(학생이 별도로 업로드해 제출하는 문서)은 PDF만 허용한다.
// 첨부파일(추가 자료)은 이 검증을 거치지 않는다 — 원본 형식(xlsx/csv/jpg/png/zip 등)을
// 그대로 유지해야 하기 때문이다(별도 정책 없음, 기존 허용 범위 유지).
//
// <input accept=".pdf"> 같은 client 힌트만으로는 사용자가 "모든 파일"을 선택해
// 다른 형식을 올릴 수 있으므로, 실제 업로드 직전에 확장자+MIME을 함께 확인한다.
// (추가로 storage 버킷 자체에도 allowed_mime_types=['application/pdf']를 걸어
// 두었다 — supabase/migrations/036_submission_pdf_bucket.sql — 이 함수가 우회되어도
// 스토리지 단에서 한 번 더 막힌다.)

export const SUBMISSION_PDF_ACCEPT = ".pdf,application/pdf";

export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

export function validateSubmissionPdf(file: File): FileValidationResult {
  const hasPdfExt = /\.pdf$/i.test(file.name);
  const mimeOk = file.type === "" || file.type === "application/pdf";
  if (!hasPdfExt || !mimeOk) {
    return {
      ok: false,
      error: "제출 파일은 PDF만 업로드할 수 있습니다. 작성 프로그램에서 PDF로 변환한 뒤 다시 업로드해주세요.",
    };
  }
  return { ok: true };
}
