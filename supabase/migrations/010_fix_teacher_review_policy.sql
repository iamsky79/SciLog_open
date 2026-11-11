-- activity_logs UPDATE 정책: 교사가 자신이 담당하는 팀/연구의 로그를
-- 검토(status + teacher_feedback)할 수 있도록 보장.
-- migration 003에서 추가되어야 했으나 미적용 시 대비용 idempotent 재적용.

alter table public.activity_logs add column if not exists teacher_feedback text;

drop policy if exists "activity_logs_update" on public.activity_logs;
create policy "activity_logs_update" on public.activity_logs
  for update
  using (
    author_id = auth.uid()
    or (public.is_teacher() and public.can_access_entity(entity_type, entity_id))
    or public.is_admin_or_viewer()
  )
  with check (
    author_id = auth.uid()
    or (public.is_teacher() and public.can_access_entity(entity_type, entity_id))
    or public.is_admin_or_viewer()
  );
