"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/Card";
import { ActivityLogSection } from "@/components/ActivityLogSection";
import { OTHER_ACTIVITY_SUBTYPE_LABEL } from "@/lib/other-activity";
import { fmtDate } from "@/lib/export/common";
import type { OtherActivity } from "@/lib/database.types";

export default function OtherActivityDetailPage() {
  const params = useParams<{ id: string }>();
  const activityId = params.id;
  const { userId, profile, loading: authLoading } = useAuth();

  const [activity, setActivity] = useState<OtherActivity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !activityId) return;

    async function load() {
      const supabase = createClient();
      setLoading(true);
      const { data } = await supabase
        .from("other_activities")
        .select("*")
        .eq("id", activityId)
        .single();
      setActivity((data as OtherActivity) ?? null);
      setLoading(false);
    }

    load();
  }, [authLoading, activityId]);

  if (loading || authLoading) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  if (!activity) {
    return <p className="text-sm text-slate-400">활동을 찾을 수 없습니다.</p>;
  }

  const canReview = profile?.is_admin === true;
  const yearLabel = activity.academic_year != null ? `${activity.academic_year}학년도` : "학년도 미정";
  const semesterLabel = activity.semester === "1" ? "1학기" : activity.semester === "2" ? "2학기" : null;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium text-sky-600">
          [{OTHER_ACTIVITY_SUBTYPE_LABEL[activity.subtype]}] {yearLabel}
          {semesterLabel ? ` ${semesterLabel}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{activity.title}</h1>
      </div>

      <Card className="space-y-4">
        {(activity.activity_date || activity.organizer) && (
          <div className="space-y-1">
            {activity.activity_date && <p className="text-sm text-slate-500">{fmtDate(activity.activity_date)}</p>}
            {activity.organizer && <p className="text-sm text-slate-500">{activity.organizer}</p>}
          </div>
        )}
        {activity.content && (
          <div>
            <p className="text-sm font-semibold text-slate-700">활동 내용</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{activity.content}</p>
          </div>
        )}
        {activity.result && (
          <div>
            <p className="text-sm font-semibold text-slate-700">결과 및 성과</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{activity.result}</p>
          </div>
        )}
      </Card>

      {userId && (
        <ActivityLogSection
          entityType="other"
          entityId={activity.id}
          currentUserId={userId}
          canReview={canReview}
          hideFilterTabs
        />
      )}
    </div>
  );
}
