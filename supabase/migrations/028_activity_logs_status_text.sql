-- review_status ENUM에 'draft' 값을 추가하려다 백엔드 오류로 실패함.
-- research_plans/research_reports처럼 자유로운 상태값을 쓸 수 있도록
-- activity_logs.status를 enum 대신 plain text 컬럼으로 변경.
ALTER TABLE public.activity_logs ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.activity_logs ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.activity_logs ALTER COLUMN status SET DEFAULT 'pending';
