"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import Papa from "papaparse";
import { Upload, Plus, Trash2, Download, Pencil, Search } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useRequireAdmin } from "@/lib/role-guards";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { RNE_SUBTYPES } from "@/lib/rne-types";
import type { Team } from "@/lib/database.types";

// ────────────────────────────────────────────────────────────────
// 상수 / 타입
// ────────────────────────────────────────────────────────────────
const SUBTYPE_LABEL: Record<string, string> = Object.fromEntries(
  RNE_SUBTYPES.map(({ value, label }) => [value, label])
);

const SUBTYPE_KEY: Record<string, string> = {
  "기초 R&E": "basic",
  "경기도 R&E": "gyeonggi",
  "과학 전람회": "science_fair",
  "창의재단 R&E": "creative_foundation",
};

const EXCEL_HEADERS = ["팀명", "유형", "학년도", "지도교사(username)", "학생1(username)", "학생2(username)", "학생3(username)", "학생4(username)", "학생5(username)", "학생6(username)", "학생7(username)", "학생8(username)", "학생9(username)", "학생10(username)", "학생11(username)", "학생12(username)", "학생13(username)", "학생14(username)", "학생15(username)", "학생16(username)", "학생17(username)", "학생18(username)", "학생19(username)", "학생20(username)", "연구분야"];

type FilterType = "all" | "basic" | "gyeonggi" | "science_fair" | "creative_foundation" | "club";

const FILTER_TABS: { value: FilterType; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "basic", label: "기초 R&E" },
  { value: "gyeonggi", label: "경기도 R&E" },
  { value: "science_fair", label: "과학 전람회" },
  { value: "creative_foundation", label: "창의재단 R&E" },
  { value: "club", label: "동아리" },
];

interface ParsedTeamRow {
  name: string;
  typeLabel: string;
  schoolYear: string;
  teacherUsername: string;
  studentUsernames: string[];
  field: string;
}

interface TeamWithTeacher extends Team {
  teacherName?: string;
  memberNames?: string[];
}

// ────────────────────────────────────────────────────────────────
// 엑셀 파싱
// ────────────────────────────────────────────────────────────────
function rowsToTeamRows(raw: Record<string, string>[]): ParsedTeamRow[] {
  return raw
    .map((row) => ({
      name: row["팀명"] ?? "",
      typeLabel: row["유형"] ?? "",
      schoolYear: row["학년도"] ?? "",
      teacherUsername: row["지도교사(username)"] ?? "",
      studentUsernames: [
        row["학생1(username)"] ?? "",
        row["학생2(username)"] ?? "",
        row["학생3(username)"] ?? "",
        row["학생4(username)"] ?? "",
        row["학생5(username)"] ?? "",
        row["학생6(username)"] ?? "",
        row["학생7(username)"] ?? "",
        row["학생8(username)"] ?? "",
        row["학생9(username)"] ?? "",
        row["학생10(username)"] ?? "",
        row["학생11(username)"] ?? "",
        row["학생12(username)"] ?? "",
        row["학생13(username)"] ?? "",
        row["학생14(username)"] ?? "",
        row["학생15(username)"] ?? "",
        row["학생16(username)"] ?? "",
        row["학생17(username)"] ?? "",
        row["학생18(username)"] ?? "",
        row["학생19(username)"] ?? "",
        row["학생20(username)"] ?? "",
      ].filter(Boolean),
      field: row["연구분야"] ?? "",
    }))
    .filter((r) => r.name);
}

