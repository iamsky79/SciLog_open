// 교사 "제출물 관리" 조회 범위 회귀 테스트 — `npm run test:access`
// 정책: 학생=자기 것만(이 테스트 대상 아님), 교사=본인이 담당하는 연구(R&E/동아리/창의개인연구)의 제출물만, 관리자=전체.
// 학생 단위가 아니라 "연구 단위" ownership이라, 같은 학생의 다른 연구는 담당 교사가 다르면 보이지 않아야 한다.
import "./register.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { fetchTeacherSubmissionArchive } = await import(pathToFileURL(path.join(ROOT, "src/lib/submissions/hub.ts")).href);

let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(cond ? "PASS" : "FAIL", name, extra);
};

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S = id(1), S2 = id(2); // 학생
const TA = id(10), TB = id(11), TC = id(12), ADM = id(13); // 교사 A/B/C, 관리자
const RNE1 = id(20), CLUB1 = id(21), CLUB2 = id(22), CLUB0 = id(23); // 팀
const IND1 = id(30), IND2 = id(31); // 창의개인연구

const team = (tid, type, teacher) => ({ id: tid, type, name: `team-${tid.slice(-2)}`, teacher_id: teacher, school_year: "2026" });
const indiv = (iid, student, teacher) => ({
  id: iid, student_id: student, teacher_id: teacher, title: `indiv-${iid.slice(-2)}`, year: 2026, semester: "1-2",
  plan_status: "submitted", plan_feedback: null, plan_submitted_at: null, plan_reviewed_at: null,
  plan_motivation: "m", plan_method: "m", plan_expected: "e", plan_file_urls: [],
});
const plan = (pid, teamId) => ({ id: pid, team_id: teamId, entity_type: "team", entity_id: teamId, title: "p", motivation: "m", method: "m", expected_result: "e", status: "submitted", feedback: null, submitted_at: null, reviewed_at: null, updated_at: null, created_by: S });
const report = (rid, o) => ({ id: rid, team_id: null, entity_type: "team", entity_id: null, title: "r", summary: "s", introduction: null, conclusion: null, file_url: null, file_name: null, original_file_name: null, extra_file_urls: [], status: "submitted", feedback: null, submitted_at: null, reviewed_at: null, updated_at: null, created_by: S, ...o });
const log = (lid, entityType, entityId, author, o = {}) => ({ id: lid, entity_type: entityType, entity_id: entityId, author_id: author, log_date: null, title: "log", status: "pending", log_type: "team", goal: null, experiment: "e", result: null, interpretation: null, conclusion: null, next_plan: null, activity_content: null, achievement: null, free_memo: null, file_urls: [], teacher_feedback: null, display_order: 1, created_at: "2026-10-01T00:00:00Z", ...o });

globalThis.__db = {
  users: [S, S2, TA, TB, TC, ADM].map((u, i) => ({ id: u, name: ["학생A", "학생B", "교사A", "교사B", "교사C", "관리자"][i] })),
  // 학생A: R&E(교사A) + 동아리(교사B) + 창의개인연구(교사A). 학생B: 동아리(교사B), 개인연구(교사B), 담당 교사 없는 동아리.
  teams: [team(RNE1, "rne", TA), team(CLUB1, "club", TB), team(CLUB2, "club", TB), team(CLUB0, "club", null)],
  team_members: [{ team_id: RNE1, student_id: S }, { team_id: CLUB1, student_id: S }, { team_id: CLUB2, student_id: S2 }, { team_id: CLUB0, student_id: S2 }],
  individual_research: [indiv(IND1, S, TA), indiv(IND2, S2, TB)],
  research_plans: [plan(id(40), RNE1), plan(id(41), CLUB1), plan(id(42), CLUB2), plan(id(43), CLUB0)],
  research_reports: [
    report(id(50), { team_id: RNE1, entity_id: RNE1 }),
    report(id(51), { team_id: CLUB1, entity_id: CLUB1, status: "approved" }),
    report(id(52), { entity_type: "individual", entity_id: IND1 }),
    report(id(53), { entity_type: "individual", entity_id: IND2 }),
  ],
  activity_logs: [
    log(id(60), "team", RNE1, S), log(id(61), "team", CLUB1, S), log(id(62), "individual", IND1, S),
    log(id(63), "team", CLUB2, S2), log(id(64), "team", CLUB0, S2), log(id(65), "individual", IND2, S2),
    log(id(66), "team", RNE1, S, { log_type: "personal" }), // 개인 성찰 일지는 어느 교사에게도 보이지 않는다
  ],
  activity_log_participants: [],
  submission_snapshots: [],
};

