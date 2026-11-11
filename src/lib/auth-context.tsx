"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { Profile } from "@/lib/database.types";

interface AuthState {
  userId: string | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** 비밀번호 변경 직후 화면 상태를 갱신한다(첫 로그인 비밀번호 변경 강제 해제). */
  markPasswordChanged: () => void;
}

const AuthContext = createContext<AuthState>({
  userId: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  markPasswordChanged: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;

      if (!user) {
        setUserId(null);
        setProfile(null);
        setLoading(false);
        router.replace("/login");
        return;
      }

      setUserId(user.id);

      const { data: profileRow } = await supabase
        .from("users")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!active) return;

      setProfile((profileRow as Profile) ?? null);
      setLoading(false);
    }

    load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const markPasswordChanged = () => {
    setProfile((prev) => (prev ? { ...prev, password_changed: true } : prev));
  };

  return (
    <AuthContext.Provider value={{ userId, profile, loading, signOut, markPasswordChanged }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
