import { ACTIVITY_ROLE_CODES, ACTIVITY_ROLE_LABEL } from "@/lib/database.types";
import { exportFileName, fmtDate, loadDocx, makeDocxHelpers, PdfWriter } from "./common";
import type { PortfolioExportPayload } from "./types";

// 주의: 아래 "참여 활동 요약"은 역할 참여 횟수를 있는 그대로 집계한 원자료(raw frequency)이며,
// 역량 평가·점수·등급이 아니다. 문서 어디에도 점수화된 표현을 쓰지 않는다.
const RAW_COUNT_NOTE = "※ 아래 수치는 연구일지에 기록된 참여 횟수를 단순 집계한 것이며, 역량 평가 점수가 아닙니다.";

export async function generatePortfolioExportPDF(
  data: PortfolioExportPayload,
  entityKind: "rne" | "club" | "individual"
): Promise<void> {
  const w = await PdfWriter.create(JSON.stringify(data));

  w.line(`${data.studentName} 개인 연구 포트폴리오`, 20, true);
  w.spacer(1);
  w.line(data.entityName, 12, false, "#6b7280");
  if (data.periodLabel) w.line(data.periodLabel, 11, false, "#6b7280");
  w.spacer(3);
  w.hline();

  w.line("참여 활동 요약", 13, true);
  w.line(RAW_COUNT_NOTE, 8.5, false, "#9ca3af");
  w.spacer(1);
  w.labeledLine("참여 연구일지", `${data.totalParticipatedLogs}건`, 10.5);
  for (const code of ACTIVITY_ROLE_CODES) {
    const count = data.roleCounts[code] ?? 0;
    if (count > 0) w.line(`- ${ACTIVITY_ROLE_LABEL[code]}: ${count}회`, 10);
  }
  w.spacer(3);
  w.hline();

  if (data.personalRecord) {
    const pr = data.personalRecord;
    const rows: { label: string; value: string | null }[] = [
      { label: "연구 동기", value: pr.motivation },
      { label: entityKind === "individual" ? "연구에서 나의 접근 방식" : "팀에서 나의 역할", value: pr.myRole },
      { label: "배운 점 / 느낀 점", value: pr.lessonsLearned },
      { label: "어려웠던 점과 해결 과정", value: pr.challenges },
    ];
    if (rows.some((r) => r.value)) {
      w.line("나의 연구 기록", 13, true);
      for (const { label, value } of rows) {
        if (!value) continue;
        w.line(label, 10.5, true);
        w.line(value, 10);
        w.spacer(1);
      }
      w.spacer(2);
      w.hline();
    }
  }

  w.line("참여 기록 (시간순)", 13, true);
  w.spacer(1);
  if (data.entries.length === 0) {
    w.line("아직 참여한 연구일지가 없습니다.", 10.5, false, "#9ca3af");
  }
  for (const entry of data.entries) {
    w.checkPage(16);
    w.line(entry.date ? `${fmtDate(entry.date)}  ·  ${entry.logTitle || "(제목 없음)"}` : entry.logTitle || "(제목 없음)", 11, true, "#0ea5e9");
    const roleText = entry.roles.length > 0 ? entry.roles.map((r) => ACTIVITY_ROLE_LABEL[r]).join(" / ") : "역할 미입력";
    w.line(`역할: ${roleText}`, 10);
    if (entry.roleDescription) w.line(`구체적으로 한 일: ${entry.roleDescription}`, 9.5, false, "#374151");
    if (entry.teamContentSnippet) w.line(`팀 기록 맥락: ${entry.teamContentSnippet}`, 9, false, "#9ca3af");
    w.spacer(2);
  }

  w.pageNumbers();
  w.save(exportFileName(entityKind, data.studentName, "개인연구포트폴리오", "pdf"));
}

export async function generatePortfolioExportDOCX(
  data: PortfolioExportPayload,
  entityKind: "rne" | "club" | "individual"
): Promise<void> {
  const mod = await loadDocx();
  const { saveAs } = await import("file-saver");
  const { Document, Packer, Paragraph, TextRun } = mod;
  const { h1, h2, p, labeledP, divider } = makeDocxHelpers(mod);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  children.push(h1(`${data.studentName} 개인 연구 포트폴리오`));
  children.push(p(data.entityName, false, "6b7280"));
  if (data.periodLabel) children.push(p(data.periodLabel, false, "6b7280"));
  children.push(divider());

  children.push(h2("참여 활동 요약"));
  children.push(p(RAW_COUNT_NOTE, false, "9ca3af", 16));
  children.push(labeledP("참여 연구일지", `${data.totalParticipatedLogs}건`));
  for (const code of ACTIVITY_ROLE_CODES) {
    const count = data.roleCounts[code] ?? 0;
    if (count > 0) children.push(p(`- ${ACTIVITY_ROLE_LABEL[code]}: ${count}회`));
  }
  children.push(divider());

  if (data.personalRecord) {
    const pr = data.personalRecord;
    const rows: { label: string; value: string | null }[] = [
      { label: "연구 동기", value: pr.motivation },
      { label: entityKind === "individual" ? "연구에서 나의 접근 방식" : "팀에서 나의 역할", value: pr.myRole },
      { label: "배운 점 / 느낀 점", value: pr.lessonsLearned },
      { label: "어려웠던 점과 해결 과정", value: pr.challenges },
    ];
    if (rows.some((r) => r.value)) {
      children.push(h2("나의 연구 기록"));
      for (const { label, value } of rows) {
        if (!value) continue;
        children.push(new Paragraph({ text: label, spacing: { before: 80, after: 20 } }));
        children.push(p(value));
      }
      children.push(divider());
    }
  }

  children.push(h2("참여 기록 (시간순)"));
  if (data.entries.length === 0) {
    children.push(p("아직 참여한 연구일지가 없습니다.", false, "9ca3af"));
  }
  for (const entry of data.entries) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${fmtDate(entry.date)}  ·  ${entry.logTitle || "(제목 없음)"}`, bold: true, color: "0ea5e9", size: 22 }),
        ],
        spacing: { before: 160, after: 40 },
      })
    );
    const roleText = entry.roles.length > 0 ? entry.roles.map((r) => ACTIVITY_ROLE_LABEL[r]).join(" / ") : "역할 미입력";
    children.push(p(`역할: ${roleText}`));
    if (entry.roleDescription) children.push(p(`구체적으로 한 일: ${entry.roleDescription}`, false, "374151"));
    if (entry.teamContentSnippet) children.push(p(`팀 기록 맥락: ${entry.teamContentSnippet}`, false, "9ca3af", 18));
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, exportFileName(entityKind, data.studentName, "개인연구포트폴리오", "docx"));
}
