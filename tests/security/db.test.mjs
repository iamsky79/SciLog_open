import { PGlite } from "@electric-sql/pglite";
// 048 보안 migration 회귀 테스트 — 운영 DB가 아니라 격리된 로컬 Postgres(PGlite)에 실제 migration SQL을 적용해 검증한다.
// 실행: npm run test:security
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations") + path.sep;
const read = (f) => fs.readFileSync(REPO + f, "utf8");
// $$ 블록 안의 세미콜론을 무시하고 SQL을 문장으로 나눈다.
function split(sql) {
  sql = sql.replace(/--[^\n]*/g, ""); const out = []; let cur = "", inD = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith("$$", i)) { inD = !inD; cur += "$$"; i++; continue; }
    if (sql[i] === ";" && !inD) { out.push(cur.trim()); cur = ""; continue; }
    cur += sql[i];
  }
  if (cur.trim()) out.push(cur.trim()); return out.filter(Boolean);
}
const pick = (file, re) => { const m = split(read(file)).filter((s) => re.test(s)); if (!m.length) throw new Error("not found " + re + " in " + file); return m; };
const db = new PGlite();
let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(cond ? "PASS" : "FAIL", name, extra);
};

// ── 격리 DB 준비: Supabase 역할/auth 스텁 + 실제 migration의 users 관련 SQL만 추출해 적용 ──
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create function public.is_supervising_teacher(uuid) returns boolean language sql stable as $$ select false $$;
`);
for (const s of pick("001_init.sql", /create type user_role/i)) await db.exec(s);
for (const s of pick("001_init.sql", /create table if not exists public\.users/i)) await db.exec(s);
for (const s of pick("001_init.sql", /alter table public\.users enable row level security/i)) await db.exec(s);
for (const s of pick("001_init.sql", /function public\.is_admin_or_viewer/i)) await db.exec(s);
for (const s of pick("005_add_username.sql", /alter table public\.users add column/i)) await db.exec(s);
for (const name of ["users_select", "users_insert_self", "users_update", "users_delete_admin"])
  for (const s of pick("001_init.sql", new RegExp(`create policy "${name}" on public\\.users`, "i"))) await db.exec(s);
for (const s of pick("002_handle_new_user.sql", /create or replace function public\.handle_new_user/i)) await db.exec(s);
for (const s of pick("002_handle_new_user.sql", /create trigger on_auth_user_created/i)) await db.exec(s);
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role; grant all on all functions in schema public to anon, authenticated, service_role;`);

const U = { stu: "00000000-0000-0000-0000-000000000001", tea: "00000000-0000-0000-0000-000000000002", adm: "00000000-0000-0000-0000-000000000003", adm2: "00000000-0000-0000-0000-000000000004", vwr: "00000000-0000-0000-0000-000000000005", stu2: "00000000-0000-0000-0000-000000000006" };
const as = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, affected: r.affectedRows }; }
  catch (e) { return { ok: false, code: e.code, msg: String(e.message) }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
};
const q = async (sql, p) => (await db.query(sql, p)).rows;
const signup = async (id, role) => { await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)`, [id, id + "@x.local", JSON.stringify(role === undefined ? { name: "n" } : { name: "n", role })]); return (await q(`select role,is_admin from public.users where id=$1`, [id]))[0]; };
const seed = async () => { // 기존 계정(운영 상황 재현): 학생/교사/관리자2명/레거시 viewer
  for (const [id, role, adm] of [[U.stu, "student", false], [U.tea, "teacher", false], [U.adm, "teacher", true], [U.adm2, "teacher", true], [U.vwr, "viewer", false], [U.stu2, "student", false]]) {
    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,'{}')`, [id, id + "@x.local"]);
    await db.query(`update public.users set role=$2, is_admin=$3, name=$4 where id=$1`, [id, role, adm, "u" + id.slice(-1)]);
  }
};

