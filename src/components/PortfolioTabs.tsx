import { Link } from "@tanstack/react-router";
import { Scale, Briefcase, Receipt } from "lucide-react";

const TABS = [
  { to: "/dashboard/properties", label: "Property Protest", icon: Scale },
  { to: "/dashboard/bpp-accounts", label: "BPP", icon: Briefcase },
  { to: "/dashboard/tax-bills", label: "Tax Filing", icon: Receipt },
] as const;

// Purely additive header shared by the Properties, BPP Accounts, and Tax Bills
// pages so navigating between them reads as switching tabs of one dashboard,
// without touching the sidebar nav (AppShell.tsx) or rebuilding any of the three
// pages into a single unified view.
export function PortfolioTabs() {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-secondary/60 p-1 w-fit">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            activeProps={{ className: "bg-background text-foreground shadow-sm" }}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
