"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { UserRole } from "@/lib/database.types";

export function useRequireAdmin(redirectTo: string) {
  const router = useRouter();
  const { profile, loading } = useAuth();
  const allowed = profile?.is_admin === true;

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace(redirectTo);
    }
  }, [loading, allowed, redirectTo, router]);

  return { profile, loading, allowed };
}

export function useRequireRole(role: UserRole, redirectTo: string) {
  const router = useRouter();
  const { profile, loading } = useAuth();
  const allowed = profile?.role === role;

  useEffect(() => {
    if (!loading && profile && !allowed) {
      router.replace(redirectTo);
    }
  }, [loading, profile, allowed, redirectTo, router]);

  return { profile, loading, allowed };
}
