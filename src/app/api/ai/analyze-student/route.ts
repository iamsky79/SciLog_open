import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient as createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: requester } = await supabase
    .from("users")
    .select("role, is_admin")
    .eq("id", user.id)
    .single();

  if (!requester || (requester.role !== "teacher" && !requester.is_admin)) {
    return NextResponse.json({ error: "교사 또는 관리자만 사용 가능합니다." }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI 분석 기능이 설정되지 않았습니다. (ANTHROPIC_API_KEY 누락)" }, { status: 500 });
  }

  const { studentId } = await request.json() as { studentId: string };
  if (!studentId) {
    return NextResponse.json({ error: "studentId가 필요합니다." }, { status: 400 });
  }

  // 학생 데이터 수집
  const [
    { data: studentRow },
    { data: memberRows },
    { data: indivRows },
    { data: otherRows },
    { data: awardRows },
  ] = await Promise.all([
    supabaseAdmin.from("users").select("name, grade, class, number").eq("id", studentId).single(),
    supabaseAdmin.from("team_members").select("team_id").eq("student_id", studentId),
    supabaseAdmin
      .from("individual_research")
      .select("title, semester, field, plan_status, plan_motivation, plan_method, plan_expected")
      .eq("student_id", studentId),
    supabaseAdmin
      .from("other_activities")
      .select("title, subtype, content, result")
      .eq("student_id", studentId),
    supabaseAdmin
      .from("awards")
      .select("award_name, competition, grade, award_date")
      .eq("student_id", studentId),
  ]);

  const teamIds = (memberRows ?? []).map((m: { team_id: string }) => m.team_id);
  let teamsData: { name: string; type: string; field: string | null }[] = [];
  if (teamIds.length > 0) {
    const { data: tRows } = await supabaseAdmin
      .from("teams")
      .select("name, type, field")
      .in("id", teamIds);
    teamsData = (tRows ?? []) as typeof teamsData;
  }

  // 활동기록 내용 수집 (최신 10개)
  const { data: logRows } = await supabaseAdmin
    .from("activity_logs")
    .select("log_date, activity_content, goal, result, conclusion")
    .eq("author_id", studentId)
    .in("status", ["approved", "submitted", "pending", "historical"])
    .order("log_date", { ascending: false, nullsFirst: false })
    .limit(10);

  // 프롬프트 구성
  const student = studentRow as { name: string; grade: number | null; class: string | null; number: number | null } | null;
  const studentInfo = student
    ? `이름: ${student.name}, 학년: ${student.grade ?? "미상"}학년 ${student.class ?? ""}반 ${student.number ?? ""}번`
    : `학생 ID: ${studentId}`;

  const teamsText = teamsData.length > 0
    ? teamsData.map((t) => `- ${t.type === "rne" ? "R&E" : "동아리"}: ${t.name}${t.field ? ` (${t.field})` : ""}`).join("\n")
    : "없음";

  const indivText = (indivRows ?? []).length > 0
    ? (indivRows ?? []).map((r: { title: string; semester: string; field: string | null; plan_status: string; plan_motivation: string | null; plan_method: string | null; plan_expected: string | null }) =>
        `- ${r.title} (${r.semester}, 상태: ${r.plan_status})\n  동기: ${r.plan_motivation ?? "-"}\n  방법: ${r.plan_method ?? "-"}\n  기대효과: ${r.plan_expected ?? "-"}`
      ).join("\n")
    : "없음";

  const otherText = (otherRows ?? []).length > 0
    ? (otherRows ?? []).map((o: { title: string; subtype: string; content: string | null; result: string | null }) =>
        `- ${o.title} (${o.subtype}): ${o.content ?? "-"} → ${o.result ?? "-"}`
      ).join("\n")
    : "없음";

  const awardsText = (awardRows ?? []).length > 0
    ? (awardRows ?? []).map((a: { award_name: string; competition: string | null; grade: string | null; award_date: string | null }) =>
        `- ${a.award_name} (${a.competition ?? ""}, ${a.grade ?? ""}, ${a.award_date ?? ""})`
      ).join("\n")
    : "없음";

  const logsText = (logRows ?? []).length > 0
    ? (logRows ?? []).map((l: { log_date: string | null; activity_content: string | null; goal: string | null; result: string | null; conclusion: string | null }) =>
        `[${l.log_date ?? "날짜 미상"}] ${l.activity_content ?? l.goal ?? ""} / 결과: ${l.result ?? "-"}`
      ).join("\n")
    : "없음";

  // 학교 유형(예: "과학고", "영재학교")은 배포마다 다르므로 환경변수로 바꿀 수 있다.
  const schoolLabel = process.env.SCHOOL_LABEL?.trim() || "고등학교";
  const prompt = `다음은 ${schoolLabel} 학생의 연구 활동 기록입니다.

[학생 정보]
${studentInfo}

[팀 활동 (R&E / 동아리)]
${teamsText}

[창의개인연구]
${indivText}

[기타 활동]
${otherText}

[수상 실적]
${awardsText}

[최근 활동 기록]
${logsText}

아래 항목을 분석해주세요. 반드시 JSON 형식으로만 응답하세요:

{
  "career_direction": "진로 방향 및 관심 분야 분석",
  "strengths": "연구의 강점",
  "weaknesses": "연구의 약점 및 보완점",
  "future_direction": "앞으로의 연구 방향 제안",
  "guidance_points": "지도 시 주목할 점"
}

한국어로 답변하세요. JSON 외의 다른 텍스트는 포함하지 마세요.`;

  const client = new Anthropic({ apiKey });
  let message;
  try {
    message = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? e.message : "AI 서비스 호출 실패";
    return NextResponse.json({ error: `AI 분석 요청 실패: ${msg}` }, { status: 502 });
  }

  const rawText = message.content[0].type === "text" ? message.content[0].text : "";
  let analysisContent: AiAnalysis["content"];
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    analysisContent = JSON.parse(jsonMatch?.[0] ?? rawText);
  } catch {
    return NextResponse.json({ error: "AI 응답 파싱 실패" }, { status: 500 });
  }

  const { data: saved, error: saveError } = await supabaseAdmin
    .from("ai_analyses")
    .insert({
      student_id: studentId,
      content: analysisContent,
      created_by: user.id,
    })
    .select()
    .single();

  if (saveError || !saved) {
    return NextResponse.json({ error: "분석 결과 저장 실패" }, { status: 500 });
  }

  return NextResponse.json({ analysis: saved });
}

interface AiAnalysis {
  id: string;
  student_id: string;
  content: {
    career_direction: string;
    strengths: string;
    weaknesses: string;
    future_direction: string;
    guidance_points: string;
  };
  created_by: string | null;
  created_at: string;
}
