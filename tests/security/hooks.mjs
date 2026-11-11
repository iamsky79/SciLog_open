// 보안 회귀 테스트용 모듈 로더 — 서버 API(route.ts)를 실제 코드 그대로 import하되 supabase 클라이언트만 목으로 바꾼다.
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(ROOT, "src") + path.sep;

export async function resolve(spec, ctx, next) {
  if (spec === "@/lib/supabase-server") return { url: pathToFileURL(path.join(HERE, "mock_server.mjs")).href, shortCircuit: true };
  if (spec === "@/lib/supabase-admin") return { url: pathToFileURL(path.join(HERE, "mock_admin.mjs")).href, shortCircuit: true };
  if (spec === "next/server") return { url: pathToFileURL(path.join(ROOT, "node_modules/next/server.js")).href, shortCircuit: true };
  if (spec.startsWith("@/")) {
    const file = SRC + spec.slice(2) + ".ts";
    if (fs.existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return next(spec, ctx);
}
