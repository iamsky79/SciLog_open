-- 기타 활동(other_activities)은 지도교사 개념이 없으므로, 교사는
-- 전체 기타 활동을 열람할 수 있어야 한다 (학생은 본인 것만).
drop policy if exists "other_activities_select" on public.other_activities;
create policy "other_activities_select" on public.other_activities
  for select
  using (
    student_id = auth.uid()
    or public.is_teacher()
    or public.is_admin_or_viewer()
  );
