-- R&E/동아리 팀에도 학기 구분을 추가해 포트폴리오 기간 표시("N학년도 (N학년 N학기)")를 통일한다.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS semester text DEFAULT '1';
