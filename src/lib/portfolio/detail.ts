import { createClient } from "@/lib/supabase";
import { teamPeriodLabel } from "@/lib/period";
import { deriveReviewPhase } from "@/lib/review/actions";
import { fileNameFromUrl, submittedFileBaseName, extOf, isPdfUrl } from "@/lib/export/common";
import { admissionYearFromUsername } from "@/lib/grade";
import { isHistoricalImport } from "@/lib/provenance";
import type { Profile, AwardRecord, PlanStatus, Semester, ActivityRoleCode, OtherActivitySubtype } from "@/lib/database.types";
import { ACTIVITY_ROLE_LABEL, ACTIVITY_ROLE_CODES } from "@/lib/database.types";
import { OTHER_ACTIVITY_SEMESTER_LABEL, otherActivitySemesterSortPriority } from "@/lib/other-activity";

// 학생/교사 공통 "개별 학생 포트폴리오" data builder. 학생 본인 화면(/portfolio)과
// 교사 화면(/student/[id])이 이 함수 하나를 그대로 같이 쓴다 — 별도의
// StudentPortfolio/TeacherStudentPortfolio를 따로 만들지 않는다.
//
// 기존 student/[id]/page.tsx에 있던 데이터 로딩 로직(팀/개인연구/기타활동/계획서/
// 결과보고서/연구노트/수상)을 그대로 가져와 재사용하고, 여기에 연구일지 역할 집계
// (activity_log_participants), 교사 피드백/재검토 상태(deriveReviewPhase 재사용),
// 학년도 필터를 추가했다.

export type PortfolioTypeKey = "rne" | "club" | "individual" | "other";

export interface AttachmentRef {
  name: string;
  url: string;
}

export interface PortfolioPlan {
  title: string | null;
  status: PlanStatus;
  /** 출처(provenance) — "historical_import"이면 과거 복원 자료. status와 별개. */
  provenance?: string | null;
  submittedAt: string | null;
  feedback: string | null;
  attachments: AttachmentRef[];
  /** "실제 학생이 업로드한 계획서 원본 PDF" 하나 — 팀(R&E/동아리) 계획서는 텍스트
   * 전용이고 research_plans.file_url 컬럼 자체가 production DB에 없어(마이그레이션
   * 파일에는 있으나 미적용, 42703로 실측 확인) 항상 null이다. 창의개인연구만
   * plan_file_urls 중 PDF인 첫 파일을 넣는다(attachments[0]과 같은 항목). */
  submittedFile: AttachmentRef | null;
  /** research_plans.motivation / individual_research.plan_motivation 전체 원문. */
  motivation: string | null;
  /** research_plans.method / individual_research.plan_method 전체 원문. */
  method: string | null;
  /** research_plans.expected_result / individual_research.plan_expected 전체 원문. */
  expectedResult: string | null;
}

export interface PortfolioReport {
  title: string | null;
  status: PlanStatus;
  /** 출처(provenance) — "historical_import"이면 과거 복원 자료. status와 별개. */
  provenance?: string | null;
  submittedAt: string | null;
  feedback: string | null;
  attachments: AttachmentRef[];
  /** "실제 학생이 제출한 결과보고서 원본 PDF" — research_reports.file_url(PDF-only 제출). attachments[0]과 같은 항목. */
  submittedFile: AttachmentRef | null;
  /** research_reports.introduction 전체 원문 — 새 작성 UI부터 사용. */
  introduction: string | null;
  /** research_reports.conclusion 전체 원문 — 새 작성 UI부터 사용. */
  conclusion: string | null;
  /** research_reports.summary 전체 원문 — legacy 필드(introduction/conclusion 도입 이전 데이터). */
  summary: string | null;
}

export interface PortfolioLog {
  id: string;
  logDate: string | null;
  /** 같은 프로젝트 안에서 날짜 없는 일지의 연구 흐름 순서(045 migration) — 있으면 날짜보다 우선한다. */
  displayOrder: number | null;
  createdAt: string | null;
  status: string;
  title: string | null;
  /** 연구 과정이 실제로 드러나도록 — 단순 개수 집계가 아니라 그날의 목표/활동/결과/소감을 그대로 가져온다. */
  goal: string | null;
  activityContent: string | null;
  result: string | null;
  achievement: string | null;
  /** activity_logs.interpretation — "해석 및 판단". */
  interpretation: string | null;
  /** activity_logs.conclusion — export 표기는 "문제점 / 특이사항"(기존 연구일지 export 라벨 관례를 그대로 따름). */
  conclusion: string | null;
  /** activity_logs.next_plan — "다음 활동과 그 이유". */
  nextPlan: string | null;
  teacherFeedback: string | null;
  attachments: AttachmentRef[];
  myRoles: ActivityRoleCode[];
}

