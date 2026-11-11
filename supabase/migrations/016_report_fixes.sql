-- 016_report_fixes.sql

-- 1. original_file_name 컬럼 추가 (누락된 컬럼)
ALTER TABLE public.research_reports
  ADD COLUMN IF NOT EXISTS original_file_name text;

-- 2. RLS 정책 교체: 창의개인연구 학생도 INSERT/UPDATE 가능하도록
DROP POLICY IF EXISTS "team members can manage reports" ON public.research_reports;

CREATE POLICY "members can manage reports" ON public.research_reports
  FOR ALL USING (
    -- R&E / 동아리: 팀원
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = research_reports.team_id
        AND tm.student_id = auth.uid()
    )
    -- 창의개인연구: 연구 소유 학생
    OR (
      research_reports.entity_type = 'individual'
      AND EXISTS (
        SELECT 1 FROM public.individual_research ir
        WHERE ir.id = research_reports.entity_id
          AND ir.student_id = auth.uid()
      )
    )
    -- 교사 / 관리자
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND (u.role = 'teacher' OR u.is_admin = true)
    )
  );

-- 3. reports 스토리지 버킷 생성
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT DO NOTHING;

-- 기존 정책 제거 후 재생성 (중복 방지)
DROP POLICY IF EXISTS "authenticated can upload reports" ON storage.objects;
DROP POLICY IF EXISTS "anyone can read reports"           ON storage.objects;
DROP POLICY IF EXISTS "uploader can delete reports"       ON storage.objects;

CREATE POLICY "authenticated can upload reports" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'reports' AND auth.role() = 'authenticated');

CREATE POLICY "anyone can read reports" ON storage.objects
  FOR SELECT USING (bucket_id = 'reports');

CREATE POLICY "uploader can delete reports" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'reports' AND auth.uid()::text = (storage.foldername(name))[1]
  );
