import { NextResponse } from "next/server";
import { createClient as createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// submission-pdfs가 private 버킷으로 바뀌면서(037_submission_pdf_bucket_private.sql),
// "본인이 올린 파일"이 아닌 다른 사람(담당 교사/관리자 등)의 열람은 storage RLS 대신
// 이 API가 처리한다.
//
// 중요: research_reports에는 034_teacher_readonly_all_students.sql이 추가한
// "교사는 전체 학생 조회 가능"이라는 넓은 SELECT policy가 있다(포트폴리오 화면용).
// 그 policy를 그대로 믿고 "이 사용자가 research_reports 행을 SELECT할 수 있는가"만
// 검사하면, 담당하지 않는 학생의 제출 PDF까지 아무 교사에게나 signed URL을 내주게
// 된다 — 그래서 여기서는 research_reports 테이블 SELECT 성공 여부로 판단하지 않는다.
//
// 대신 submission_snapshots가 이미 쓰고 있는 can_access_submission_source()
// (033_submission_snapshots.sql, security definer)를 그대로 재사용한다. 이 함수는
// "관리자이거나, 실제 팀 담당교사(is_team_teacher)이거나, 실제 팀원이거나, 개인연구의
// 실제 student_id/teacher_id 본인인가"만 확인하고 034의 넓은 read policy는 전혀
// 참조하지 않으므로, "아무 교사"가 아니라 "이 학생/팀을 실제로 담당하는 교사"만
// 통과한다. 새 권한 로직을 만들지 않고 기존에 검증된 함수를 그대로 쓴다.
//
// path는 항상 "{업로더 uid}/{entityType}/{entityId}/{timestamp_filename}" 형태다
// (ReportSection.tsx가 이 규칙으로 저장). entityType/entityId는 재제출해도 바뀌지
// 않으므로, 이 검사는 과거 버전(snapshot) 파일에도 그대로 적용된다 — snapshot이
// 가리키는 report row가 이 report와 같기 때문이다.
//
// path는 클라이언트가 보내는 그대로 신뢰하지 않는다: entityType/entityId로 실제
// research_reports 행을 먼저 특정하고, 그 행에 대한 권한을 확인한 뒤에만 "그 경로
// 그대로"를 서명한다 — 권한이 없는 entityId를 끼워 넣어 다른 사람의 파일을 서명
// 받을 방법이 없다(요청한 경로가 그 entity의 실제 report와 무관하면애초에 report를
// 못 찾아 403).

const SIGNED_URL_TTL_SECONDS = 300;
const VALID_ENTITY_TYPES = ["rne", "club", "individual"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { path?: string } | null;
  const path = body?.path;
  if (!path || typeof path !== "string") {
    return NextResponse.json({ error: "path가 필요합니다." }, { status: 400 });
  }

  const segments = path.split("/");
  if (segments.length < 4) {
    return NextResponse.json({ error: "잘못된 경로입니다." }, { status: 400 });
  }
  const [, entityType, entityId] = segments;
  if (!VALID_ENTITY_TYPES.includes(entityType) || !UUID_RE.test(entityId)) {
    return NextResponse.json({ error: "잘못된 경로입니다." }, { status: 400 });
  }

  // 이 (entityType, entityId)에 해당하는 report가 실제로 존재하는지만 service role로
  // 확인한다 — "존재 여부"는 민감 정보가 아니고(민감한 건 파일 내용이다), 이 조회
  // 자체를 RLS로 걸러 최종 권한 판단에 쓰지 않는다(그러면 034의 넓은 read policy
  // 때문에 다시 같은 문제가 생긴다).
  const { data: report } = await supabaseAdmin
    .from("research_reports")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }

  // 실제 권한 판정 — 반드시 session-bound client로 호출해야 함수 안의 auth.uid()가
  // "지금 요청한 사용자"로 잡힌다(service role로 부르면 auth.uid()가 없어 관리자
  // 취급 로직만 타게 되므로 의미가 없다).
  const { data: allowed, error: rpcError } = await supabase.rpc("can_access_submission_source", {
    p_source_table: "research_reports",
    p_source_id: report.id,
  });

  if (rpcError || allowed !== true) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const { data: signed, error } = await supabaseAdmin.storage
    .from("submission-pdfs")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !signed) {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