// ════ PHASE A — 패치 전(취약점 재현, 격리 DB) ════
console.log("=== PHASE A: BEFORE 048 (vulnerability reproduction on isolated DB) ===");
const a1 = await signup("10000000-0000-0000-0000-000000000001", "viewer");
check("A1 (before) signup role=viewer is trusted -> viewer", a1.role === "viewer", JSON.stringify(a1));
const a2 = await signup("10000000-0000-0000-0000-000000000002", "teacher");
check("A2 (before) signup role=teacher is trusted -> teacher", a2.role === "teacher");
check("A3 (before) viewer passes is_admin_or_viewer()", (await as("authenticated", "10000000-0000-0000-0000-000000000001", "select public.is_admin_or_viewer() as ok")).rows[0].ok === true);
await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'s@x','{}')`, [U.stu]);
const a4 = await as("authenticated", U.stu, "update public.users set is_admin=true where id=$1 returning is_admin", [U.stu]);
check("A4 (before) student can set own is_admin=true", a4.ok && a4.rows[0]?.is_admin === true);
await db.exec("truncate public.users, auth.users cascade");

// ════ 데이터 불변 검증용 사전 상태 ════
await seed();
const snapshot = async () => crypto.createHash("sha256").update(JSON.stringify(await q(`select id,role,is_admin,name,username,password_changed from public.users order by id`))).digest("hex");
const before = await snapshot(); const beforeCount = (await q("select count(*)::int c from public.users"))[0].c;

// ════ 048 적용(파일 그대로) ════
const m048 = read("048_security_privilege_escalation.sql");
await db.exec(m048); await db.exec(m048); // 두 번 적용해도 안전한지(idempotent)
await db.exec(`grant all on all tables in schema public to anon, authenticated, service_role;`);
const after = await snapshot(); const afterCount = (await q("select count(*)::int c from public.users"))[0].c;
console.log("\n=== PHASE B: AFTER 048 ===");
check("B0 migration changes no existing rows (users hash + count identical; legacy viewer untouched)", before === after && beforeCount === afterCount && (await q(`select role from public.users where id=$1`, [U.vwr]))[0].role === "viewer");

// 1~2. signup role 강제
for (const [i, role] of [["1", "viewer"], ["2", "teacher"], ["3", "student"], ["4", undefined], ["5", "admin"], ["6", "garbage"]]) {
  const r = await signup(`20000000-0000-0000-0000-00000000000${i}`, role);
  check(`1/2 signup metadata role=${role} -> student, is_admin=false`, r.role === "student" && r.is_admin === false, JSON.stringify(r));
}
// 3. 일반 필드 self 수정
const t3 = await as("authenticated", U.stu, "update public.users set username=$2, password_changed=true, name=$3 where id=$1 returning username,password_changed", [U.stu, "19테스트", "새이름"]);
check("3 student can update own normal profile fields (username/password_changed/name)", t3.ok && t3.rows[0]?.password_changed === true && t3.rows[0]?.username === "19테스트");
// 4~6. role / is_admin 변경 거부
const t4 = await as("authenticated", U.stu, "update public.users set role='viewer' where id=$1", [U.stu]);
check("4 student role update rejected", !t4.ok && t4.code === "42501", t4.msg);
const t5 = await as("authenticated", U.stu, "update public.users set is_admin=true where id=$1", [U.stu]);
check("5 student is_admin update rejected", !t5.ok && t5.code === "42501", t5.msg);
const t5b = await as("authenticated", U.stu, "update public.users set role='teacher', is_admin=true where id=$1", [U.stu]);
check("5b student combined role+is_admin rejected", !t5b.ok && t5b.code === "42501");
const t6a = await as("authenticated", U.tea, "update public.users set is_admin=true where id=$1", [U.tea]);
const t6b = await as("authenticated", U.tea, "update public.users set role='viewer' where id=$1", [U.tea]);
check("6 teacher self is_admin / role update rejected", !t6a.ok && !t6b.ok && t6a.code === "42501" && t6b.code === "42501");
check("6b rejected updates left rows unchanged", (await q(`select role,is_admin from public.users where id in ($1,$2) order by id`, [U.stu, U.tea])).every((r) => r.is_admin === false));
// 같은 값으로의 no-op UPDATE(예: 앱이 전체 객체를 다시 저장하는 경우)는 허용
const t6c = await as("authenticated", U.stu, "update public.users set name=$2, role='student', is_admin=false where id=$1 returning name", [U.stu, "동일값"]);
check("6c update that keeps role/is_admin unchanged is allowed", t6c.ok && t6c.rows[0]?.name === "동일값");
// 7. viewer는 관리자 권한 없음
check("7a viewer does NOT pass is_admin_or_viewer()", (await as("authenticated", U.vwr, "select public.is_admin_or_viewer() as ok")).rows[0].ok === false);
check("7b admin passes is_admin_or_viewer()", (await as("authenticated", U.adm, "select public.is_admin_or_viewer() as ok")).rows[0].ok === true);
const v1 = await as("authenticated", U.vwr, "update public.users set name='x' where id=$1 returning id", [U.stu2]);
const v2 = await as("authenticated", U.vwr, "delete from public.users where id=$1 returning id", [U.stu2]);
const v3 = await as("authenticated", U.vwr, "select count(*)::int c from public.users");
check("7c viewer cannot update/delete other users, sees only itself", v1.ok && v1.rows.length === 0 && v2.ok && v2.rows.length === 0 && v3.rows[0].c === 1, JSON.stringify({ u: v1.rows?.length, d: v2.rows?.length, seen: v3.rows?.[0]?.c }));
const v4 = await as("authenticated", U.vwr, "update public.users set is_admin=true where id=$1", [U.vwr]);
check("7d viewer self-promotion to admin rejected", !v4.ok && v4.code === "42501");
// admin 정상 기능(RLS 경유)
const ad1 = await as("authenticated", U.adm, "update public.users set name=$2 where id=$1 returning name", [U.stu2, "관리자수정"]);
const ad2 = await as("authenticated", U.adm, "select count(*)::int c from public.users");
check("7e admin can still update other users' normal fields and see all users", ad1.ok && ad1.rows[0]?.name === "관리자수정" && ad2.rows[0].c >= 6);
const ad3 = await as("authenticated", U.adm, "update public.users set is_admin=true where id=$1", [U.tea]);
check("7f even admin browser requests cannot change role/is_admin directly (must use server API)", !ad3.ok && ad3.code === "42501");
// 12. 직접 INSERT 우회
const i1 = await as("authenticated", "30000000-0000-0000-0000-000000000001", "insert into public.users (id,email,name,role,is_admin) values ($1,'i1@x','n','teacher',true)", ["30000000-0000-0000-0000-000000000001"]);
const i2 = await as("authenticated", "30000000-0000-0000-0000-000000000002", "insert into public.users (id,email,name,is_admin) values ($1,'i2@x','n',true)", ["30000000-0000-0000-0000-000000000002"]);
check("12a client INSERT of own row with role/is_admin elevated is rejected", !i1.ok && !i2.ok, (i1.msg || "").slice(0, 60));
await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ('30000000-0000-0000-0000-000000000003','i3@x','{}')`);
await db.query(`delete from public.users where id='30000000-0000-0000-0000-000000000003'`);
const i3 = await as("authenticated", "30000000-0000-0000-0000-000000000003", "insert into public.users (id,email,name) values ($1,'i3@x','n') returning role,is_admin", ["30000000-0000-0000-0000-000000000003"]);
check("12b client INSERT with defaults still allowed (-> student)", i3.ok && i3.rows[0]?.role === "student" && i3.rows[0]?.is_admin === false);
// 13. 서비스 경로(createAccount의 upsert)는 정상
const sv = await as("service_role", null, `insert into public.users (id,email,name,role) values ('00000000-0000-0000-0000-000000000006','x','n','teacher') on conflict (id) do update set role='teacher' returning role`);
check("13 service_role upsert can set role (createAccount path)", sv.ok && sv.rows[0]?.role === "teacher");
await db.query(`update public.users set role='student' where id=$1`, [U.stu2]); // 원복(postgres 경로도 허용되는지 겸사)
check("13b postgres/SQL-editor path can change role", (await q(`select role from public.users where id=$1`, [U.stu2]))[0].role === "student");
// 8~11. 관리자 권한 변경 함수
const exe = async (role, uid, target, make) => as(role, uid, "select public.set_user_admin($1,$2)", [target, make]);
check("9a authenticated student cannot call set_user_admin", !(await exe("authenticated", U.stu, U.tea, true)).ok && (await exe("authenticated", U.stu, U.tea, true)).code === "42501");
check("9b authenticated admin (browser) cannot call set_user_admin either (server-only)", (await exe("authenticated", U.adm, U.tea, true)).code === "42501");
check("9c anon cannot call set_user_admin", (await exe("anon", null, U.tea, true)).code === "42501");
const g = await exe("service_role", null, U.tea, true);
check("8a service_role can grant admin to a teacher", g.ok && (await q(`select is_admin from public.users where id=$1`, [U.tea]))[0].is_admin === true);
check("11a non-teacher cannot be made admin (NOT_TEACHER)", (await exe("service_role", null, U.stu2, true)).msg.includes("NOT_TEACHER"));
check("11b unknown target -> NOT_FOUND", (await exe("service_role", null, "99999999-0000-0000-0000-000000000009", true)).msg.includes("NOT_FOUND"));
const r1 = await exe("service_role", null, U.tea, false);
check("8b service_role can revoke admin when others remain", r1.ok && (await q(`select is_admin from public.users where id=$1`, [U.tea]))[0].is_admin === false);
// 10. 마지막 관리자 보호 (현재 관리자: adm, adm2)
const r2 = await exe("service_role", null, U.adm2, false);
check("10a revoke one of two admins ok", r2.ok);
const r3 = await exe("service_role", null, U.adm, false);
check("10b revoking the LAST admin is rejected (LAST_ADMIN)", !r3.ok && r3.msg.includes("LAST_ADMIN") && (await q(`select is_admin from public.users where id=$1`, [U.adm]))[0].is_admin === true);
const r4 = await exe("service_role", null, U.stu2, false);
check("10c revoking a non-admin when only one admin remains is harmless", r4.ok);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
