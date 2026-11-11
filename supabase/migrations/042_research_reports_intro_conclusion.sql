-- 결과보고서 작성 구조를 "연구 요약" 단일 필드에서 "서론"/"결론" 두 필드로 바꾼다
-- (additive-only, 둘 다 nullable). 기존 summary 컬럼은 절대 지우거나 값을 옮기지
-- 않는다 — introduction/conclusion이 없는 기존 결과보고서는 summary만 있는 legacy
-- 데이터로 그대로 남고, 화면에서는 "연구 요약 (기존 데이터)"로 계속 보여준다.
alter table public.research_reports
  add column if not exists introduction text;

alter table public.research_reports
  add column if not exists conclusion text;

comment on column public.research_reports.introduction is
  '결과보고서 "서론" — 새 작성 UI부터 사용. 기존 레코드는 NULL(legacy는 summary만 있음).';
comment on column public.research_reports.conclusion is
  '결과보고서 "결론" — 새 작성 UI부터 사용. 기존 레코드는 NULL(legacy는 summary만 있음).';
comment on column public.research_reports.summary is
  'legacy 필드 — introduction/conclusion 도입 이전 결과보고서의 "연구 요약". 새 UI는 이 컬럼에
   쓰지 않지만, 기존 데이터 보존을 위해 컬럼 자체는 삭제하지 않는다.';
