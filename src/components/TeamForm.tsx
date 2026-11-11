"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { RNE_SUBTYPES, type RneSubtype } from "@/lib/rne-types";
import { CLUB_SUBTYPES } from "@/lib/club-types";
import type { TeamType } from "@/lib/database.types";

// ────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────
interface TeacherOption {
  id: string;
  name: string;
  subject: string | null;
  username: string | null;
}

interface StudentOption {
  id: string;
  name: string;
  grade: number | null;
  class: string | null;
  username: string | null;
}

export interface InitialTeamData {
  id: string;
  name: string;
  subtype: string | null;
  schoolYear: string | null;
  semester: string | null;
  field: string | null;
  description: string | null;
  teacher: (TeacherOption) | null;
  members: StudentOption[];
}

interface TeamFormProps {
  teamType: TeamType;
  initialData?: InitialTeamData;
}

// ────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────
const MAX_MEMBERS: Record<TeamType, number> = { rne: 5, club: 20 };
const SCHOOL_YEARS = ["2023", "2024", "2025", "2026", "2027"];
const currentYear = String(new Date().getFullYear());
const DEFAULT_YEAR = SCHOOL_YEARS.includes(currentYear) ? currentYear : "2025";
const TERM_OPTIONS = [
  { value: "1", label: "1학기" },
  { value: "2", label: "2학기" },
];

function teacherLabel(t: TeacherOption) {
  return `${t.username ?? t.name}${t.subject ? ` (${t.subject})` : ""}`;
}

function studentLabel(s: StudentOption) {
  const grade = s.grade != null ? `${s.grade}학년 ${s.class ?? "-"}반` : "";
  return `${s.username ?? s.name}${grade ? ` (${grade})` : ""}`;
}

