-- 연구일지 임시저장을 위해 review_status enum에 'draft' 값 추가.
-- (activity_logs.status는 review_status enum이며 기존값은 approved/rejected/pending뿐이었음)
ALTER TYPE public.review_status ADD VALUE IF NOT EXISTS 'draft';
