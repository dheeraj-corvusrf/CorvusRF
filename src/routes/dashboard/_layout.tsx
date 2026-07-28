import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/_layout")({
  component: DashboardLayout,
});

// The account sidebar itself now lives in AppShell (src/components/AppShell.tsx),
// which wraps every signed-in page site-wide — this layout only keeps the
// sign-in guard that's specific to /dashboard/* routes.
function DashboardLayout() {
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) nav({ to: "/sign-in" });
  }, [loading, user, nav]);

  if (loading || !user) return null;

  return <Outlet />;
}
