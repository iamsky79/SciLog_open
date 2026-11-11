-- 결과보고서 제출 일정 관리 테이블
CREATE TABLE IF NOT EXISTS report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  entity_type text,          -- null=전체; 'rne'|'club'|'individual'
  entity_id uuid,            -- null=유형 전체; 특정 팀/개인 ID
  deadline timestamptz NOT NULL,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- research_reports에 늦은 제출 여부 및 일정 참조 컬럼 추가
ALTER TABLE research_reports
  ADD COLUMN IF NOT EXISTS is_late boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES report_schedules(id);

-- 관리자만 report_schedules CRUD 가능
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage report_schedules"
  ON report_schedules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "authenticated can view report_schedules"
  ON report_schedules
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
