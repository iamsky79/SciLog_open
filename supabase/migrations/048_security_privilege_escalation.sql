-- P0 보안 패치: 학생/교사/외부 가입자가 스스로 viewer/admin으로 승격하는 경로 차단.
--
-- 배경(읽기 전용 audit 결과):
--  1) handle_new_user()가 가입 요청의 raw_user_meta_data.role을 그대로 public.users.role에 저장했다.
--     공개 가입은 누구나 호출할 수 있고 role은 클라이언트가 정하는 값이다.
--  2) is_admin_or_viewer()가 role='viewer'도 관리자와 같이 취급해, 거의 모든 테이블 정책(조회/입력/수정/삭제,
--     users 삭제 포함)이 viewer에게 관리자 권한을 줬다.
--  3) users_update 정책은 본인 행의 어떤 컬럼이든 수정하게 허용해서 role/is_admin을 직접 바꿀 수 있었다.
--
-- 이 migration은 기존 row(users.role, users.is_admin)를 전혀 바꾸지 않는다. 함수/트리거 정의만 바꾼다.
-- (기존 migration 파일은 수정하지 않고, 같은 이름의 함수를 create or replace로 덮어쓴다.)

-- ── 1. is_admin_or_viewer(): 관리자(is_admin=true)만 통과 ─────────────────────────────
-- 함수 이름은 기존 정책/함수(예: can_access_submission_source)와의 호환을 위해 유지한다.
-- viewer 역할은 더 이상 관리자 권한을 갖지 않는다(현재 viewer 계정 0명). 읽기 전용 viewer가 나중에 필요하면
-- 별도 설계로 SELECT 전용 정책을 명시적으로 만든다.
create or replace function public.is_admin_or_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and is_admin = true
  );
$$;

-- ── 2. handle_new_user(): 클라이언트가 보낸 role을 신뢰하지 않는다 ───────────────────────
-- 신규 가입(auth.users INSERT)은 항상 student로 만든다. 교사 계정은 관리자용 service-role API
-- (src/lib/create-account.ts)가 생성 직후 role을 upsert로 지정한다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── 3. public.users의 role / is_admin 보호 ───────────────────────────────────────────
-- PostgREST로 들어오는 브라우저 요청은 DB role이 authenticated(또는 anon)로 실행된다.
-- 그 경우에만 role/is_admin 변경(및 비정상 값으로의 INSERT)을 거부한다. service_role(서버 API),
-- postgres(SQL Editor/migration), SECURITY DEFINER 함수(소유자 postgres)는 영향받지 않는다.
-- 일반 self-service 컬럼(username, password_changed, name 등)의 본인 수정은 그대로 허용된다.
-- 트리거 함수는 SECURITY INVOKER여야 current_user가 "요청한 사람의 DB role"을 가리킨다.
create or replace function public.protect_users_privilege_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.role is distinct from 'student'::public.user_role or new.is_admin is distinct from false then
        raise exception 'role and is_admin cannot be set by client requests' using errcode = '42501';
      end if;
    elsif new.role is distinct from old.role or new.is_admin is distinct from old.is_admin then
      raise exception 'role and is_admin cannot be changed by client requests' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_users_privilege_columns on public.users;
create trigger protect_users_privilege_columns
  before insert or update on public.users
  for each row execute function public.protect_users_privilege_columns();

-- ── 4. 관리자 권한 부여/해제: 서버(service_role)만 호출하는 원자적 함수 ──────────────────
-- 브라우저가 public.users를 직접 UPDATE하지 않고 /api/admin/set-admin(서버)이 이 함수를 호출한다.
-- 마지막 관리자 해제를 같은 트랜잭션 안에서 막고(관리자 행을 잠가 동시 해제 경쟁도 방지),
-- 관리자 권한은 교사에게만 부여한다.
create or replace function public.set_user_admin(p_target uuid, p_make_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_is_admin boolean;
  v_admin_count integer;
begin
  -- 현재 관리자 행을 모두 잠가 동시에 두 명을 해제하는 경쟁을 직렬화한다.
  perform 1 from public.users where is_admin = true for update;

  select role, is_admin into v_role, v_is_admin from public.users where id = p_target for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_make_admin then
    if v_role <> 'teacher' then
      raise exception 'NOT_TEACHER' using errcode = 'P0001';
    end if;
    update public.users set is_admin = true where id = p_target;
  else
    if v_is_admin then
      select count(*) into v_admin_count from public.users where is_admin = true;
      if v_admin_count <= 1 then
        raise exception 'LAST_ADMIN' using errcode = 'P0001';
      end if;
    end if;
    update public.users set is_admin = false where id = p_target;
  end if;
end;
$$;

revoke all on function public.set_user_admin(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_user_admin(uuid, boolean) to service_role;
