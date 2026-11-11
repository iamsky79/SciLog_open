"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getStudentPortfolio, type StudentPortfolio } from "@/lib/portfolio/detail";
import { StudentPortfolioView } from "@/components/portfolio/StudentPortfolioView";
import { PortfolioExportDialog } from "@/components/portfolio/PortfolioExportDialog";

// 학생 본인 전용 "내 포트폴리오" — 교사가 학생을 조회하는 /student/[id]와 완전히
// 같은 data builder(getStudentPortfolio)와 뷰(StudentPortfolioView)를 쓴다.
// 학생은 여기서 자기 자신 것만 보고, 전체 학생 목록으로 이동할 수 없다.

export default function MyPortfolioPage() {
  const { userId, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<StudentPortfolio | null>(null);
  const [academicYear, setAcademicYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    if (authLoading || !profile) return;
    if (profile.role !== "student") {
      router.replace("/dashboard");
    }
  }, [authLoading, profile, router]);

  useEffect(() => {
    if (authLoading || !userId || profile?.role !== "student") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getStudentPortfolio(userId, academicYear).then((data) => {
      if (!cancelled) {
        setPortfolio(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, profile, academicYear]);

  if (authLoading || loading) return <p className="text-sm text-slate-400">불러오는 중...</p>;
  if (profile?.role !== "student") return null;
  if (!portfolio) return <p className="text-sm text-slate-400">포트폴리오를 불러올 수 없습니다.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">내 포트폴리오</h1>
        <button
          type="button"
          onClick={() => setShowExport(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" />
          포트폴리오 내보내기
        </button>
      </div>
      <StudentPortfolioView portfolio={portfolio} academicYear={academicYear} onAcademicYearChange={setAcademicYear} />
      {showExport && userId && (
        <PortfolioExportDialog
          studentId={userId}
          initialAcademicYear={academicYear}
          yearOptions={portfolio.yearOptions}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
