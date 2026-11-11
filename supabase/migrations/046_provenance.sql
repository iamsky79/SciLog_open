-- 출처(provenance)와 workflow 상태(status)를 분리한다.
-- 지금까지는 status='historical' 하나가 "과거 복원 자료"라는 출처와 "수정/검토 불가" 잠금을 동시에 표현했다.
-- provenance는 출처만 나타내는 additive nullable 컬럼이다: 일반 live row는 NULL,
-- 과거 활동을 사후에 import한 row는 'historical_import'. 기존 row는 값을 바꾸지 않는다(전역 변환 없음).
ALTER TABLE public.research_plans ADD COLUMN IF NOT EXISTS provenance text;
ALTER TABLE public.research_reports ADD COLUMN IF NOT EXISTS provenance text;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS provenance text;

COMMENT ON COLUMN public.research_plans.provenance IS 'NULL=일반 live row, historical_import=과거 활동 사후 기록(출처). workflow 상태는 status가 따로 가진다.';
COMMENT ON COLUMN public.research_reports.provenance IS 'NULL=일반 live row, historical_import=과거 활동 사후 기록(출처). workflow 상태는 status가 따로 가진다.';
COMMENT ON COLUMN public.activity_logs.provenance IS 'NULL=일반 live row, historical_import=과거 활동 사후 기록(출처). workflow 상태는 status가 따로 가진다.';
