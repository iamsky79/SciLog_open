export type UserRole = "student" | "teacher" | "viewer";
/** "historical" = 과거 활동을 사후에 기록한 데이터(실제 SciLog 제출/승인 workflow를 거치지 않음). draft/submitted/approved/rejected와 의미가 다르다. */
export type PlanStatus = "draft" | "submitted" | "approved" | "rejected" | "historical";
export type TeamType = "rne" | "club";
export type Semester = "1-2" | "2-1" | "2-2" | "3-1";
export type OtherActivitySubtype =
  | "external_competition"
  | "internal_competition"
  | "performance"
  | "invention"
  | "idea";
/** OtherActivity.semester — '1'(1학기)/'2'(2학기)/null(학기 구분 없음). team/individual의 Semester("1-2" 등)와는 다른 값이다. */
export type OtherActivitySemester = "1" | "2";
export type Participation = "individual" | "team";
export type EntityType = "team" | "individual" | "other";
export type ReviewStatus = "approved" | "rejected" | "pending" | "submitted" | "draft" | "historical";

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_admin: boolean;
  grade: number | null;
  class: string | null;
  username: string | null;
  number: number | null;
  subject: string | null;
  password_changed: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  type: TeamType;
  subtype: string | null;
  teacher_id: string | null;
  name: string;
  field: string | null;
  school_year: string | null;
  semester: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  shared_doc_url: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  student_id: string;
  is_leader: boolean;
  drive_link: string | null;
  joined_at: string;
}

export interface IndividualResearch {
  id: string;
  student_id: string;
  teacher_id: string | null;
  semester: Semester;
  title: string;
  field: string | null;
  subject: string | null;
  year: number | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  drive_link: string | null;
  shared_doc_url: string | null;
  plan_title: string | null;
  plan_motivation: string | null;
  plan_method: string | null;
  plan_expected: string | null;
  plan_status: PlanStatus;
  /** 계획서 출처 — null=일반 live row, "historical_import"=과거 활동 사후 기록. plan_status와 별개(047 migration). */
  plan_provenance?: string | null;
  plan_feedback: string | null;
  plan_submitted_at: string | null;
  plan_reviewed_at: string | null;
  plan_file_urls: string[];
  created_at: string;
}

