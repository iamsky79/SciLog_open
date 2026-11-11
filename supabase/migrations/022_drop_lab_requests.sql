-- 실험실 신청 기능 제거
drop policy if exists "lab_requests_select" on public.lab_requests;
drop policy if exists "lab_requests_insert" on public.lab_requests;
drop policy if exists "lab_requests_update" on public.lab_requests;
drop policy if exists "lab_requests_delete" on public.lab_requests;

drop index if exists public.idx_lab_requests_student_id;
drop index if exists public.idx_lab_requests_teacher_id;

drop table if exists public.lab_requests;
