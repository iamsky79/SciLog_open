-- 연구일지 구조 개선:
-- 1) "해석 및 판단" 필드는 기존 activity_logs 컬럼 중 의미가 겹치는 것이 없어 신규 추가.
--    (오늘의 연구 활동→experiment, 주요 결과 및 관찰→result, 문제점/특이사항→conclusion,
--     다음 활동과 그 이유→next_plan 은 기존 컬럼을 라벨만 바꿔 재사용하므로 컬럼 추가 불필요)
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS interpretation text;

-- 2) 연구일지(activity_logs) : 참여 학생 = 1 : N 관계.
--    참여자 등록 + 참여자별 역할(복수 선택) + 역할 설명을 하나의 관계 테이블로 관리.
--    (log_id, student_id) unique → 학생 1명당 연구일지 1개에 역할 row 1개.
CREATE TABLE IF NOT EXISTS public.activity_log_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES public.activity_logs(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  roles text[] NOT NULL DEFAULT '{}',
  role_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (log_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_log_participants_log_id ON public.activity_log_participants (log_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_participants_student_id ON public.activity_log_participants (student_id);

ALTER TABLE public.activity_log_participants ENABLE ROW LEVEL SECURITY;

-- 조회: 해당 연구일지에 접근 가능한 사람(팀원/담당교사/관리자) 또는 본인 참여 row.
-- can_access_entity()는 기존 activity_logs RLS와 동일하게 팀/개인연구 권한 구조를 재사용한다.
CREATE POLICY activity_log_participants_select ON public.activity_log_participants
  FOR SELECT USING (
    student_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.activity_logs al
      WHERE al.id = activity_log_participants.log_id
        AND public.can_access_entity(al.entity_type, al.entity_id)
    )
    OR public.is_admin_or_viewer()
  );

-- 등록: 본인을 참여자로 등록(팀 접근 권한 필요) 하거나,
-- 해당 연구일지의 작성자가 참여자 목록을 등록할 때 허용.
CREATE POLICY activity_log_participants_insert ON public.activity_log_participants
  FOR INSERT WITH CHECK (
    (
      student_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.activity_logs al
        WHERE al.id = log_id AND public.can_access_entity(al.entity_type, al.entity_id)
      )
    )
    OR EXISTS (SELECT 1 FROM public.activity_logs al WHERE al.id = log_id AND al.author_id = auth.uid())
    OR public.is_admin_or_viewer()
  );

-- 수정/삭제: 본인 역할 데이터만. 다른 학생의 역할은 수정할 수 없다.
CREATE POLICY activity_log_participants_update ON public.activity_log_participants
  FOR UPDATE USING (student_id = auth.uid() OR public.is_admin_or_viewer())
  WITH CHECK (student_id = auth.uid() OR public.is_admin_or_viewer());

CREATE POLICY activity_log_participants_delete ON public.activity_log_participants
  FOR DELETE USING (student_id = auth.uid() OR public.is_admin_or_viewer());
