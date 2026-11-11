-- 046과 같은 목적: 개인연구 계획서는 별도 테이블(individual_research)에 plan_* 컬럼으로 들어 있어서
-- 출처(provenance)를 따로 둘 컬럼이 필요하다. NULL=일반 live row, historical_import=과거 활동 사후 기록(출처).
-- workflow 상태는 plan_status가 따로 가진다. additive nullable — 기존 row/RLS는 바꾸지 않는다.
ALTER TABLE public.individual_research ADD COLUMN IF NOT EXISTS plan_provenance text;

COMMENT ON COLUMN public.individual_research.plan_provenance IS 'NULL=일반 live row, historical_import=과거 활동 사후 기록(출처). 계획서 workflow 상태는 plan_status가 따로 가진다.';
