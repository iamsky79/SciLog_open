-- 009_add_storage.sql
-- activity-files 버킷 생성
INSERT INTO storage.buckets (id, name, public)
VALUES ('activity-files', 'activity-files', true)
ON CONFLICT DO NOTHING;

-- 인증된 사용자는 업로드 가능
CREATE POLICY "team members can upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'activity-files' AND auth.role() = 'authenticated');

-- 누구나 읽기 가능 (public 버킷)
CREATE POLICY "anyone can read activity files" ON storage.objects
  FOR SELECT USING (bucket_id = 'activity-files');

-- 본인이 올린 파일(경로 첫 번째 세그먼트 = uid)만 삭제 가능
CREATE POLICY "author can delete own files" ON storage.objects
  FOR DELETE USING (bucket_id = 'activity-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- activity_logs 테이블에 file_urls 컬럼 추가
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS file_urls jsonb DEFAULT '[]';
