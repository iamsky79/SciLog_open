-- 날짜가 없는 historical 연구일지의 "연구 흐름 순서"를 날짜 대신 저장한다(가짜 날짜 없이 정렬하기 위함).
-- additive/non-destructive: nullable 컬럼 하나만 추가한다. 값이 없는 기존 일지는 기존처럼 날짜순으로 정렬된다.
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS display_order integer;
