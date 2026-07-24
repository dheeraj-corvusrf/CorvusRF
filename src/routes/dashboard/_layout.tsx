import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard,
  Building2,
  Briefcase,
  FileText,
  CalendarClock,
  CreditCard,
  Settings as SettingsIcon,
} from "lucide-react";

export const Route = createFileRoute("/dashboard/_layout")({
  component: DashboardLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/dashboard/properties", label: "Properties", icon: Building2 },
  { to: "/dashboard/bpp-accounts", label: "BPP Accounts", icon: Briefcase },
  { to: "/dashboard/documents", label: "Documents", icon: FileText },
  { to: "/dashboard/deadlines", label: "Deadlines", icon: CalendarClock },
  { to: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { to: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
] as const;

function DashboardLayout() {
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) nav({ to: "/sign-in" });
  }, [loading, user, nav]);

  if (loading || !user) return null;

  return (
    <div className="w-full px-6 py-10 sm:px-10 lg:px-16">
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
                activeOptions={{ exact: item.to === "/dashboard" }}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
