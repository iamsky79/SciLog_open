-- 주의: log_date가 NULL인 행이 하나라도 있으면 SET NOT NULL이 실패한다.
-- 그 행들을 먼저 지우거나 실제 날짜를 채운 뒤 실행할 것.
ALTER TABLE public.activity_logs ALTER COLUMN log_date SET DEFAULT current_date;
ALTER TABLE public.activity_logs ALTER COLUMN log_date SET NOT NULL;