export interface PortfolioPersonalRecord {
  motivation: string | null;
  myRole: string | null;
  lessonsLearned: string | null;
  challenges: string | null;
}

/** 기타 활동(typeKey==="other") 전용 부가 정보 — 연구 프로젝트(plan/report/logs)와
 * 구조가 완전히 달라 별도 필드로 분리한다. typeKey!=="other"면 항상 null. */
export interface PortfolioOtherActivity {
  subtype: OtherActivitySubtype;
  organizer: string | null;
  content: string | null;
  result: string | null;
}

export interface PortfolioActivity {
  key: string;
  typeKey: PortfolioTypeKey;
  name: string;
  teacherId: string | null;
  teacherName: string;
  schoolYear: string | null;
  periodLabel: string;
  /** 과거 활동을 사후에 기록한 historical import 프로젝트인지 — plan/report status가 "historical"이면 true. 이 경우 연결된 교사는 "지도교사"가 아니라 "관리교사"로 표시한다. */
  isHistorical: boolean;
  periodSort: number;
  plan: PortfolioPlan | null;
  report: PortfolioReport | null;
  logs: PortfolioLog[];
  /** 팀(R&E/동아리) 전체 팀원 이름 — 창의개인연구는 [학생 본인 이름], 기타활동은 []. */
  members: string[];
  /** 학생이 PersonalRecordSection에서 직접 작성한 "나의 기록" — 없으면 null(억지로 만들지 않음). */
  personalRecord: PortfolioPersonalRecord | null;
  /** 기타활동 전용(계획서/보고서/연구일지 구조가 없는 단발성 활동). */
  otherActivityDate: string | null;
  /** 기타활동 전용 학기 라벨("1학기"/"2학기") — 학기 구분이 없으면 null. 연구 프로젝트의
   * periodLabel(항상 "N학년도 (M학기)" 형태)과 달리 기타활동은 학기 없이도 흔해서
   * 포트폴리오/export의 "학년도→학기" 그룹핑을 periodLabel 문자열 파싱 없이 하기 위함. */
  otherSemesterLabel: string | null;
  /** 기타활동 전용(typeKey==="other"일 때만 값이 있음). */
  otherActivity: PortfolioOtherActivity | null;
}

export interface StudentPortfolio {
  student: Profile;
  academicYear: string | null;
  /** 이 학생의 활동에 실제로 존재하는 academic_year 전체 — 학년도 드롭다운용. */
  yearOptions: string[];
  activities: PortfolioActivity[];
  awards: AwardRecord[];
  /** 연구일지에 기록된 학생 역할 횟수 — 능력 점수가 아니라 활동 사실이다. */
  roleCounts: Partial<Record<ActivityRoleCode, number>>;
  summary: {
    projectCount: number;
    planApproved: number;
    planTotal: number;
    reportApproved: number;
    reportTotal: number;
    noteCount: number;
    approvedSubmissionCount: number;
    awardCount: number;
  };
  /** 교사 전용 관리 context에 쓰라고 미리 계산해 둔 값 — 학생 화면에는 그대로 노출하지 않는다. */
  management: {
    recentActivityAt: string | null;
    revisionNeededCount: number;
    pendingReviewCount: number;
  };
}

const TERM_LABEL: Record<Semester, string> = {
  "1-2": "1학년 2학기",
  "2-1": "2학년 1학기",
  "2-2": "2학년 2학기",
  "3-1": "3학년 1학기",
};
const SEMESTER_ORDER: Record<Semester, number> = { "1-2": 1, "2-1": 2, "2-2": 3, "3-1": 4 };

function teamPeriodLabelOf(schoolYear: string | null, semester: string | null, admissionYear: number | null): string {
  if (!schoolYear) return "학년도 미정";
  const gradeNum = admissionYear != null ? parseInt(schoolYear, 10) - admissionYear + 1 : null;
  return teamPeriodLabel(schoolYear, semester, gradeNum) ?? "학년도 미정";
}

