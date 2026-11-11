"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import Papa from "papaparse";
import { Upload } from "lucide-react";

interface RowResult {
  row: number;
  success: boolean;
  username?: string;
  initialPassword?: string;
  error?: string;
  notice?: string;
}

interface BulkUserUploadProps {
  role: "student" | "teacher";
  expectedHeaders: string[];
  onUploaded: () => void;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// 한컴셀(HCell) xlsx 직접 파싱: x: 네임스페이스 prefix 제거 후 XML 파싱
async function parseXlsxViaJSZip(buffer: ArrayBuffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);

  const ssFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (ssFile) {
    const ssXml = (await ssFile.async("text")).replace(/<x:/g, "<").replace(/<\/x:/g, "</");
    for (const m of ssXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)) {
      sharedStrings.push(decodeXmlEntities(m[1]));
    }
  }

  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetFile) return [];
  const sheetXml = (await sheetFile.async("text")).replace(/<x:/g, "<").replace(/<\/x:/g, "</");

  const result: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cols = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
    const cellMap: Record<string, string> = {};
    for (const c of rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = c[1];
      const attrs = c[2];
      const inner = c[3];
      const vMatch = inner.match(/<v>([^<]*)<\/v>/);
      const tMatch = inner.match(/<t[^>]*>([^<]*)<\/t>/);
      if (attrs.includes('t="s"') && vMatch) {
        cellMap[col] = sharedStrings[parseInt(vMatch[1])] ?? "";
      } else if (tMatch) {
        cellMap[col] = decodeXmlEntities(tMatch[1]);
      } else if (vMatch) {
        cellMap[col] = vMatch[1];
      }
    }
    result.push(cols.map((col) => cellMap[col] ?? ""));
  }
  return result;
}

async function parseExcelRows(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const ext = file.name.split(".").pop()?.toLowerCase();
  const isXlsx = ext === "xlsx" || ext === "xlsm";

  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    ...(isXlsx ? {} : { codepage: 949 }),
    cellDates: true,
    raw: false,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  let raw2d: string[][];
  if (sheet) {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    raw2d = raw.map((r) => (r as unknown[]).map((c) => String(c ?? "").trim()));
  } else {
    // 한컴셀 fallback: JSZip으로 직접 XML 파싱
    raw2d = await parseXlsxViaJSZip(buffer);
  }

  if (raw2d.length < 2) return [];

  const headers = raw2d[0].map((h) => h.replace(/[﻿​‌‍ ]/g, "").trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < raw2d.length; i++) {
    const cells = raw2d[i];
    const rowData: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const text = (cells[idx] ?? "").replace(/[﻿​‌‍ ]/g, "").trim();
      rowData[header] = text;
      if (text) hasValue = true;
    });
    if (hasValue) rows.push(rowData);
  }

  return rows;
}

function parseCsvRows(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      complete: (result) => {
        const rows = result.data.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [k.trim(), String(v ?? "").trim()])
          )
        );
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

export function BulkUserUpload({ role, expectedHeaders, onUploaded }: BulkUserUploadProps) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);
  // 결과 다운로드에 이름 등 원래 입력값을 함께 담기 위해, 업로드한 행을 따로 보관한다.
  const [uploadedRows, setUploadedRows] = useState<Record<string, string>[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setResults(null);
    setRows([]);

    const name = file.name.toLowerCase();

    if (name.endsWith(".xls")) {
      setParseError("xlsx 형식으로 저장 후 업로드해주세요. (파일 → 다른 이름으로 저장 → .xlsx 선택)");
      return;
    }

    try {
      const parsed = name.endsWith(".csv")
        ? await parseCsvRows(file)
        : await parseExcelRows(file);

      if (parsed.length === 0) {
        setParseError("데이터 행이 없습니다. 첫 행에 헤더, 2행부터 데이터를 입력해주세요.");
        return;
      }
      setRows(parsed);
    } catch {
      setParseError("파일을 읽을 수 없습니다. xlsx 또는 csv 형식인지 확인해주세요.");
      setRows([]);
    }
  };

  const buildBody = () => {
    if (role === "student") {
      return rows.map((row) => ({
        cohort: Number(row["기수"]),
        name: row["이름"],
        grade: Number(row["학년"]),
        class: Number(row["반"]),
        number: Number(row["번호"]),
      }));
    }
    return rows.map((row) => ({
      name: row["이름"],
      subject: row["과목"],
    }));
  };

  const handleUpload = async () => {
    if (rows.length === 0) return;
    setUploading(true);
    setResults(null);

    const response = await fetch("/api/admin/create-users-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, rows: buildBody() }),
    });
    const result = await response.json();

    setUploading(false);

    if (!response.ok) {
      setParseError(result.error ?? "일괄 등록에 실패했습니다.");
      return;
    }

    setResults(result.results ?? []);
    setUploadedRows(rows);
    setRows([]);
    onUploaded();
  };

  // 초기 비밀번호는 무작위라 다시 조회할 수 없으므로, 생성 직후 결과를 엑셀로 받아 배부한다.
  const downloadResults = () => {
    if (!results) return;
    const data = results.map((result) => {
      const source = uploadedRows[result.row - 1] ?? {};
      return {
        행: result.row,
        ...Object.fromEntries(expectedHeaders.map((header) => [header, source[header] ?? ""])),
        아이디: result.username ?? "",
        "초기 비밀번호": result.initialPassword ?? "",
        결과: result.success ? (result.notice ?? "생성됨") : (result.error ?? "실패"),
      };
    });
    const sheet = XLSX.utils.json_to_sheet(data);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "계정");
    const label = role === "student" ? "학생" : "교사";
    XLSX.writeFile(book, `${label}_계정_초기비밀번호.xlsx`);
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-slate-300 p-4">
      <p className="text-sm font-medium text-slate-700">엑셀로 일괄 등록</p>
      <p className="text-xs text-slate-400">필수 열(첫 행 헤더): {expectedHeaders.join(", ")}</p>
      <p className="text-xs text-slate-400">xlsx, csv 형식 지원 (한컴오피스 포함)</p>

      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFile}
        className="block w-full text-sm text-slate-600"
      />

      {parseError && <p className="text-sm text-red-600">{parseError}</p>}

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">{rows.length}건 인식됨</p>
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "등록 중..." : `${rows.length}건 일괄 생성`}
          </button>
        </div>
      )}

      {results && (
        <div className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <p>초기 비밀번호는 무작위로 만들어져 이 화면을 벗어나면 다시 볼 수 없어요. 지금 엑셀로 받아 두세요.</p>
          <p>받은 파일에는 비밀번호가 들어 있으니 배부가 끝나면 삭제해 주세요.</p>
          <button
            type="button"
            onClick={downloadResults}
            className="mt-1 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-600"
          >
            결과 엑셀 다운로드
          </button>
        </div>
      )}

      {results && (
        <ul className="space-y-1 text-sm">
          {results.map((result) => (
            <li key={result.row} className={result.success ? "text-emerald-700" : "text-red-600"}>
              {result.row}행:{" "}
              {result.success
                ? `${result.username}${result.notice ? ` (${result.notice})` : ""} / ${result.initialPassword}`
                : result.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
