// 관리자 권한 변경 API(/api/admin/set-admin)의 권한 검사 회귀 테스트 — `npm run test:security`
import "./register.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { POST } = await import(pathToFileURL(path.join(ROOT, "src/app/api/admin/set-admin/route.ts")).href);
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => {
  if (c) pass++;
  else fail++;
  console.log(c ? "PASS" : "FAIL", n, x);
};
const UID = "11111111-2222-3333-4444-555555555555";
const call = async (f, body) => { globalThis.__f = { rpcCalls: [], ...f }; const res = await POST(new Request("http://x/api/admin/set-admin", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) })); return { status: res.status, json: await res.json(), rpc: globalThis.__f.rpcCalls }; };
const admin = { user: { id: "a" }, requesterRow: { is_admin: true } };
let r = await call({ user: null }, { userId: UID, isAdmin: true });
check("unauthenticated -> 401, no privileged call", r.status === 401 && r.rpc.length === 0);
r = await call({ user: { id: "s" }, requesterRow: { is_admin: false } }, { userId: UID, isAdmin: true });
check("9: non-admin (student/teacher) -> 403, service-role never invoked", r.status === 403 && r.rpc.length === 0);
r = await call({ user: { id: "s" }, requesterRow: null }, { userId: UID, isAdmin: true });
check("9b: requester without profile row -> 403", r.status === 403 && r.rpc.length === 0);
r = await call({ user: { id: "s" }, requesterRow: { is_admin: false } }, { userId: UID, isAdmin: true, requesterIsAdmin: true, role: "admin" });
check("client-supplied admin claims in body are ignored -> still 403", r.status === 403 && r.rpc.length === 0);
r = await call({ user: { id: "s" }, requesterRow: { is_admin: "true" } }, { userId: UID, isAdmin: true });
check("is_admin must be boolean true (string 'true' rejected)", r.status === 403 && r.rpc.length === 0);
for (const [label, body] of [["bad uuid", { userId: "not-a-uuid", isAdmin: true }], ["non-boolean isAdmin", { userId: UID, isAdmin: "yes" }], ["missing", {}], ["invalid json", "{oops"]]) {
  r = await call(admin, body); check(`admin + ${label} -> 400, no service call`, r.status === 400 && r.rpc.length === 0);
}
r = await call(admin, { userId: UID, isAdmin: true });
check("8: admin grant -> 200 via set_user_admin(service role)", r.status === 200 && r.json.success && r.rpc.length === 1 && r.rpc[0].name === "set_user_admin" && r.rpc[0].args.p_target === UID && r.rpc[0].args.p_make_admin === true);
r = await call(admin, { userId: UID, isAdmin: false });
check("8b: admin revoke -> 200", r.status === 200 && r.rpc[0].args.p_make_admin === false);
r = await call({ ...admin, rpcError: { message: "LAST_ADMIN" } }, { userId: UID, isAdmin: false });
check("10: last admin revoke -> 409 with explanation", r.status === 409 && /마지막 관리자/.test(r.json.error));
r = await call({ ...admin, rpcError: { message: "NOT_TEACHER" } }, { userId: UID, isAdmin: true });
check("non-teacher grant -> 400", r.status === 400);
r = await call({ ...admin, rpcError: { message: "NOT_FOUND" } }, { userId: UID, isAdmin: true });
check("unknown target -> 404", r.status === 404);
r = await call({ ...admin, rpcError: { message: 'relation "x" internal secret detail' } }, { userId: UID, isAdmin: true });
check("unexpected DB error -> 500 generic message (no internals leaked)", r.status === 500 && !/secret|relation/.test(JSON.stringify(r.json)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
