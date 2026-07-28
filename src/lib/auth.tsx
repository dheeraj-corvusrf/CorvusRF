import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { resetIntake } from "@/lib/intake-store";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ user: null, session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, session: null, loading: true });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({ user: data.session?.user ?? null, session: data.session, loading: false });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // The intake flow's sessionStorage state (address, CAD match, etc.) isn't
      // scoped to an account — it's just "whatever this browser tab was in the
      // middle of." Left uncleared across a sign-out, the JourneyTracker on a
      // fresh sign-in would show stale progress ("Step 4 of 11") for an account
      // that has never touched intake at all. Signing out is the one clear
      // signal that whatever was in progress no longer applies to whoever
      // signs in next in this tab.
      if (event === "SIGNED_OUT") resetIntake();
      setState({ user: session?.user ?? null, session, loading: false });
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
