-- 기타 활동에 학년도/학기 필드를 추가한다(additive-only, 둘 다 nullable).
--
-- 지금까지 other_activities에는 학년도 개념 자체가 없어 activity_date(또는
-- created_at)에서 연도를 뽑아 쓰고 있었다(portfolio/detail.ts yearOf()). 하지만
-- activity_date는 nullable이라(수행평가 등 정확한 날짜가 없는 활동) 학년도를
-- 안정적으로 보여줄 수 없었다 — 그래서 "학년도"를 폼에서 직접 입력받는 명시적
-- 컬럼으로 분리한다.
--
-- 기존 레코드는 두 컬럼 모두 NULL로 남는다 — activity_date/created_at으로
-- 학년도를 추론해 자동으로 채워 넣지 않는다(요청사항: "임의 추론하여 DB를
-- 자동 수정하지 않는다"). "학년도 미정" 표시는 애플리케이션 레벨에서 그대로 유지.
alter table public.other_activities
  add column if not exists academic_year integer;

-- semester: '1'(1학기) / '2'(2학기) / NULL(학기 구분 없음) — 세 번째 옵션을 별도
-- 값으로 만들지 않고 NULL로 표현해 컬럼을 하나로 유지한다.
alter table public.other_activities
  add column if not exists semester text check (semester in ('1', '2'));

comment on column public.other_activities.academic_year is
  '학년도(예: 2024). 새 레코드부터 폼에서 입력받는다. 기존 레코드는 NULL — activity_date/created_at으로 자동 추론하지 않는다.';
comment on column public.other_activities.semester is
  '학기 — ''1''(1학기)/''2''(2학기)/NULL(학기 구분 없음).';
