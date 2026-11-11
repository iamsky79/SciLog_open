"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import type { PersonalRecord } from "@/lib/database.types";

type EntityType = "rne" | "club" | "individual";
type FieldKey = "motivation" | "my_role" | "lessons_learned" | "challenges";

interface PersonalRecordSectionProps {
  entityType: EntityType;
  entityId: string;
  studentId: string;
  /** 제공 시 필드 위에 이름 표시 (교사/관리자가 팀원별로 나열할 때) */
  studentName?: string;
  readOnly: boolean;
}

function fieldDefs(entityType: EntityType): { key: FieldKey; label: string; placeholder: string }[] {
  return [
    { key: "motivation", label: "연구 동기", placeholder: "연구를 시작하게 된 동기를 작성하세요." },
    {
      key: "my_role",
      label: entityType === "individual" ? "나의 연구 접근 방식" : "팀에서 나의 역할",
      placeholder: entityType === "individual" ? "연구를 진행한 나만의 접근 방식을 작성하세요." : "팀 안에서 맡았던 역할을 작성하세요.",
    },
    { key: "lessons_learned", label: "배운 점 / 느낀 점", placeholder: "연구를 통해 배우거나 느낀 점을 작성하세요." },
    { key: "challenges", label: "어려웠던 점과 해결 과정", placeholder: "어려웠던 점과 그것을 어떻게 해결했는지 작성하세요." },
  ];
}

export function PersonalRecordSection({ entityType, entityId, studentId, studentName, readOnly }: PersonalRecordSectionProps) {
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    motivation: "", my_role: "", lessons_learned: "", challenges: "",
  });
  const [savingKey, setSavingKey] = useState<FieldKey | null>(null);
  const [savedKey, setSavedKey] = useState<FieldKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("personal_records")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .eq("student_id", studentId)
        .maybeSingle();
      if (cancelled) return;
      const row = (data as PersonalRecord) ?? null;
      setValues({
        motivation: row?.motivation ?? "",
        my_role: row?.my_role ?? "",
        lessons_learned: row?.lessons_learned ?? "",
        challenges: row?.challenges ?? "",
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entityType, entityId, studentId]);

  const handleSave = async (key: FieldKey) => {
    setSavingKey(key);
    setSavedKey(null);
    const supabase = createClient();
    const { error } = await supabase.from("personal_records").upsert(
      {
        entity_type: entityType,
        entity_id: entityId,
        student_id: studentId,
        [key]: values[key] || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity_type,entity_id,student_id" }
    );
    setSavingKey(null);
    if (error) {
      console.error("나의 연구 기록 저장 실패:", error);
      alert(`저장 실패: ${error.message}`);
      return;
    }
    setSavedKey(key);
    setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
  };

  if (loading) return <Card className="text-sm text-slate-400">불러오는 중...</Card>;

  return (
    <Card className="space-y-4">
      {studentName && <p className="text-sm font-semibold text-slate-800">{studentName}</p>}
      {fieldDefs(entityType).map(({ key, label, placeholder }) => (
        <div key={key}>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
          <textarea
            rows={3}
            value={values[key]}
            onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            disabled={readOnly}
            placeholder={placeholder}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
          />
          {!readOnly && (
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSave(key)}
                disabled={savingKey === key}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {savingKey === key ? "저장 중..." : "저장"}
              </button>
              {savedKey === key && <span className="text-xs text-green-600">저장됨</span>}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
