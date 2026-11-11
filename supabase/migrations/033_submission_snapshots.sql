-- 조사 결과: research_plans/research_reports/individual_research(plan_*)는 팀·개인당
-- "행 1개"만 두고 제출/재제출 때마다 그 행을 UPDATE로 덮어쓴다. 별도의
-- version/snapshot/history 테이블이 전혀 없어서, 재제출이 일어나면 이전에 제출했던
-- 실제 내용(및 그에 대한 교사 피드백)이 영구히 사라진다 — "제출 당시 내용"을
-- 복원할 방법이 현재 스키마에는 없다(요청하신 사전 조사 결과 보고).
--
-- activity_logs(연구일지)는 다르다: 각 제출이 별도의 행이고, 검토 후(rejected)에는
-- 그 행을 다시 수정할 UI 경로가 없다(PENDING 상태일 때만 작성자 본인이 수정 가능).
-- 즉 연구일지는 이미 그 자체로 "제출 당시 내용"이 영구 보존되는 구조라 새 저장소가
-- 필요 없다 — 이번 스냅샷 테이블은 research_plans/research_reports/individual_research만 다룬다.
--
-- 최소 침습적 해법: 기존 3개 테이블/컬럼은 전혀 바꾸지 않고, "제출/재제출이 성공한
-- 순간의 내용"만 별도로 추가 기록하는 append-only 테이블을 하나 둔다. 어떤 제출인지는
-- 이미 검토 시스템(src/lib/review/actions.ts)이 쓰는 것과 동일한 (source_table, source_id)
-- 식별자를 그대로 재사용한다(테이블을 구분하는 문자열 자체가 이미 review actions의
-- ReviewDbTable 값과 같다) — 검토 Inbox와 완전히 같은 대상을 가리키게 하기 위함이다.

create table if not exists public.submission_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('research_plans', 'research_reports', 'individual_research')),
  source_id uuid not null,
  status text not null default 'submitted',
  feedback text,
  submitted_by uuid references public.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_submission_snapshots_source
  on public.submission_snapshots (source_table, source_id, submitted_at);

alter table public.submission_snapshots enable row level security;

-- 이미 있는 is_team_member/is_team_teacher/is_admin_or_viewer 헬퍼를 그대로 재사용해서
-- "이 스냅샷이 가리키는 원본 문서에 접근 가능한 사람"만 통과시킨다(원본 테이블과
-- 동일한 팀/개인 소유 규칙 — 새 권한 로직을 만들지 않는다).
create or replace function public.can_access_submission_source(p_source_table text, p_source_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_admin_or_viewer() then
    return true;
  end if;

  if p_source_table = 'research_plans' then
    return exists (
      select 1 from public.research_plans rp
      where rp.id = p_source_id
        and (
          (rp.team_id is not null and (public.is_team_member(rp.team_id) or public.is_team_teacher(rp.team_id)))
          or (rp.entity_type = 'individual' and exists (
                select 1 from public.individual_research ir
                where ir.id = rp.entity_id and (ir.student_id = auth.uid() or ir.teacher_id = auth.uid())
              ))
        )
    );
  elsif p_source_table = 'research_reports' then
    return exists (
      select 1 from public.research_reports rr
      where rr.id = p_source_id
        and (
          (rr.team_id is not null and (public.is_team_member(rr.team_id) or public.is_team_teacher(rr.team_id)))
          or (rr.entity_type = 'individual' and exists (
                select 1 from public.individual_research ir
                where ir.id = rr.entity_id and (ir.student_id = auth.uid() or ir.teacher_id = auth.uid())
              ))
        )
    );
  elsif p_source_table = 'individual_research' then
    return exists (
      select 1 from public.individual_research ir
      where ir.id = p_source_id and (ir.student_id = auth.uid() or ir.teacher_id = auth.uid())
    );
  end if;

  return false;
end;
$$;

create policy submission_snapshots_select on public.submission_snapshots
  for select using (public.can_access_submission_source(source_table, source_id));

-- 제출(insert) 시점의 작성자 본인이거나, 검토(update) 시점의 담당교사/관리자만 쓸 수 있다.
create policy submission_snapshots_insert on public.submission_snapshots
  for insert with check (public.can_access_submission_source(source_table, source_id));

create policy submission_snapshots_update on public.submission_snapshots
  for update using (public.can_access_submission_source(source_table, source_id))
  with check (public.can_access_submission_source(source_table, source_id));