function indivPeriodLabel(year: number | null, semester: Semester): string {
  const term = TERM_LABEL[semester] ?? semester;
  return year != null ? `${year}학년도 (${term})` : term;
}

function attachmentsFrom(urls: (string | null | undefined)[]): AttachmentRef[] {
  return urls.filter((u): u is string => !!u).map((u) => ({ name: fileNameFromUrl(u), url: u }));
}

function yearOf(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : String(d.getFullYear());
}

// PRIVACY BOUNDARY: 이 함수는 학생 본인 화면(/portfolio)과 포트폴리오 export(PDF/
// DOCX/ZIP)가 그대로 쓰는 유일한 data builder다 — teacher_observations(교사 관찰
// 기록, 039_teacher_observations.sql — 아직 미적용)를 포함한 어떤 "교사 전용/비공개"
// 데이터도 여기서 절대 조회하지 않는다. management 필드처럼 교사 화면에만 필요한
// 값이 생기더라도 학생에게 원래 공개되지 않는 원본 데이터는 이 반환값에 절대 섞지
// 말 것 — export가 이 함수 하나만 신뢰하고 그대로 문서화하기 때문이다.
export async function getStudentPortfolio(studentId: string, academicYear: string | null = null): Promise<StudentPortfolio> {
  const supabase = createClient();

  const { data: studentRow } = await supabase.from("users").select("*").eq("id", studentId).single();
  const student = studentRow as Profile;

  const [{ data: memberRows }, { data: indivRows }, { data: otherRows }, { data: awardRows }, { data: personalRecordRows }] = await Promise.all([
    supabase.from("team_members").select("team_id").eq("student_id", studentId),
    supabase
      .from("individual_research")
      .select(
        "id, title, plan_title, plan_status, plan_provenance, plan_submitted_at, plan_feedback, plan_file_urls, plan_motivation, plan_method, plan_expected, teacher_id, semester, year"
      )
      .eq("student_id", studentId)
      .order("created_at", { ascending: false }),
    supabase
      .from("other_activities")
      .select("id, subtype, title, activity_date, organizer, content, result, academic_year, semester, teacher_id, created_at")
      .eq("student_id", studentId)
      .order("activity_date", { ascending: false }),
    supabase.from("awards").select("*").eq("student_id", studentId).order("award_date", { ascending: false }),
    supabase.from("personal_records").select("entity_type, entity_id, motivation, my_role, lessons_learned, challenges").eq("student_id", studentId),
  ]);

  // "나의 기록"은 entity_type-entity_id가 그대로 activity.key(예: rne-<teamId>)와 같은 모양이라
  // 별도 매핑 없이 바로 조회할 수 있다.
  const personalRecordByKey: Record<string, PortfolioPersonalRecord> = {};
  for (const r of (personalRecordRows ?? []) as {
    entity_type: string; entity_id: string; motivation: string | null; my_role: string | null; lessons_learned: string | null; challenges: string | null;
  }[]) {
    personalRecordByKey[`${r.entity_type}-${r.entity_id}`] = {
      motivation: r.motivation, myRole: r.my_role, lessonsLearned: r.lessons_learned, challenges: r.challenges,
    };
  }
  const hasPersonalRecordContent = (pr: PortfolioPersonalRecord | undefined) =>
    !!pr && (pr.motivation || pr.myRole || pr.lessonsLearned || pr.challenges);

  const teamIds = (memberRows ?? []).map((m: { team_id: string }) => m.team_id);
  const indivData = (indivRows ?? []) as {
    id: string; title: string; plan_title: string | null; plan_status: PlanStatus; plan_provenance?: string | null; plan_submitted_at: string | null;
    plan_feedback: string | null; plan_file_urls: string[] | null; plan_motivation: string | null; plan_method: string | null;
    plan_expected: string | null; teacher_id: string | null; semester: Semester; year: number | null;
  }[];
  const otherData = (otherRows ?? []) as {
    id: string; subtype: OtherActivitySubtype; title: string; activity_date: string | null; organizer: string | null;
    content: string | null; result: string | null; academic_year: number | null; semester: "1" | "2" | null;
    teacher_id: string | null; created_at: string;
  }[];
  const indivIds = indivData.map((r) => r.id);

  const allActivities: PortfolioActivity[] = [];
  const admissionYear = admissionYearFromUsername(student?.username ?? null);

  // ── 팀(R&E/동아리) ───────────────────────────────────────────────────────
  let teamMeta: { id: string; kind: "rne" | "club"; teacherId: string | null; schoolYear: string | null; semester: string | null; name: string }[] = [];
  const logsByEntity: Record<string, PortfolioLog[]> = {};
  const allLogIds: string[] = [];
  const logById: Record<string, PortfolioLog> = {};

  if (teamIds.length > 0) {
    const [{ data: teamsData }, { data: planRows }, { data: reportRows }, { data: teamNoteRows }, { data: allTeamMemberRows }] = await Promise.all([
      supabase.from("teams").select("id, name, type, teacher_id, school_year, semester").in("id", teamIds),
      // 012_submissions.sql의 마이그레이션 파일에는 research_plans.file_url/file_name이
      // 정의돼 있지만, 실제 production DB에는 이 컬럼이 존재하지 않는다(직접 조회로
      // 확인: 42703 column does not exist — 038 report_schedules.submission_type과 같은
      // 유형의 migration-파일 vs 실제 DB drift). 그래서 select하지 않는다 — 존재하지
      // 않는 컬럼을 select하면 이 쿼리 전체가 400으로 실패해 팀 계획서 자체가 안 보인다.
      // 팀(R&E/동아리) 계획서는 현재 텍스트 전용이라 submittedFile은 항상 null이다.
      supabase.from("research_plans").select("entity_id, title, status, provenance, submitted_at, feedback, motivation, method, expected_result").in("entity_id", teamIds),
      supabase
        .from("research_reports")
        .select("entity_id, title, status, provenance, submitted_at, feedback, file_url, file_name, original_file_name, extra_file_urls, summary, introduction, conclusion")
        .in("entity_id", teamIds),
      supabase
        .from("activity_logs")
        .select(
          "id, entity_id, log_date, display_order, created_at, status, title, goal, experiment, free_memo, activity_content, result, achievement, interpretation, conclusion, next_plan, file_urls, teacher_feedback"
        )
        .eq("entity_type", "team")
        .eq("author_id", studentId)
        .in("entity_id", teamIds),
      // 프로젝트 헤더에 표시할 "팀원" 목록 — 현재 학생의 팀 소속 조회(memberRows)와 달리
      // 이건 그 팀들의 "전체" 구성원을 알아야 해서 team_id 기준으로 다시 조회한다.
      supabase.from("team_members").select("team_id, student_id").in("team_id", teamIds),
    ]);

    // 제출 원본 파일 이름 규칙(submittedFileBaseName)에 team.school_year/type/name이
    // 필요해 teamMeta(아래에서 계산)보다 먼저 teamsData에서 직접 찾는다.
    const teamById: Record<string, { name: string; type: string; school_year: string | null }> = {};
    for (const t of (teamsData ?? []) as { id: string; name: string; type: string; school_year: string | null }[]) teamById[t.id] = t;

    const planMap: Record<string, PortfolioPlan> = {};
    for (const p of (planRows ?? []) as {
      entity_id: string; title: string | null; status: PlanStatus; provenance?: string | null; submitted_at: string | null; feedback: string | null;
      motivation: string | null; method: string | null; expected_result: string | null;
    }[]) {
      planMap[p.entity_id] = {
        title: p.title, status: p.status, provenance: p.provenance ?? null, submittedAt: p.submitted_at, feedback: p.feedback, attachments: [], submittedFile: null,
        motivation: p.motivation, method: p.method, expectedResult: p.expected_result,
      };
    }
    const reportMap: Record<string, PortfolioReport> = {};
    for (const r of (reportRows ?? []) as {
      entity_id: string; title: string | null; status: PlanStatus; provenance?: string | null; submitted_at: string | null; feedback: string | null;
      file_url: string | null; file_name: string | null; original_file_name: string | null; extra_file_urls: string[] | null; summary: string | null;
      introduction: string | null; conclusion: string | null;
    }[]) {
      const t = teamById[r.entity_id];
      const primaryName =
        r.file_url && t
          ? `${submittedFileBaseName({ schoolYear: t.school_year, activityKind: t.type === "rne" ? "R&E" : "동아리", who: student.name, docType: "결과보고서" })}_제출파일${extOf(r.file_url)}`
          : (r.original_file_name ?? r.file_name ?? (r.file_url ? fileNameFromUrl(r.file_url) : ""));
      const submittedFile: AttachmentRef | null = r.file_url ? { name: primaryName, url: r.file_url } : null;
      const attachments: AttachmentRef[] = [...(submittedFile ? [submittedFile] : []), ...attachmentsFrom(r.extra_file_urls ?? [])];
      reportMap[r.entity_id] = {
        title: r.title, status: r.status, provenance: r.provenance ?? null, submittedAt: r.submitted_at, feedback: r.feedback, attachments, submittedFile,
        introduction: r.introduction, conclusion: r.conclusion, summary: r.summary,
      };
    }
    for (const n of (teamNoteRows ?? []) as {
      id: string; entity_id: string; log_date: string | null; display_order: number | null; created_at: string | null; status: string; title: string | null; goal: string | null; experiment: string | null;
      free_memo: string | null; activity_content: string | null; result: string | null; achievement: string | null;
      interpretation: string | null; conclusion: string | null; next_plan: string | null; file_urls: string[] | null; teacher_feedback: string | null;
    }[]) {
      allLogIds.push(n.id);
      const log: PortfolioLog = {
        id: n.id, logDate: n.log_date, displayOrder: n.display_order ?? null, createdAt: n.created_at ?? null, status: n.status, title: n.title,
        goal: n.goal, activityContent: n.experiment ?? n.free_memo ?? n.activity_content, result: n.result, achievement: n.achievement,
        interpretation: n.interpretation, conclusion: n.conclusion, nextPlan: n.next_plan,
        teacherFeedback: n.teacher_feedback, attachments: attachmentsFrom(n.file_urls ?? []), myRoles: [],
      };
      logById[n.id] = log;
      (logsByEntity[n.entity_id] ??= []).push(log);
    }

    const teamMemberIdsByTeam: Record<string, string[]> = {};
    for (const m of (allTeamMemberRows ?? []) as { team_id: string; student_id: string }[]) {
      (teamMemberIdsByTeam[m.team_id] ??= []).push(m.student_id);
    }
    const allMemberIds = [...new Set(Object.values(teamMemberIdsByTeam).flat())];
    let memberNameById: Record<string, string> = {};
    if (allMemberIds.length > 0) {
      const { data: memberUserRows } = await supabase.from("users").select("id, name").in("id", allMemberIds);
      memberNameById = Object.fromEntries(((memberUserRows ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    }

    teamMeta = ((teamsData ?? []) as { id: string; name: string; type: string; teacher_id: string | null; school_year: string | null; semester: string | null }[]).map(
      (t) => ({ id: t.id, kind: t.type === "rne" ? "rne" : "club", teacherId: t.teacher_id, schoolYear: t.school_year, semester: t.semester, name: t.name })
    );

    for (const t of teamMeta) {
      allActivities.push({
        key: `${t.kind}-${t.id}`,
        typeKey: t.kind,
        name: t.name,
        teacherId: t.teacherId,
        teacherName: "",
        schoolYear: t.schoolYear,
        periodLabel: teamPeriodLabelOf(t.schoolYear, t.semester, admissionYear),
        periodSort: t.schoolYear ? parseInt(t.schoolYear, 10) * 10 + parseInt(t.semester || "1", 10) : 0,
        isHistorical: isHistoricalImport(planMap[t.id]) || isHistoricalImport(reportMap[t.id]),
        plan: planMap[t.id] ?? null,
        report: reportMap[t.id] ?? null,
        logs: logsByEntity[t.id] ?? [],
        members: (teamMemberIdsByTeam[t.id] ?? []).map((id) => memberNameById[id] ?? "알 수 없음"),
        personalRecord: hasPersonalRecordContent(personalRecordByKey[`${t.kind}-${t.id}`]) ? personalRecordByKey[`${t.kind}-${t.id}`] : null,
        otherActivityDate: null,
        otherSemesterLabel: null,
        otherActivity: null,
      });
    }
  }

  // ── 창의개인연구 ───────────────────────────────────────────────────────
  if (indivIds.length > 0) {
    const [{ data: reportRows }, { data: indivNoteRows }] = await Promise.all([
      supabase
        .from("research_reports")
        .select("entity_id, title, status, provenance, submitted_at, feedback, file_url, file_name, original_file_name, extra_file_urls, summary, introduction, conclusion")
        .eq("entity_type", "individual")
        .in("entity_id", indivIds),
      supabase
        .from("activity_logs")
        .select(
          "id, entity_id, log_date, display_order, created_at, status, title, goal, experiment, free_memo, activity_content, result, achievement, interpretation, conclusion, next_plan, file_urls, teacher_feedback"
        )
        .eq("entity_type", "individual")
        .in("entity_id", indivIds),
    ]);
    const indivById: Record<string, { year: number | null }> = {};
    for (const r of indivData) indivById[r.id] = { year: r.year };
    const reportMap: Record<string, PortfolioReport> = {};
    for (const r of (reportRows ?? []) as {
      entity_id: string; title: string | null; status: PlanStatus; provenance?: string | null; submitted_at: string | null; feedback: string | null;
      file_url: string | null; file_name: string | null; original_file_name: string | null; extra_file_urls: string[] | null; summary: string | null;
      introduction: string | null; conclusion: string | null;
    }[]) {
      const yr = indivById[r.entity_id]?.year;
      const primaryName = r.file_url
        ? `${submittedFileBaseName({ schoolYear: yr != null ? String(yr) : null, activityKind: "창의개인연구", who: student.name, docType: "결과보고서" })}_제출파일${extOf(r.file_url)}`
        : (r.original_file_name ?? r.file_name ?? "");
      const submittedFile: AttachmentRef | null = r.file_url ? { name: primaryName, url: r.file_url } : null;
      const attachments: AttachmentRef[] = [...(submittedFile ? [submittedFile] : []), ...attachmentsFrom(r.extra_file_urls ?? [])];
      reportMap[r.entity_id] = {
        title: r.title, status: r.status, provenance: r.provenance ?? null, submittedAt: r.submitted_at, feedback: r.feedback, attachments, submittedFile,
        introduction: r.introduction, conclusion: r.conclusion, summary: r.summary,
      };
    }
    for (const n of (indivNoteRows ?? []) as {
      id: string; entity_id: string; log_date: string | null; display_order: number | null; created_at: string | null; status: string; title: string | null; goal: string | null; experiment: string | null;
      free_memo: string | null; activity_content: string | null; result: string | null; achievement: string | null;
      interpretation: string | null; conclusion: string | null; next_plan: string | null; file_urls: string[] | null; teacher_feedback: string | null;
    }[]) {
      allLogIds.push(n.id);
      const log: PortfolioLog = {
        id: n.id, logDate: n.log_date, displayOrder: n.display_order ?? null, createdAt: n.created_at ?? null, status: n.status, title: n.title,
        goal: n.goal, activityContent: n.experiment ?? n.free_memo ?? n.activity_content, result: n.result, achievement: n.achievement,
        interpretation: n.interpretation, conclusion: n.conclusion, nextPlan: n.next_plan,
        teacherFeedback: n.teacher_feedback, attachments: attachmentsFrom(n.file_urls ?? []), myRoles: [],
      };
      logById[n.id] = log;
      (logsByEntity[n.entity_id] ??= []).push(log);
    }

    for (const r of indivData) {
      // 창의개인연구 계획서는 team 계획서와 달리 plan_file_urls(자유 첨부)가 있다 —
      // "실제 제출 PDF" 개념이 없으므로, 그중 첫 PDF 파일을 관례적으로 제출본으로
      // 취급한다(팀 결과보고서의 PDF-only 제출과 최대한 같은 취급을 하기 위함).
      const planUrls = r.plan_file_urls ?? [];
      const firstPdfUrl = planUrls.find((u) => u && isPdfUrl(u)) ?? null;
      const planSubmittedFile: AttachmentRef | null = firstPdfUrl
        ? {
            name: `${submittedFileBaseName({ schoolYear: r.year != null ? String(r.year) : null, activityKind: "창의개인연구", who: student.name, docType: "연구계획서" })}_제출파일${extOf(firstPdfUrl)}`,
            url: firstPdfUrl,
          }
        : null;
      const planAttachments = attachmentsFrom(planUrls).map((a) => (planSubmittedFile && a.url === firstPdfUrl ? planSubmittedFile : a));
      allActivities.push({
        key: `individual-${r.id}`,
        typeKey: "individual",
        name: r.title,
        teacherId: r.teacher_id,
        teacherName: "",
        schoolYear: r.year != null ? String(r.year) : null,
        periodLabel: indivPeriodLabel(r.year, r.semester),
        periodSort: (r.year ?? 0) * 10 + SEMESTER_ORDER[r.semester],
        plan: {
          title: r.plan_title ?? r.title,
          status: r.plan_status ?? "draft",
          provenance: r.plan_provenance ?? null,
          submittedAt: r.plan_submitted_at,
          feedback: r.plan_feedback,
          attachments: planAttachments,
          submittedFile: planSubmittedFile,
          motivation: r.plan_motivation,
          method: r.plan_method,
          expectedResult: r.plan_expected,
        },
        isHistorical: isHistoricalImport({ status: r.plan_status ?? "draft", provenance: r.plan_provenance }) || isHistoricalImport(reportMap[r.id]),
        report: reportMap[r.id] ?? null,
        logs: logsByEntity[r.id] ?? [],
        members: [student.name],
        personalRecord: hasPersonalRecordContent(personalRecordByKey[`individual-${r.id}`]) ? personalRecordByKey[`individual-${r.id}`] : null,
        otherActivityDate: null,
        otherSemesterLabel: null,
        otherActivity: null,
      });
    }
  }

  // ── 기타 활동 ─────────────────────────────────────────────────────────
  // academic_year(041 마이그레이션)가 있으면 그대로 쓰고, 없는 기존 레코드만
  // activity_date/created_at에서 유추한다 — 기존 레코드를 DB에 되써서 채우지는
  // 않는다(041 코멘트와 동일 원칙).
  for (const o of otherData) {
    const y = o.academic_year != null ? String(o.academic_year) : (yearOf(o.activity_date) ?? yearOf(o.created_at));
    const semesterLabel = o.semester ? OTHER_ACTIVITY_SEMESTER_LABEL[o.semester] : null;
    allActivities.push({
      key: `other-${o.id}`,
      typeKey: "other",
      name: o.title,
      teacherId: o.teacher_id,
      teacherName: "",
      schoolYear: y,
      periodLabel: y ? `${y}학년도${semesterLabel ? ` (${semesterLabel})` : ""}` : "학년도 미정",
      isHistorical: false,
      periodSort: y ? parseInt(y, 10) * 10 + otherActivitySemesterSortPriority(o.semester) : 0,
      plan: null,
      report: null,
      logs: [],
      members: [],
      personalRecord: null,
      otherActivityDate: o.activity_date,
      otherSemesterLabel: semesterLabel,
      otherActivity: { subtype: o.subtype, organizer: o.organizer, content: o.content, result: o.result },
    });
  }

  // ── 연구일지 역할 집계(activity_log_participants) — 능력 점수가 아니라 횟수 사실만. ──
  const roleCounts: Partial<Record<ActivityRoleCode, number>> = {};
  if (allLogIds.length > 0) {
    const { data: participantRows } = await supabase
      .from("activity_log_participants")
      .select("log_id, student_id, roles")
      .in("log_id", allLogIds)
      .eq("student_id", studentId);
    for (const p of (participantRows ?? []) as { log_id: string; student_id: string; roles: ActivityRoleCode[] }[]) {
      const log = logById[p.log_id];
      if (log) log.myRoles = p.roles ?? [];
      for (const code of p.roles ?? []) roleCounts[code] = (roleCounts[code] ?? 0) + 1;
    }
  }

  // ── 지도교사 이름 ────────────────────────────────────────────────────
  const teacherIds = new Set<string>();
  for (const a of allActivities) if (a.teacherId) teacherIds.add(a.teacherId);
  let teacherMap: Record<string, string> = {};
  if (teacherIds.size > 0) {
    const { data: teacherRows } = await supabase.from("users").select("id, name").in("id", [...teacherIds]);
    teacherMap = Object.fromEntries(((teacherRows ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  }
  for (const a of allActivities) a.teacherName = a.teacherId ? teacherMap[a.teacherId] ?? "알 수 없음" : "지도교사 없음";

  // ── 학년도 옵션(필터 적용 전, 이 학생의 전체 활동 기준) ───────────────────
  const yearOptions = [...new Set(allActivities.map((a) => a.schoolYear).filter((y): y is string => !!y))].sort((a, b) => b.localeCompare(a));

  const filteredActivities = academicYear ? allActivities.filter((a) => a.schoolYear === academicYear) : allActivities;
  filteredActivities.sort((a, b) => {
    const order: Record<PortfolioTypeKey, number> = { rne: 0, club: 1, individual: 2, other: 3 };
    const t = order[a.typeKey] - order[b.typeKey];
    if (t !== 0) return t;
    return b.periodSort - a.periodSort;
  });

  const awards = ((awardRows as AwardRecord[]) ?? []).filter((a) => !academicYear || yearOf(a.award_date) === academicYear);

  // ── 요약 ────────────────────────────────────────────────────────────
  const researchActivities = filteredActivities.filter((a) => a.typeKey !== "other");
  const planTotal = researchActivities.filter((a) => a.plan).length;
  // "기록된 문서 수" — 승인 건수가 아니다: historical(과거 기록)도 내용이 있으면 포함한다.
  // provenance가 historical_import인 문서는 live workflow 상태(submitted 등)로 전환돼도 "기록된 문서"로 센다.
  const isRecorded = (doc: { status?: string | null; provenance?: string | null } | null | undefined) => doc?.status === "approved" || isHistoricalImport(doc);
  const planApproved = researchActivities.filter((a) => isRecorded(a.plan)).length;
  const reportTotal = researchActivities.filter((a) => a.report).length;
  const reportApproved = researchActivities.filter((a) => isRecorded(a.report)).length;
  const noteCount = filteredActivities.reduce((sum, a) => sum + a.logs.length, 0);

  // ── 교사 전용 관리 context: 검토 대기 / 수정요청 미반영 / 최근 활동 ─────────
  // 기존 검토 시스템(deriveReviewPhase)을 그대로 재사용 — 여기서 새 상태를 만들지 않는다.
  let pendingReviewCount = 0;
  let revisionNeededCount = 0;
  let recentActivityAt: string | null = null;
  for (const a of filteredActivities) {
    if (a.plan && a.plan.status !== "historical") {
      const phase = deriveReviewPhase(a.plan.status, a.plan.feedback);
      if (phase === "submitted" || phase === "resubmitted") pendingReviewCount++;
      if (phase === "revision_requested") revisionNeededCount++;
      if (a.plan.submittedAt && (!recentActivityAt || a.plan.submittedAt > recentActivityAt)) recentActivityAt = a.plan.submittedAt;
    }
    if (a.report && a.report.status !== "historical") {
      const phase = deriveReviewPhase(a.report.status, a.report.feedback);
      if (phase === "submitted" || phase === "resubmitted") pendingReviewCount++;
      if (phase === "revision_requested") revisionNeededCount++;
      if (a.report.submittedAt && (!recentActivityAt || a.report.submittedAt > recentActivityAt)) recentActivityAt = a.report.submittedAt;
    }
    for (const log of a.logs) {
      if (log.status === "historical") continue;
      const phase = deriveReviewPhase(log.status, log.teacherFeedback);
      if (phase === "submitted" || phase === "resubmitted") pendingReviewCount++;
      if (phase === "revision_requested") revisionNeededCount++;
      if (log.logDate && (!recentActivityAt || log.logDate > recentActivityAt)) recentActivityAt = log.logDate;
    }
  }

  return {
    student,
    academicYear,
    yearOptions,
    activities: filteredActivities,
    awards,
    roleCounts,
    summary: {
      projectCount: researchActivities.length,
      planApproved,
      planTotal,
      reportApproved,
      reportTotal,
      noteCount,
      approvedSubmissionCount: researchActivities.filter((a) => a.plan?.status === "approved").length + researchActivities.filter((a) => a.report?.status === "approved").length, // historical은 승인 건수에 포함하지 않는다
      awardCount: awards.length,
    },
    management: { recentActivityAt, revisionNeededCount, pendingReviewCount },
  };
}

export { ACTIVITY_ROLE_LABEL, ACTIVITY_ROLE_CODES };
