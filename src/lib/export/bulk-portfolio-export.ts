import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { StudentPortfolio } from "@/lib/portfolio/detail";
import type { TeacherObservation } from "@/lib/observations/actions";
import { mergePdfDocuments, sanitizeDownloadName } from "./common";
import { buildFullPortfolioPDFBytes, hasExportableContent, portfolioFileBaseName } from "./render-full-portfolio";

// 교사가 학생 여러 명의 포트폴리오를 한 번에 내보낼 때 쓴다. 단일 학생용
// renderer(render-full-portfolio.ts)를 그대로 재사용한다 — 학생별로 다른 문서를
// 만드는 게 아니라, 같은 renderer가 만든 결과물을 여러 개 모으기만 한다.
//
// 통합 PDF: mergePdfDocuments(이미 submission-export.ts가 쓰는 pdf-lib 기반 병합)로
// 학생별 PDF를 그대로 이어 붙인다 — 한 학생의 문서가 항상 자기 페이지에서
// 시작하므로(새 PdfWriter 인스턴스 = 새 문서) 병합 시 학생 간 내용이 섞일 수 없다.
//
// 실패 처리: 한 학생의 렌더링이 실패해도 전체 export를 중단하지 않고, 그 학생만
// 건너뛰고 warning에 남긴다(요청사항 33).

export interface BulkPortfolioExportResult {
  warnings: string[];
  exportedCount: number;
}

function todayCompact(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/** BulkPortfolioExportDialog는 학생 조회(directory)와 별개 경로에서 학생 목록을 받으므로,
 * "이 학생의 교사 관찰 기록"을 student.id로 찾아 넘긴다 — 없는 학생은 빈 배열(기존과 동일). */
export async function exportPortfoliosBulk(
  portfolios: StudentPortfolio[],
  format: "pdf" | "zip",
  observationsByStudent: Record<string, TeacherObservation[]> = {}
): Promise<BulkPortfolioExportResult> {
  const warnings: string[] = [];
  const exportable = portfolios.filter((p) => hasExportableContent(p));
  const skipped = portfolios.length - exportable.length;
  if (skipped > 0) warnings.push(`${skipped}명은 내보낼 연구 기록이 없어 제외되었습니다.`);
  if (exportable.length === 0) {
    warnings.push("내보낼 수 있는 학생이 없습니다.");
    return { warnings, exportedCount: 0 };
  }

  const label = `학생포트폴리오_${exportable.length}명_${todayCompact()}`;

  if (format === "pdf") {
    const buffers: Uint8Array[] = [];
    const okStudents: StudentPortfolio[] = [];
    for (const p of exportable) {
      try {
        buffers.push(await buildFullPortfolioPDFBytes(p, undefined, true, observationsByStudent[p.student.id] ?? []));
        okStudents.push(p);
      } catch {
        warnings.push(`${p.student.name} 학생의 포트폴리오 생성에 실패해 제외되었습니다.`);
      }
    }
    const { bytes, failures } = await mergePdfDocuments(buffers);
    for (const f of failures) {
      const student = okStudents[f.index];
      warnings.push(`${student?.student.name ?? `${f.index + 1}번째 학생`}의 포트폴리오를 통합 PDF에 병합하지 못했습니다.`);
    }
    saveAs(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${label}.pdf`);
    return { warnings, exportedCount: okStudents.length };
  }

  // ZIP — 학생별 폴더에 각자의 PDF를 담는다.
  const zip = new JSZip();
  let exportedCount = 0;
  for (const p of exportable) {
    try {
      const bytes = await buildFullPortfolioPDFBytes(p, undefined, true, observationsByStudent[p.student.id] ?? []);
      const folderName = sanitizeDownloadName(p.student.name);
      const dir = zip.folder(folderName);
      dir?.file(`${portfolioFileBaseName(p)}.pdf`, bytes);
      exportedCount++;
    } catch {
      warnings.push(`${p.student.name} 학생의 포트폴리오 생성에 실패해 제외되었습니다.`);
    }
  }
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, `${label}.zip`);
  return { warnings, exportedCount };
}
