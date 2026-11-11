-- 기타 활동 유형에 "교내대회"를 추가한다(additive-only).
-- other_activity_subtype은 CHECK가 아니라 Postgres enum이라 새 값은
-- ALTER TYPE ... ADD VALUE로만 넣을 수 있고, 기존 값(external_competition/
-- performance/invention/idea)은 그대로 유지된다 — 기존 레코드는 전혀 건드리지 않는다.
--
-- enum ADD VALUE는 같은 트랜잭션에서 바로 사용하면 오래된 PG 버전에서 문제가 될 수
-- 있어(PG12 미만) 이 파일은 이 한 문장만 담아 041과 분리한다.
alter type other_activity_subtype add value if not exists 'internal_competition';