const projectOf = (item) => item.href.split("?")[0].split("/")[2];
const ownerOf = { [RNE1]: TA, [CLUB1]: TB, [CLUB2]: TB, [CLUB0]: null, [IND1]: TA, [IND2]: TB };
const projects = (items) => new Set(items.map(projectOf));
const has = (set, ...ids) => ids.every((x) => set.has(x));
const none = (set, ...ids) => ids.every((x) => !set.has(x));

const a = await fetchTeacherSubmissionArchive(TA, false);
const b = await fetchTeacherSubmissionArchive(TB, false);
const c = await fetchTeacherSubmissionArchive(TC, false);
const adm = await fetchTeacherSubmissionArchive(ADM, true);

check("R&E 기준: 교사A는 학생A의 R&E 제출물을 본다", has(projects(a), RNE1));
check("개인연구 기준: 교사A는 본인 담당 창의개인연구(학생A) 제출물을 본다", has(projects(a), IND1));
check("같은 학생A의 동아리(교사B 담당)는 교사A에게 보이지 않는다", none(projects(a), CLUB1));
check("교사A는 다른 교사의 연구(동아리2/개인연구2/담당 없는 동아리)를 전혀 보지 못한다", none(projects(a), CLUB2, CLUB0, IND2));
check("동아리 기준: 교사B는 학생A의 동아리 제출물을 본다", has(projects(b), CLUB1));
check("같은 학생A의 R&E/개인연구(교사A 담당)는 교사B에게 보이지 않는다", none(projects(b), RNE1, IND1));
check("교사B는 본인 담당 동아리/개인연구(학생B)를 본다", has(projects(b), CLUB2, IND2));
check("담당 연구가 없는 교사C는 제출물이 0건", c.length === 0);
check("교사 목록의 모든 항목은 그 교사가 담당하는 연구의 것이다", [[TA, a], [TB, b]].every(([t, list]) => list.every((i) => ownerOf[projectOf(i)] === t)));
check("교사 목록의 모든 항목은 canReview=true(보이는 것은 곧 처리 가능한 것)", [...a, ...b].every((i) => i.canReview === true));
check("교사A/교사B 목록은 서로 겹치지 않는다", new Set([...a, ...b].map((i) => i.id)).size === a.length + b.length);
check("개인 성찰 일지(personal)는 교사 목록에 없다", ![...a, ...b, ...adm].some((i) => i.id.includes(id(66).slice(-12)) || (i.href ?? "").includes("log=" + id(66))));
check("관리자는 학교 전체(담당 교사 없는 동아리 포함)를 본다", has(projects(adm), RNE1, CLUB1, CLUB2, CLUB0, IND1, IND2));
check("교사A + 교사B 합집합 = 관리자 전체 − 담당 교사 없는 연구", a.length + b.length === adm.filter((i) => ownerOf[projectOf(i)]).length);
check("담당 교사가 없는 연구의 제출물은 관리자만 본다", adm.some((i) => projectOf(i) === CLUB0) && ![...a, ...b, ...c].some((i) => projectOf(i) === CLUB0));
const phases = (list) => list.reduce((m, i) => ({ ...m, [i.phase]: (m[i.phase] ?? 0) + 1 }), {});
check("상태별 탭 범위: 교사B의 승인 완료는 본인 담당(동아리1 보고서) 한 건뿐", phases(b).approved === 1 && b.filter((i) => i.phase === "approved").every((i) => projectOf(i) === CLUB1));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
