// 제출 기록 표에서 첨부파일을 바로 내려받기 위한 유틸.
// archive/page.tsx의 handleBulkZip과 동일한 패턴(fetch → blob → 임시 <a> 클릭)을 재사용한다.
// 다운로드 URL 자체는 DB에서 이미 RLS로 걸러진 행(research_plans/research_reports/
// submission_snapshots 등)에서만 나오므로, 별도의 새 권한 검사를 추가하지 않는다 —
// 기존에도 결과보고서/연구일지 상세 화면에서 동일한 URL을 그대로 <a href>로 노출해왔다.
//
// 단, research_reports.file_url(제출 본문 PDF)은 submission-pdfs가 private
// 버킷으로 바뀌면서(037_submission_pdf_bucket_private.sql) 더 이상 그 값 그대로
// fetch할 수 없다 — resolveSubmissionFileUrl이 그 값만 signed URL로 바꾸고,
// 다른 버킷(reports/activity-files 등, 여전히 public) 값은 그대로 통과시킨다.
// 어떤 attachment 목록이 이 함수들에 들어오든 안전하도록 항상 여기서 처리한다.

import { resolveSubmissionFileUrl } from "@/lib/uploads/submissionPdf";

export async function downloadFile(url: string, filename: string): Promise<void> {
  const resolved = await resolveSubmissionFileUrl(url);
  if (!resolved) {
    alert("파일에 접근할 권한이 없거나 파일을 찾을 수 없습니다.");
    return;
  }
  try {
    const resp = await fetch(resolved);
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch {
    // CORS 등으로 직접 다운로드가 막히면 최소한 새 탭에서라도 열 수 있게 폴백한다.
    window.open(resolved, "_blank", "noopener,noreferrer");
  }
}

export function dedupeNames(files: { name: string; url: string }[]): string[] {
  const used = new Set<string>();
  return files.map((f, i) => {
    let name = f.name?.trim() || `file_${i + 1}`;
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)}_${i + 1}${name.slice(dot)}` : `${name}_${i + 1}`;
    }
    used.add(name);
    return name;
  });
}

/** jszip은 이미 프로젝트 의존성(archive 페이지의 일괄 ZIP 다운로드)에 포함돼 있어 그대로 재사용한다. */
export async function downloadFilesAsZip(files: { name: string; url: string }[], zipName: string): Promise<void> {
  if (files.length === 0) return;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const names = dedupeNames(files);
  await Promise.all(
    files.map(async (f, i) => {
      try {
        const resolved = await resolveSubmissionFileUrl(f.url);
        if (!resolved) return;
        const resp = await fetch(resolved);
        if (!resp.ok) return; // 개별 파일 실패는 건너뛰고 나머지는 계속 담는다.
        const blob = await resp.blob();
        zip.file(names[i], blob);
      } catch {
        // 개별 파일 실패 무시
      }
    })
  );
  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