// ────────────────────────────────────────────────────────────────
// 검색 드롭다운 컴포넌트
// ────────────────────────────────────────────────────────────────
function SearchDropdown<T extends { id: string }>({
  allItems,
  query,
  onQueryChange,
  onSelect,
  renderItem,
  placeholder,
  open,
  onOpenChange,
  containerRef,
}: {
  allItems: T[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
  placeholder: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const filtered = query.trim()
    ? allItems.filter((item) =>
        JSON.stringify(item).toLowerCase().includes(query.toLowerCase())
      )
    : allItems;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500">
        <input
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); onOpenChange(true); }}
          onFocus={() => onOpenChange(true)}
          placeholder={placeholder}
          className="flex-1 rounded-lg bg-transparent px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
        <ChevronDown className="mr-2 h-4 w-4 shrink-0 text-slate-400" />
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onMouseDown={() => onSelect(item)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                {renderItem(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// TeamForm
// ────────────────────────────────────────────────────────────────
export function TeamForm({ teamType, initialData }: TeamFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;

  const [name, setName] = useState(initialData?.name ?? "");
  const [subtype, setSubtype] = useState<string>(
    initialData?.subtype ??
      (teamType === "rne" ? RNE_SUBTYPES[0].value : CLUB_SUBTYPES[0].value)
  );
  const [field, setField] = useState(initialData?.field ?? "");
  const [schoolYear, setSchoolYear] = useState(initialData?.schoolYear ?? DEFAULT_YEAR);
  const [semester, setSemester] = useState(initialData?.semester ?? "1");
  const [description, setDescription] = useState(initialData?.description ?? "");

  const [allTeachers, setAllTeachers] = useState<TeacherOption[]>([]);
  const [allStudents, setAllStudents] = useState<StudentOption[]>([]);

  const [teacherQuery, setTeacherQuery] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherOption | null>(
    initialData?.teacher ?? null
  );
  const [teacherOpen, setTeacherOpen] = useState(false);
  const teacherRef = useRef<HTMLDivElement | null>(null);

  const [studentQuery, setStudentQuery] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<StudentOption[]>(
    initialData?.members ?? []
  );
  const [studentOpen, setStudentOpen] = useState(false);
  const studentRef = useRef<HTMLDivElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 전체 목록 한 번만 로드
  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase
        .from("users")
        .select("id, name, subject, username")
        .eq("role", "teacher")
        .order("name"),
      supabase
        .from("users")
        .select("id, name, grade, class, username")
        .eq("role", "student")
        .order("name"),
    ]).then(([{ data: teacherRows }, { data: studentRows }]) => {
      setAllTeachers((teacherRows as TeacherOption[]) ?? []);
      setAllStudents((studentRows as StudentOption[]) ?? []);
    });
  }, []);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (teacherRef.current && !teacherRef.current.contains(e.target as Node))
        setTeacherOpen(false);
      if (studentRef.current && !studentRef.current.contains(e.target as Node))
        setStudentOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const maxMembers = MAX_MEMBERS[teamType];

  const addStudent = (student: StudentOption) => {
    if (selectedStudents.find((s) => s.id === student.id)) return;
    if (selectedStudents.length >= maxMembers) return;
    setSelectedStudents((prev) => [...prev, student]);
    setStudentQuery("");
    setStudentOpen(false);
  };

  const removeStudent = (id: string) => {
    setSelectedStudents((prev) => prev.filter((s) => s.id !== id));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    const supabase = createClient();

    if (isEdit && initialData) {
      // ── 수정 모드 ──
      const { error: updateError } = await supabase
        .from("teams")
        .update({
          name,
          subtype: subtype,
          teacher_id: selectedTeacher?.id ?? null,
          field: field || null,
          school_year: schoolYear,
          semester,
          description: description || null,
        })
        .eq("id", initialData.id);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      // 팀원 전체 교체: 기존 삭제 → 재삽입
      await supabase.from("team_members").delete().eq("team_id", initialData.id);

      if (selectedStudents.length > 0) {
        await supabase.from("team_members").insert(
          selectedStudents.map((student) => ({
            team_id: initialData.id,
            student_id: student.id,
            is_leader: false,
          }))
        );
      }

      router.push(`/${teamType === "rne" ? "rne" : "club"}/${initialData.id}`);
    } else {
      // ── 생성 모드 ──
      const { data: team, error: teamError } = await supabase
        .from("teams")
        .insert({
          type: teamType,
          subtype: subtype,
          teacher_id: selectedTeacher?.id ?? null,
          name,
          field: field || null,
          school_year: schoolYear,
          semester,
          description: description || null,
        })
        .select()
        .single();

      if (teamError || !team) {
        setError(teamError?.message ?? "팀 생성에 실패했습니다.");
        setSaving(false);
        return;
      }

      if (selectedStudents.length > 0) {
        await supabase.from("team_members").insert(
          selectedStudents.map((student) => ({
            team_id: team.id,
            student_id: student.id,
            is_leader: false,
          }))
        );
      }

      router.push(`/${teamType === "rne" ? "rne" : "club"}/${team.id}`);
    }

    setSaving(false);
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <Card className="space-y-4">
        {/* 팀명 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            {teamType === "rne" ? "팀명" : "동아리명"}
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        {/* R&E 유형 */}
        {teamType === "rne" && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">R&E 유형</label>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {RNE_SUBTYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* 동아리 유형 */}
        {teamType === "club" && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">동아리 유형</label>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {CLUB_SUBTYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* 학년도 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">학년도</label>
          <select
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {SCHOOL_YEARS.map((y) => (
              <option key={y} value={y}>{y}학년도</option>
            ))}
          </select>
        </div>

        {/* 학기 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">학기</label>
          <select
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {TERM_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* 연구 분야 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">연구 분야</label>
          <input
            value={field}
            onChange={(e) => setField(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        {/* 연구 개요 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">연구 개요</label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        {/* 지도교사 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">지도교사</label>
          {selectedTeacher ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-sm font-medium text-sky-800">
              {teacherLabel(selectedTeacher)}
              <button
                type="button"
                onClick={() => setSelectedTeacher(null)}
                className="text-sky-500 hover:text-sky-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <SearchDropdown
              allItems={allTeachers}
              query={teacherQuery}
              onQueryChange={setTeacherQuery}
              onSelect={(t) => { setSelectedTeacher(t); setTeacherQuery(""); setTeacherOpen(false); }}
              renderItem={(t) => (
                <span className="text-slate-900">{teacherLabel(t)}</span>
              )}
              placeholder="교사 검색 또는 클릭으로 전체 보기..."
              open={teacherOpen}
              onOpenChange={setTeacherOpen}
              containerRef={teacherRef}
            />
          )}
        </div>
      </Card>

      {/* 팀원 선택 */}
      <Card>
        <h2 className="text-base font-semibold text-slate-900">
          팀원 선택 ({selectedStudents.length}/{maxMembers})
        </h2>

        {selectedStudents.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedStudents.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-sm font-medium text-sky-800"
              >
                {s.username ?? s.name}
                <button
                  type="button"
                  onClick={() => removeStudent(s.id)}
                  className="text-sky-500 hover:text-sky-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {selectedStudents.length < maxMembers && (
          <div className="mt-3">
            <SearchDropdown
              allItems={allStudents.filter((s) => !selectedStudents.find((sel) => sel.id === s.id))}
              query={studentQuery}
              onQueryChange={setStudentQuery}
              onSelect={addStudent}
              renderItem={(s) => (
                <span className="text-slate-900">{studentLabel(s)}</span>
              )}
              placeholder="학생 검색 또는 클릭으로 전체 보기..."
              open={studentOpen}
              onOpenChange={setStudentOpen}
              containerRef={studentRef}
            />
          </div>
        )}
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "저장 중..." : isEdit ? "수정하기" : "저장하기"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          취소
        </button>
      </div>
    </form>
  );
}