function normalizeHeader(s: string): string {
  return s.replace(/[﻿​‌‍ ]/g, "").trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

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
    const cols = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y"];
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

async function parseFile(file: File): Promise<Record<string, string>[]> {
  const nameLower = file.name.toLowerCase();

  if (nameLower.endsWith(".csv")) {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        encoding: "UTF-8",
        complete: (result) =>
          resolve(
            result.data.map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([k, v]) => [normalizeHeader(k), String(v ?? "").trim()])
              )
            )
          ),
        error: reject,
      });
    });
  }

  const buffer = await file.arrayBuffer();
  const ext = nameLower.split(".").pop();
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
    raw2d = await parseXlsxViaJSZip(buffer);
  }

  if (raw2d.length < 2) return [];

  const knownSet = new Set(EXCEL_HEADERS);
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(raw2d.length, 5); i++) {
    const cells = raw2d[i].map((c) => normalizeHeader(c));
    const matchCount = cells.filter((c) => knownSet.has(c)).length;
    if (matchCount >= 2) { headerRowIdx = i; break; }
  }

  const headers = raw2d[headerRowIdx].map((h) => normalizeHeader(h));

  const rows: Record<string, string>[] = [];
  for (let i = headerRowIdx + 1; i < raw2d.length; i++) {
    const cells = raw2d[i];
    const rowData: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const text = normalizeHeader(cells[idx] ?? "");
      rowData[header] = text;
      if (text) hasValue = true;
    });
    if (hasValue) rows.push(rowData);
  }

  return rows;
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const data = [
    EXCEL_HEADERS,
    ["홍길동팀", "기초 R&E", "2025", "t홍길동", "22김민준", "22이수진", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "물리"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "팀목록");
  XLSX.writeFile(wb, "팀_등록_양식.xlsx");
}

