-- historical backfill: 원본에서 날짜를 확인할 수 없는 연구일지를 가짜 날짜 없이 저장하기 위해
-- activity_logs.log_date의 NOT NULL을 해제한다. default current_date도 함께 제거해서,
-- 날짜를 명시하지 않은 insert가 "오늘 날짜"로 조용히 채워지지 않게 한다.
-- 기존 행의 값은 바꾸지 않는다.
ALTER TABLE public.activity_logs ALTER COLUMN log_date DROP NOT NULL;
ALTER TABLE public.activity_logs ALTER COLUMN log_date DROP DEFAULT;
