-- "제출 본문 파일"은 PDF만 허용한다는 새 업로드 정책을 스토리지 레벨에서 강제한다.
--
-- 기존 "reports" 버킷은 결과보고서 본문 파일과 "추가 자료"(첨부파일, xlsx/png 등)가
-- 같은 버킷에 섞여 있어(ReportSection.tsx: primaryFile과 extraFiles 모두
-- reports/${entityType}/${entityId}/... 경로에 업로드) 버킷 전체를 PDF 전용으로
-- 제한하면 첨부파일 업로드가 깨진다. 그래서 버킷을 새로 하나 더 만들어 "제출 본문
-- 파일"만 여기로 옮기고, 버킷 자체의 allowed_mime_types로 PDF만 허용한다 —
-- 클라이언트 accept 속성만으로 막는 것보다 훨씬 강한 검증이다.
--
-- 기존 "reports" 버킷/파일은 전혀 건드리지 않는다 — 과거(레거시) doc/hwp 결과보고서
-- 파일은 그대로 남아 계속 다운로드 가능하다.
--
-- [2026-09-22 production 적용/검증 완료]
-- 버킷: public=true, allowed_mime_types=['application/pdf'], file_size_limit=52428800 확인.
-- 정책 3개를 일회용 테스트 계정 2개로 직접 검증 후 계정 삭제:
--   - INSERT: 로그인 사용자가 업로드 → 성공
--   - SELECT: storage 목록 조회로 파일 존재 확인 → 정상 공개 읽기
--   - DELETE: 다른 사용자가 삭제 시도 → 차단(파일 그대로 존재) /
--             소유자 본인이 삭제 → 정상 삭제됨
-- 세 정책 모두 의도대로 동작. 별도 조치 불필요.

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('submission-pdfs', 'submission-pdfs', true, array['application/pdf'], 52428800)
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

create policy "authenticated users can upload submission pdfs" on storage.objects
  for insert
  with check (bucket_id = 'submission-pdfs' and auth.role() = 'authenticated');

create policy "anyone can read submission pdfs" on storage.objects
  for select
  using (bucket_id = 'submission-pdfs');

create policy "uploader can delete own submission pdf" on storage.objects
  for delete
  using (bucket_id = 'submission-pdfs' and auth.uid()::text = (storage.foldername(name))[1]);
