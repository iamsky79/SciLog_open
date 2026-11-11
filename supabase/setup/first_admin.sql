-- 첫 관리자 계정 지정 (새로 설치할 때 한 번만 실행)
--
-- SciLog는 공개 회원가입이 없고, 모든 계정은 관리자가 만든다.
-- 그래서 처음 한 명의 관리자는 Supabase 대시보드에서 직접 만들어야 한다.
--
-- 1) Supabase 대시보드 > Authentication > Users > "Add user"
--    - 이메일과 비밀번호를 입력하고 "Auto Confirm User"를 체크한다.
--    - 이메일은 로그인에 쓰이지 않으므로 실제 주소가 아니어도 된다(예: admin@scilog.local).
--    - 이 시점에 트리거(handle_new_user)가 public.users에 student 행을 자동으로 만든다.
-- 2) 아래 v_email, v_username, v_name 값을 바꾼 뒤 SQL Editor에서 실행한다.
-- 3) 앱 로그인 화면에서 v_username과 1)에서 정한 비밀번호로 로그인한다.

do $$
declare
  v_email    text := 'admin@scilog.local';  -- 1)에서 입력한 이메일
  v_username text := 'admin';               -- 로그인 아이디
  v_name     text := '관리자';              -- 화면에 보일 이름
  v_count    int;
begin
  update public.users
     set role = 'teacher',
         is_admin = true,
         username = v_username,
         name = v_name,
         password_changed = true
   where email = v_email;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception '이메일 %인 사용자를 찾지 못했습니다. 1) 단계를 먼저 진행했는지 확인하세요.', v_email;
  end if;
end $$;
