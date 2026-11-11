// 메모리 안의 최소 Supabase 조회 빌더 — hub.ts가 쓰는 select/eq/neq/in/or/order만 지원한다.
function splitTop(expr) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function condition(term) {
  const m = term.match(/^(\w+)\.(eq|in)\.(.*)$/);
  if (!m) throw new Error("unsupported filter: " + term);
  const [, col, op, raw] = m;
  if (op === "eq") return (r) => String(r[col]) === raw;
  const list = raw.replace(/^\(|\)$/g, "").split(",");
  return (r) => list.includes(String(r[col]));
}

function orPredicate(expr) {
  const groups = splitTop(expr).map((g) => {
    const inner = g.match(/^and\((.*)\)$/);
    const conds = splitTop(inner ? inner[1] : g).map(condition);
    return (r) => conds.every((c) => c(r));
  });
  return (r) => groups.some((g) => g(r));
}

class Query {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
    this.sort = null;
  }
  select() { return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  neq(col, val) { this.filters.push((r) => r[col] !== val); return this; }
  in(col, vals) { this.filters.push((r) => vals.includes(r[col])); return this; }
  or(expr) { this.filters.push(orPredicate(expr)); return this; }
  order(col, opts = {}) { this.sort = { col, asc: opts.ascending !== false }; return this; }
  then(resolve, reject) {
    let rows = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.sort) {
      const { col, asc } = this.sort;
      rows = [...rows].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] ?? "") > (b[col] ?? "") ? 1 : -1) * (asc ? 1 : -1));
    }
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}

export const createClient = () => ({
  from: (table) => new Query(globalThis.__db?.[table] ?? []),
});
