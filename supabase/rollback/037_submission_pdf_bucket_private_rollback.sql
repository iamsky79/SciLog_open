-- 037_submission_pdf_bucket_private.sql를 되돌리는 SQL — 지금 실행하지 않는다.
-- supabase/migrations/ 밖에 둬서 `supabase db push`가 이 파일을 자동으로 적용하지
-- 않도록 했다. 문제가 생겼을 때 Supabase 대시보드 SQL Editor에 수동으로 붙여넣어
-- 실행하는 용도다.
--
-- 주의: 이 rollback은 036이 만들었던 "누구나 읽기 가능"(public) 상태로 되돌린다 —
-- 즉 037로 막았던 문제(비로그인/타인이 URL만 알면 읽을 수 있음)가 다시 열린다.
-- "037 적용 후 문제가 생겼다"의 문제가 "권한 판정이 너무 막혀서 정상 사용자도
-- 못 받는다" 같은 가용성 문제라면, 이 전체 rollback보다는 pdf-signed-url API
-- (src/app/api/submissions/pdf-signed-url/route.ts)의 권한 조건만 임시로 완화하는
-- 편이 더 안전할 수 있다 — 이 파일은 "그래도 완전히 되돌려야 한다"는 판단이 섰을
-- 때만 쓴다.
--
-- 이 SQL은 storage.buckets/storage.objects 정책만 되돌리고, research_reports의
-- file_url 값(037 이후 저장된 값은 공개 URL이 아니라 storage path)은 건드리지
-- 않는다 — bucket을 다시 public으로 돌리면 그 path들도 다시
-- ".../object/public/submission-pdfs/{path}" 형태로 직접 접근 가능해진다
-- (Supabase가 public 버킷의 오브젝트를 그 경로로 서빙하기 때문).

update storage.buckets
set public = true,
    allowed_mime_types = array['application/pdf'],
    file_size_limit = 52428800
where id = 'submission-pdfs';

drop policy if exists "owner can upload own submission pdf" on storage.objects;
drop policy if exists "owner can read own submission pdf" on storage.objects;
drop policy if exists "owner can delete own submission pdf" on storage.objects;

-- 036이 만들었던 정책을 그대로 복원한다.
create policy "authenticated users can upload submission pdfs" on storage.objects
  for insert
  with check (bucket_id = 'submission-pdfs' and auth.role() = 'authenticated');

create policy "anyone can read submission pdfs" on storage.objects
  for select
  using (bucket_id = 'submission-pdfs');

create policy "uploader can delete own submission pdf" on storage.objects
  for delete
  using (bucket_id = 'submission-pdfs' and auth.uid()::text = (storage.foldername(name))[1]);
