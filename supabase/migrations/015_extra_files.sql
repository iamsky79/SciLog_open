-- 결과보고서 추가 첨부파일 지원
ALTER TABLE research_reports
  ADD COLUMN IF NOT EXISTS extra_file_urls text[] NOT NULL DEFAULT '{}';
