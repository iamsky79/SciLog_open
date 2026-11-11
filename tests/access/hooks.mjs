// 접근 범위 회귀 테스트용 모듈 로더 — 실제 hub.ts를 그대로 import하되 supabase 클라이언트만 메모리 가짜로 바꾼다.
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(path.resolve(HERE, "../.."), "src") + path.sep;

export async function resolve(spec, ctx, next) {
  if (spec === "@/lib/supabase") return { url: pathToFileURL(path.join(HERE, "fake_supabase.mjs")).href, shortCircuit: true };
  if (spec.startsWith("@/")) {
    const file = SRC + spec.slice(2) + ".ts";
    if (fs.existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return next(spec, ctx);
}
