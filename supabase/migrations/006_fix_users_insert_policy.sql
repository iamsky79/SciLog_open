-- handle_new_user() 트리거가 SECURITY DEFINER임에도 RLS를 우회하지 못하는 경우,
-- 함수 owner가 postgres(superuser, BYPASSRLS 보유)가 아닐 때 발생한다.
-- owner를 postgres로 강제 지정하면 트리거 실행 시 RLS를 완전히 우회한다.
-- supabaseAdmin(service_role) 클라이언트는 이미 BYPASSRLS이므로 별도 조치 불필요.
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
