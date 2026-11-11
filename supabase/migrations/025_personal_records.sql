-- 나의 연구 기록 (개인 성찰): 학생 본인이 작성하는 연구 동기/역할/배운 점/어려움
CREATE TABLE IF NOT EXISTS public.personal_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,  -- 'rne' | 'club' | 'individual'
  entity_id uuid NOT NULL,
  student_id uuid REFERENCES public.users(id),
  motivation text,        -- 연구 동기
  my_role text,           -- 나의 역할 (개인연구는 "나의 접근 방식")
  lessons_learned text,   -- 배운 점/느낀 점
  challenges text,        -- 어려웠던 점과 해결 과정
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_type, entity_id, student_id)
);

-- 개인 일지 구분 컬럼: 'team'(팀 공동 일지, 기본값) | 'personal'(매일 쓰는 개인 일지)
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS log_type text DEFAULT 'team';
