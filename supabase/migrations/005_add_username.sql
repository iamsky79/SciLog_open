-- username 컬럼 추가
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text UNIQUE;

-- 번호 컬럼 추가 (학생: 반에서 출석번호)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS number int;

-- 초기 비밀번호 사용 여부 추적
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_changed boolean DEFAULT false;

-- 기존 김선아 교사 username 설정
UPDATE public.users
SET username = 't김선아'
WHERE name = '김선아' AND role = 'teacher';
