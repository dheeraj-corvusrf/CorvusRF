import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Building2,
  Briefcase,
  FileText,
  CalendarClock,
  Receipt,
  CreditCard,
  Settings as SettingsIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/dashboard/properties", label: "Properties", icon: Building2 },
  { to: "/dashboard/bpp-accounts", label: "BPP Accounts", icon: Briefcase },
  { to: "/dashboard/documents", label: "Documents", icon: FileText },
  { to: "/dashboard/deadlines", label: "Deadlines", icon: CalendarClock },
  { to: "/dashboard/tax-bills", label: "Tax Bills", icon: Receipt },
  { to: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { to: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
] as const;

// Pages that keep their own full-width marketing/tooling layout instead of the
// account sidebar: the home page (explicitly excluded), the admin workspace
// (a different persona than "my properties"), and sign-in (nothing to show a
// signed-out visitor a dashboard for).
const NO_SHELL_PREFIXES = ["/admin", "/admin-login", "/sign-in"];

function shouldShowShell(pathname: string): boolean {
  if (pathname === "/") return false;
  return !NO_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Puts the same account sidebar (Properties, BPP, Documents, Deadlines, Billing,
// Settings) around every signed-in page site-wide, not just /dashboard/* — so
// switching between, say, the AI report and Properties doesn't mean losing this
// navigation and going back through the top nav.
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading || !user || !shouldShowShell(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="w-full px-6 py-10 sm:px-10 lg:px-16">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex min-w-0 gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
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
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