export interface IndividualSettings {
  id: string;
  year: number;
  type: string;
  is_active: boolean;
  start_at: string | null;
  end_at: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface OtherActivity {
  id: string;
  student_id: string;
  subtype: OtherActivitySubtype;
  title: string;
  /** 학년도(예: 2024) — 041 마이그레이션 이전 레코드는 null(activity_date/created_at으로 대체 표시). */
  academic_year: number | null;
  /** '1'/'2'/null(학기 구분 없음) — 041 마이그레이션 이전 레코드는 항상 null. */
  semester: OtherActivitySemester | null;
  activity_date: string | null;
  organizer: string | null;
  content: string | null;
  result: string | null;
  drive_link: string | null;
  teacher_id: string | null;
  has_teacher: boolean;
  created_at: string;
}

export interface Reference {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  authors: string | null;
  source: string | null;
  url: string | null;
  file_url: string | null;
  memo: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AiAnalysis {
  id: string;
  student_id: string;
  content: {
    career_direction: string;
    strengths: string;
    weaknesses: string;
    future_direction: string;
    guidance_points: string;
  };
  created_by: string | null;
  created_at: string;
}

export interface AwardRecord {
  id: string;
  student_id: string;
  award_name: string;
  competition: string | null;
  organizer: string | null;
  award_date: string | null;
  grade: string | null;
  participation: Participation;
  team_members_text: string | null;
  related_type: EntityType | null;
  related_id: string | null;
  drive_link: string | null;
  note: string | null;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  author_id: string;
  /** 원본에서 날짜를 확인할 수 없는 historical 일지는 NULL(가짜 날짜를 넣지 않는다 — 043 migration). */
  log_date: string | null;
  title: string | null;
  goal: string | null;
  experiment: string | null;
  result: string | null;
  conclusion: string | null;
  next_plan: string | null;
  activity_content: string | null;
  achievement: string | null;
  free_memo: string | null;
  interpretation: string | null;
  drive_link: string | null;
  file_urls: string[];
  /** 출처 — null=일반 live row, "historical_import"=과거 활동 사후 기록. workflow 상태(status)와 별개(046 migration). */
  provenance?: string | null;
  status: ReviewStatus;
  teacher_feedback: string | null;
  created_at: string;
  log_type: "team" | "personal";
}

// 연구일지 참여 학생별 역할 (연구일지 : 학생 = 1 : N)
export type ActivityRoleCode =
  | "idea_hypothesis"
  | "literature_review"
  | "experiment_design"
  | "experiment_execution"
  | "instrument_analysis"
  | "data_processing"
  | "result_interpretation"
  | "presentation_report"
  | "other";

export const ACTIVITY_ROLE_LABEL: Record<ActivityRoleCode, string> = {
  idea_hypothesis: "아이디어·가설 제안",
  literature_review: "문헌 조사",
  experiment_design: "실험 설계",
  experiment_execution: "실험 수행",
  instrument_analysis: "기기 분석",
  data_processing: "데이터 처리",
  result_interpretation: "결과 해석",
  presentation_report: "발표·보고서 작성",
  other: "기타",
};

export const ACTIVITY_ROLE_CODES = Object.keys(ACTIVITY_ROLE_LABEL) as ActivityRoleCode[];

export interface ActivityLogParticipant {
  id: string;
  log_id: string;
  student_id: string;
  roles: ActivityRoleCode[];
  role_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonalRecord {
  id: string;
  entity_type: "rne" | "club" | "individual";
  entity_id: string;
  student_id: string;
  motivation: string | null;
  my_role: string | null;
  lessons_learned: string | null;
  challenges: string | null;
  updated_at: string;
}

export interface ResearchPlan {
  id: string;
  team_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string | null;
  motivation: string | null;
  method: string | null;
  expected_result: string | null;
  /** 출처 — null=일반 live row, "historical_import"=과거 활동 사후 기록. workflow 상태(status)와 별개(046 migration). */
  provenance?: string | null;
  status: PlanStatus;
  feedback: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  teacher_approved_at: string | null;
  teacher_approved_by: string | null;
  admin_approved_at: string | null;
  admin_approved_by: string | null;
}

export interface ResearchReport {
  id: string;
  team_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string | null;
  /** legacy 필드 — introduction/conclusion 도입 이전 결과보고서의 "연구 요약". 새 작성 UI는
   * 여기에 쓰지 않는다(042_research_reports_intro_conclusion.sql). */
  summary: string | null;
  /** 결과보고서 "서론" — 새 작성 UI부터 사용(042). */
  introduction: string | null;
  /** 결과보고서 "결론" — 새 작성 UI부터 사용(042). */
  conclusion: string | null;
  file_url: string | null;
  file_name: string | null;
  original_file_name: string | null;
  /** 출처 — null=일반 live row, "historical_import"=과거 활동 사후 기록. workflow 상태(status)와 별개(046 migration). */
  provenance?: string | null;
  status: PlanStatus;
  feedback: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_late: boolean;
  schedule_id: string | null;
  extra_file_urls: string[];
}

export interface ReportSchedule {
  id: string;
  title: string;
  entity_type: string | null;
  entity_id: string | null;
  deadline: string;
  description: string | null;
  /** 038_report_schedules_submission_type.sql로 뒤늦게 추가된 컬럼 — 컬럼 추가 이전
   * (이론상) 존재했을 행은 값이 없을 수 있어 nullable이다. 새로 만드는 행은 항상
   * 명시적인 값을 저장한다(admin/report-schedule/page.tsx). */
  submission_type: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
