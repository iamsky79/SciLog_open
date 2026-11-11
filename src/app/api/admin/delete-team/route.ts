import { NextResponse } from "next/server";
import { createClient as createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isSubmissionPdfValue, extractSubmissionPdfPath } from "@/lib/uploads/submissionPdf";

function extractStoragePath(url: string, bucket: string): string | null {
  const m = url.match(new RegExp(`/object/public/${bucket}/(.+?)(?:\\?|$)`));
  return m ? m[1] : null;
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: requester } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!requester?.is_admin) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { teamId } = (await request.json()) as { teamId?: string };

  if (!teamId) {
    return NextResponse.json({ error: "teamId가 필요합니다." }, { status: 400 });
  }

  // 1. activity_logs 파일 URL 수집 후 Storage 삭제
  const { data: logs } = await supabaseAdmin
    .from("activity_logs")
    .select("id, file_urls")
    .eq("entity_type", "team")
    .eq("entity_id", teamId);

  const activityFilePaths: string[] = [];
  for (const log of logs ?? []) {
    for (const url of (log.file_urls as string[]) ?? []) {
      const path = extractStoragePath(url, "activity-files");
      if (path) activityFilePaths.push(path);
    }
  }
  if (activityFilePaths.length > 0) {
    await supabaseAdmin.storage.from("activity-files").remove(activityFilePaths);
  }

  // 2. research_reports 파일 URL 수집 후 Storage 삭제
  const { data: reports } = await supabaseAdmin
    .from("research_reports")
    .select("file_url, extra_file_urls")
    .eq("team_id", teamId);

  const reportFilePaths: string[] = [];
  const submissionPdfPaths: string[] = [];
  for (const report of reports ?? []) {
    if (report.file_url) {
      if (isSubmissionPdfValue(report.file_url)) {
        submissionPdfPaths.push(extractSubmissionPdfPath(report.file_url));
      } else {
        const path = extractStoragePath(report.file_url, "reports");
        if (path) reportFilePaths.push(path);
      }
    }
    for (const url of (report.extra_file_urls as string[]) ?? []) {
      const path = extractStoragePath(url, "reports");
      if (path) reportFilePaths.push(path);
    }
  }
  if (reportFilePaths.length > 0) {
    await supabaseAdmin.storage.from("reports").remove(reportFilePaths);
  }
  if (submissionPdfPaths.length > 0) {
    await supabaseAdmin.storage.from("submission-pdfs").remove(submissionPdfPaths);
  }

  // 3. activity_logs 삭제
  await supabaseAdmin
    .from("activity_logs")
    .delete()
    .eq("entity_type", "team")
    .eq("entity_id", teamId);

  // 4. 팀 삭제 (team_members, research_plans, research_reports는 CASCADE)
  const { error } = await supabaseAdmin.from("teams").delete().eq("id", teamId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
