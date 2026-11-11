-- 036에서 submission-pdfs를 public 버킷 + "누구나 읽기" SELECT policy로 만들었는데,
-- 이 버킷은 학생의 실제 제출 PDF(성적/평가와 연결되는 민감 자료)를 보관하므로
-- "URL만 알면 로그인 없이도 읽을 수 있는" 구조는 부적절하다. 036은 이미
-- production에 적용되어 실행 중이므로(버킷·정책 3개 모두 생성 확인됨) 그 파일을
-- 다시 쓰지 않고, 이 후속 migration에서 안전하게 덮어쓴다.
--
-- 방향:
--   - 버킷을 private으로 전환한다(기존 오브젝트는 삭제/이동하지 않는다).
--   - "누구나 SELECT" 정책을 없애고, "본인이 올린 파일만 SELECT/INSERT/DELETE"
--     정책으로 좁힌다 — Storage RLS로는 팀/개인연구 소유권·담당교사 같은 복잡한
--     join을 안정적으로 표현하기 어렵기 때문에, 그 부분은 여기서 새로 만들지 않는다.
--   - 교사/관리자 등 "본인이 아닌 사람"의 열람은 storage RLS가 아니라
--     서버 API(/api/submissions/pdf-signed-url)에서 처리한다. 이 API는
--     research_reports SELECT가 되는지(=034의 "교사는 전체 학생 조회 가능" 정책
--     때문에 담당 아닌 교사도 통과해버림)로 판단하지 않고, submission_snapshots가
--     이미 쓰는 can_access_submission_source()(033, security definer — 관리자 또는
--     실제 팀 담당교사/팀원 또는 개인연구 실제 student_id/teacher_id 본인만 통과)를
--     그대로 재사용해 "실제 담당 관계"만 통과시킨다. 새 권한 로직을 추가하지 않고
--     이미 검증된 함수를 그대로 쓰는 방식이다.
--   - DELETE는 다른 버킷(activity-files/reports, 009/016)과 똑같이 "본인 uid
--     namespace만" 허용한다 — 재제출 자체는 항상 새 timestamp 경로에 새로 올릴 뿐
--     기존 파일을 지우지 않으므로(src/components/ReportSection.tsx) 이 정책이
--     snapshot/버전 이력을 깨뜨리지 않는다. 실제로 이 delete 권한이 쓰이는 곳은
--     "연구/팀 전체를 삭제할 때의 정리"뿐이다(개인연구 삭제는 본인 세션으로,
--     팀 삭제는 관리자 API가 service role로 수행 — 둘 다 RLS와 무관하게 이미
--     안전하게 스코프돼 있다).

update storage.buckets
set public = false,
    allowed_mime_types = array['application/pdf'],
    file_size_limit = 52428800
where id = 'submission-pdfs';

drop policy if exists "authenticated users can upload submission pdfs" on storage.objects;
drop policy if exists "anyone can read submission pdfs" on storage.objects;
drop policy if exists "uploader can delete own submission pdf" on storage.objects;

-- 업로드 경로는 항상 "{업로더 uid}/{entityType}/{entityId}/{timestamp_filename}"
-- 형태다(ReportSection.tsx) — 그 첫 segment가 본인 uid와 같을 때만 쓰기를 허용해,
-- 학생 A가 학생 B의 uid 하위 경로에 파일을 만들 수 없게 한다.
create policy "owner can upload own submission pdf" on storage.objects
  for insert
  with check (bucket_id = 'submission-pdfs' and auth.uid()::text = (storage.foldername(name))[1]);

-- 본인이 올린 파일은 (signed URL 없이도) 직접 읽을 수 있다 — 학생이 자기 제출물을
-- 보는 가장 흔한 경로를 굳이 서버 API를 거치게 만들 필요는 없다. 담당 교사/관리자
-- 등 "본인이 아닌 사람"의 열람은 이 정책을 통과하지 못하므로, 반드시 서버 API가
-- 발급하는 signed URL(위 설명 참고)을 거쳐야 한다.
create policy "owner can read own submission pdf" on storage.objects
  for select
  using (bucket_id = 'submission-pdfs' and auth.uid()::text = (storage.foldername(name))[1]);

-- 연구/팀 삭제 시 정리(개인연구 삭제 화면, 팀 삭제 관리자 API)를 위한 최소 delete
-- 권한 — 다른 버킷과 동일한 "본인 uid namespace만" 규칙.
create policy "owner can delete own submission pdf" on storage.objects
  for delete
  using (bucket_id = 'submission-pdfs' and auth.uid()::text = (storage.foldername(name))[1]);
