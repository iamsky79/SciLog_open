-- 학생별 "교사 관찰 기록". 기존에 동일 목적 table(teacher note/counseling/memo)이
-- 없어 새로 만든다. 새 permission 체계를 만들지 않고, 이미 존재하는 헬퍼
-- (is_supervising_teacher/is_admin_or_viewer, 001_init.sql)를 그대로 재사용한다.
--
-- 설계 원칙(요청 사항 그대로):
--   - author_teacher_id는 절대 익명화/NULL로 저장하지 않는다 — 본인 수정/삭제 권한,
--     abuse/audit, 책임 추적을 위해 실제 작성자를 DB에 항상 보존한다.
--     "다른 교사에게는 익명으로 보인다"는 UI/응답 레벨 규칙이지 DB 저장 규칙이 아니다
--     (클라이언트가 현재 로그인 교사 id와 author_teacher_id를 비교해 "내 기록"/
--     "교사 기록"으로 표시만 다르게 한다).
--   - 학생은 이 table에 대해 어떤 SELECT policy도 갖지 않는다 — RLS가 기본적으로
--     모든 접근을 막으므로, 정책을 아예 안 만드는 것 자체가 "학생은 절대 조회
--     불가"를 DB 레벨에서 강제한다.
--
-- [2026-09-23 SELECT 범위 재검토 — A(전체 교사) vs B(지도 관계 교사)]
-- 034_teacher_readonly_all_students.sql은 "교사는 전체 학생 portfolio를 읽기
-- 가능"으로 이미 넓혀둔 상태다. 처음에는 관찰 기록도 그 범위(is_teacher())를
-- 그대로 따라 A로 구현했으나, 재검토 결과 B(지도 관계가 있는 교사만)로 바꾼다.
-- 이유:
--   1. portfolio(연구계획서 상태, 제출일 등)는 이미 사실 위주의 객관적 기록이라
--      "학교 전체 교사가 학생 현황을 파악"하는 034의 목적과 맞지만, 관찰 기록은
--      교사 개인의 주관적 평가/판단이 들어가는 훨씬 민감한 내용이라 같은 잣대를
--      적용하기 어렵다.
--   2. 001_init.sql에 이미 is_supervising_teacher(student_id) — "이 교사가 이
--      학생을 팀 또는 개인연구로 실제 지도하는가"를 판별하는 함수가 존재한다.
--      submission-pdfs signed URL 권한 재검토 때와 같은 이유로, 이런 함수가
--      이미 있다는 것 자체가 제품의 원래 권한 모델이 "지도 관계 기반"에 더
--      가깝다는 신호로 보고, 034의 넓은 예외를 관찰 기록까지 확장하지 않는다.
--   3. "불필요하게 public하게 만들지 않는다"는 최소권한 원칙에도 B가 더 부합한다.
-- 따라서 SELECT/INSERT 모두 is_supervising_teacher(student_id)로 좁힌다(관리자는
-- 기존처럼 예외). 이 table이 아직 어떤 환경에도 적용된 적이 없으므로(2026-09-23
-- 기준 미적용 확인) 정책을 나중에 넓히는 게 아니라 처음부터 좁게 시작한다.

create table if not exists public.teacher_observations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id) on delete cascade,
  author_teacher_id uuid not null references public.users(id),
  activity_type text,
  activity_id uuid,
  observed_at date not null default current_date,
  content text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_teacher_observations_student on public.teacher_observations (student_id, observed_at desc);
create index if not exists idx_teacher_observations_author on public.teacher_observations (author_teacher_id);

alter table public.teacher_observations enable row level security;

-- 학생용 정책 없음 = 학생은 이 table에 절대 접근 불가(SELECT 포함).

create policy "supervising teachers can view observations" on public.teacher_observations
  for select
  using (public.is_supervising_teacher(student_id) or public.is_admin_or_viewer());

create policy "supervising teachers can create own observations" on public.teacher_observations
  for insert
  with check (author_teacher_id = auth.uid() and (public.is_supervising_teacher(student_id) or public.is_admin_or_viewer()));

create policy "authors can update own observations" on public.teacher_observations
  for update
  using (author_teacher_id = auth.uid() or public.is_admin_or_viewer())
  with check (author_teacher_id = auth.uid() or public.is_admin_or_viewer());

create policy "authors can delete own observations" on public.teacher_observations
  for delete
  using (author_teacher_id = auth.uid() or public.is_admin_or_viewer());