// ────────────────────────────────────────────────────────────────
// 내부 컴포넌트 (useSearchParams 사용)
// ────────────────────────────────────────────────────────────────
function AdminTeamsContent() {
  const searchParams = useSearchParams();
  const { loading: authLoading, allowed } = useRequireAdmin("/dashboard");

  const initialType = (searchParams.get("type") ?? "all") as FilterType;
  const initialYear = searchParams.get("year") ?? "";

  // 팀 목록
  const [teams, setTeams] = useState<TeamWithTeacher[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 필터
  const [typeFilter, setTypeFilter] = useState<FilterType>(initialType);
  const [yearFilter, setYearFilter] = useState(initialYear);
  const [searchQuery, setSearchQuery] = useState("");

  // 선택 삭제
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // 엑셀 업로드
  const [parsedRows, setParsedRows] = useState<ParsedTeamRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<{ row: number; success: boolean; name?: string; error?: string }[] | null>(null);

  const loadTeams = async () => {
    setTeamsLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("teams")
      .select("*")
      .order("school_year", { ascending: false });
    if (!data) { setTeamsLoading(false); return; }

    const teacherIds = [...new Set(data.map((t: Team) => t.teacher_id).filter(Boolean))] as string[];
    const teamIds = data.map((t: Team) => t.id);

    const [{ data: teacherRows }, { data: memberRows }] = await Promise.all([
      teacherIds.length > 0
        ? supabase.from("users").select("id, name").in("id", teacherIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("team_members")
        .select("team_id, users(name)")
        .in("team_id", teamIds),
    ]);

    const teacherMap = Object.fromEntries((teacherRows ?? []).map((t: { id: string; name: string }) => [t.id, t.name]));

    const memberMap: Record<string, string[]> = {};
    for (const m of memberRows ?? []) {
      const row = m as unknown as { team_id: string; users: { name: string } | null };
      if (!memberMap[row.team_id]) memberMap[row.team_id] = [];
      if (row.users?.name) memberMap[row.team_id].push(row.users.name);
    }

    setTeams(data.map((t: Team) => ({
      ...t,
      teacherName: t.teacher_id ? teacherMap[t.teacher_id] : undefined,
      memberNames: memberMap[t.id] ?? [],
    })));
    setTeamsLoading(false);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    if (authLoading || !allowed) return;
    loadTeams();
  }, [authLoading, allowed]);

  // 타입 필터 변경 시 선택 초기화
  const handleTypeChange = (value: FilterType) => {
    setTypeFilter(value);
    setSelectedIds(new Set());
  };

  // 학년도 목록 (로드된 팀에서 추출)
  const availableYears = useMemo(() => {
    const years = [...new Set(teams.map((t) => t.school_year).filter(Boolean))] as string[];
    return years.sort().reverse();
  }, [teams]);

  // 필터링
  const filteredTeams = useMemo(() => {
    return teams.filter((t) => {
      if (typeFilter !== "all") {
        if (typeFilter === "club") {
          if (t.type !== "club") return false;
        } else {
          if (t.type !== "rne" || t.subtype !== typeFilter) return false;
        }
      }
      if (yearFilter && t.school_year !== yearFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = t.name.toLowerCase().includes(q);
        const matchTeacher = (t.teacherName ?? "").toLowerCase().includes(q);
        if (!matchName && !matchTeacher) return false;
      }
      return true;
    });
  }, [teams, typeFilter, yearFilter, searchQuery]);

  // 전체 선택 상태
  const allSelected = filteredTeams.length > 0 && filteredTeams.every((t) => selectedIds.has(t.id));
  const someSelected = filteredTeams.some((t) => selectedIds.has(t.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredTeams.forEach((t) => next.delete(t.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredTeams.forEach((t) => next.add(t.id));
        return next;
      });
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (team: TeamWithTeacher) => {
    if (!window.confirm(`"${team.name}" 팀을 삭제할까요?\n활동 기록도 함께 삭제됩니다.`)) return;
    setDeletingId(team.id);
    setDeleteError(null);

    const response = await fetch("/api/admin/delete-team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: team.id }),
    });
    const result = await response.json();
    setDeletingId(null);

    if (!response.ok) {
      setDeleteError(result.error ?? "삭제에 실패했습니다.");
      return;
    }
    loadTeams();
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!window.confirm(`선택한 ${count}개 팀을 삭제하시겠습니까?\n활동 기록도 함께 삭제됩니다.`)) return;

    setBulkDeleting(true);
    setDeleteError(null);

    const response = await fetch("/api/admin/delete-teams-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamIds: [...selectedIds] }),
    });
    const result = await response.json();
    setBulkDeleting(false);

    if (!response.ok) {
      setDeleteError(result.error ?? "삭제에 실패했습니다.");
      return;
    }
    loadTeams();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setParsedRows([]);
    setUploadResults(null);

    if (file.name.toLowerCase().endsWith(".xls")) {
      setParseError("xlsx 또는 csv 형식으로 저장 후 업로드해주세요.");
      return;
    }
    try {
      const raw = await parseFile(file);
      const rows = rowsToTeamRows(raw);
      if (rows.length === 0) {
        setParseError("데이터 행이 없습니다. 첫 행에 헤더, 2행부터 데이터를 입력해주세요.");
        return;
      }
      setParsedRows(rows);
    } catch {
      setParseError("파일을 읽을 수 없습니다. xlsx 또는 csv 형식인지 확인해주세요.");
    }
  };

  const handleUpload = async () => {
    if (parsedRows.length === 0) return;
    setUploading(true);
    setUploadResults(null);

    const uploadTeams = parsedRows.map((row) => ({
      name: row.name,
      type: "rne" as const,
      subtype: SUBTYPE_KEY[row.typeLabel] ?? row.typeLabel,
      schoolYear: row.schoolYear,
      teacherUsername: row.teacherUsername || undefined,
      studentUsernames: row.studentUsernames,
      field: row.field || undefined,
    }));

    const response = await fetch("/api/admin/create-teams-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teams: uploadTeams }),
    });
    const result = await response.json();
    setUploading(false);

    if (!response.ok) {
      setParseError(result.error ?? "등록에 실패했습니다.");
      return;
    }

    setUploadResults(result.results ?? []);
    setParsedRows([]);
    loadTeams();
  };

  if (authLoading || !allowed) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  const newTeamHref = typeFilter === "club" ? "/club/new" : "/rne/new";
  const newTeamLabel = typeFilter === "club" ? "동아리 팀 추가" : "R&E 팀 추가";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">팀 관리</h1>
        <p className="mt-1 text-sm text-slate-500">R&E 및 동아리 팀을 등록하고 관리하세요.</p>
      </div>

      {/* ── 엑셀 일괄 등록 ── */}
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">엑셀 일괄 팀 등록</h2>
          <button
            type="button"
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            템플릿 다운로드
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          필수 열: {EXCEL_HEADERS.join(" | ")}
        </p>
        <p className="text-xs text-slate-400">유형: 기초 R&E / 경기도 R&E / 과학 전람회 / 창의재단 R&E · xlsx, csv 지원</p>

        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="mt-3 block w-full text-sm text-slate-600"
        />

        {parseError && <p className="mt-2 text-sm text-red-600">{parseError}</p>}

        {parsedRows.length > 0 && (
          <div className="mt-3 space-y-3">
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {["팀명", "유형", "학년도", "지도교사", "학생 목록", "연구분야"].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsedRows.map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-slate-800">{row.name}</td>
                      <td className="px-3 py-2 text-slate-600">{SUBTYPE_LABEL[SUBTYPE_KEY[row.typeLabel]] ?? row.typeLabel}</td>
                      <td className="px-3 py-2 text-slate-600">{row.schoolYear}</td>
                      <td className="px-3 py-2 text-slate-600">{row.teacherUsername || "-"}</td>
                      <td className="px-3 py-2 text-slate-600">{row.studentUsernames.join(", ") || "-"}</td>
                      <td className="px-3 py-2 text-slate-600">{row.field || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {uploading ? "등록 중..." : `${parsedRows.length}개 팀 전체 등록하기`}
            </button>
          </div>
        )}

        {uploadResults && (
          <ul className="mt-3 space-y-1 text-sm">
            {uploadResults.map((r) => (
              <li key={r.row} className={r.success ? "text-emerald-700" : "text-red-600"}>
                {r.row}행: {r.success ? `✅ ${r.name} 등록 완료` : `❌ ${r.error}`}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── 팀 목록 ── */}
      <Card>
        {/* 유형 탭 */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-0">
          <div className="flex overflow-x-auto">
            {FILTER_TABS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleTypeChange(value)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  typeFilter === value
                    ? "border-sky-500 text-sky-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Link
            href={newTeamHref}
            className="ml-4 flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600"
          >
            <Plus className="h-4 w-4" />
            {newTeamLabel}
          </Link>
        </div>

        {/* 필터/검색 바 */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={yearFilter}
            onChange={(e) => { setYearFilter(e.target.value); setSelectedIds(new Set()); }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
          >
            <option value="">전체 학년도</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}학년도</option>
            ))}
          </select>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSelectedIds(new Set()); }}
              placeholder="팀명 또는 교사명 검색..."
              className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <span className="text-sm text-slate-400">
            {filteredTeams.length}팀
            {filteredTeams.length !== teams.length && ` / 전체 ${teams.length}팀`}
          </span>

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {bulkDeleting ? "삭제 중..." : `선택 삭제 (${selectedIds.size})`}
            </button>
          )}
        </div>

        {deleteError && <p className="mt-3 text-sm text-red-600">{deleteError}</p>}

        {teamsLoading ? (
          <p className="mt-4 text-sm text-slate-400">불러오는 중...</p>
        ) : filteredTeams.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">해당하는 팀이 없습니다.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                    />
                  </th>
                  <th className="px-4 py-3">팀명</th>
                  <th className="px-4 py-3">유형</th>
                  <th className="px-4 py-3">학년도</th>
                  <th className="px-4 py-3">지도교사</th>
                  <th className="px-4 py-3">팀원</th>
                  <th className="px-4 py-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTeams.map((team) => (
                  <tr
                    key={team.id}
                    className={cn("hover:bg-slate-50", selectedIds.has(team.id) && "bg-sky-50")}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(team.id)}
                        onChange={() => toggleOne(team.id)}
                        className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/${team.type === "rne" ? "rne" : "club"}/${team.id}`}
                        className="font-medium text-sky-600 hover:underline"
                      >
                        {team.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {team.type === "rne"
                        ? (team.subtype ? (SUBTYPE_LABEL[team.subtype] ?? team.subtype) : "-")
                        : "동아리"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {team.school_year ? `${team.school_year}학년도` : "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{team.teacherName ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {team.memberNames && team.memberNames.length > 0
                        ? team.memberNames.join(", ")
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/${team.type === "rne" ? "rne" : "club"}/${team.id}/edit`}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(team)}
                          disabled={deletingId === team.id}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 페이지 (Suspense 래퍼)
// ────────────────────────────────────────────────────────────────
export default function AdminTeamsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">불러오는 중...</p>}>
      <AdminTeamsContent />
    </Suspense>
  );
}
