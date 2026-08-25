import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { checkIsAdmin } from "@/lib/admin";
import { shouldShowShell } from "@/components/AppShell";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/property-protest", label: "Protest" },
  { to: "/bpp-rendition", label: "Personal Property" },
  { to: "/tax-payment", label: "Pay Tax" },
  { to: "/pricing", label: "Pricing" },
  { to: "/contact", label: "Contact Us" },
] as const;

function isNavActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

export function SiteNav() {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const signedIn = !!user;
  const [isAdmin, setIsAdmin] = useState(false);
  // AppShell renders its own "Dashboard"-first tab bar directly under this
  // nav on every signed-in page except "/" and a few auth/admin routes (see
  // shouldShowShell) — skip injecting a second "Dashboard" link here on those
  // pages so the two rows don't repeat the same entry right on top of each other.
  const navItems = signedIn
    ? shouldShowShell(pathname)
      ? NAV
      : [NAV[0], { to: "/dashboard", label: "Dashboard" } as const, ...NAV.slice(1)]
    : NAV;

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    checkIsAdmin(user.id).then(setIsAdmin);
  }, [user]);

  useEffect(() => {
    if (!profileOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [profileOpen]);

  // Sticky nav gains a bit of depth once content has actually scrolled under
  // it, instead of always casting the same flat shadow.
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navContainerRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false });

  // A single pill slides between nav links on route change instead of each
  // link toggling its own static background — deps are primitives (pathname,
  // signedIn), not the `navItems` array literal, since that's a fresh
  // reference every render and would otherwise re-fire this effect forever.
  useLayoutEffect(() => {
    function recompute() {
      const container = navContainerRef.current;
      const activeItem = navItems.find((item) => isNavActive(pathname, item.to));
      const link = activeItem ? linkRefs.current[activeItem.to] : null;
      if (!container || !link) {
        setIndicator((s) => (s.visible ? { left: s.left, width: s.width, visible: false } : s));
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      setIndicator({
        left: linkRect.left - containerRect.left,
        width: linkRect.width,
        visible: true,
      });
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, signedIn]);

  return (
    <header
      className={`sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur transition-shadow duration-300 ${
        scrolled ? "shadow-[0_8px_24px_-16px_oklch(0.18_0.06_250_/_0.35)]" : ""
      }`}
    >
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-serif text-lg font-semibold tracking-tight">
            Corvus<span className="text-emerald-600 dark:text-emerald-400">PT</span>
            <span className="text-accent">.ai</span>
          </span>
        </Link>

        <nav ref={navContainerRef} className="relative hidden lg:flex items-center gap-1">
          <span
            aria-hidden
            className="absolute inset-y-1 rounded-md bg-nav-highlight transition-[left,width] duration-300 ease-out"
            style={{
              left: indicator.left,
              width: indicator.width,
              opacity: indicator.visible ? 1 : 0,
            }}
          />
          {navItems.map((item) => (
            <Link
              key={item.to}
              ref={(el) => {
                linkRefs.current[item.to] = el;
              }}
              to={item.to}
              className="relative rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-nav-highlight hover:text-nav-highlight-foreground"
              activeProps={{ className: "text-foreground" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {signedIn ? (
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold transition-transform hover:scale-105 active:scale-95"
                aria-label="Profile menu"
              >
                {(user?.email?.[0] ?? "U").toUpperCase()}
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-52 card-elev p-1 text-sm">
                  <Link
                    to="/dashboard"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Dashboard
                  </Link>
                  <Link
                    to="/pricing"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Subscription
                  </Link>
                  <Link
                    to="/dashboard/billing"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Billing
                  </Link>
                  <Link
                    to="/dashboard/settings"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                  >
                    Settings
                  </Link>
                  {isAdmin && (
                    <Link
                      to="/admin"
                      onClick={() => setProfileOpen(false)}
                      className="block rounded-md px-3 py-2 transition-colors hover:bg-secondary"
                    >
                      Admin
                    </Link>
                  )}
                  <button
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setProfileOpen(false);
                      nav({ to: "/" });
                    }}
                    className="block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/sign-in"
              search={{ redirect: pathname }}
              className="btn-outline hidden sm:inline-flex text-sm"
            >
              Sign In
            </Link>
          )}
          <button
            className="lg:hidden btn-outline text-sm"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            Menu
          </button>
        </div>
      </div>
      {open && (
        <div className="lg:hidden border-t border-border/70 bg-background">
          <div className="container-page grid gap-1 py-3">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-sm font-medium transition-colors hover:bg-secondary"
              >
                {item.label}
              </Link>
            ))}
            {!signedIn && (
              <Link
                to="/sign-in"
                search={{ redirect: pathname }}
                onClick={() => setOpen(false)}
                className="btn-outline mt-2"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-secondary/40">
      <div className="container-page grid gap-8 py-12 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <LogoMark />
            <span className="font-serif text-lg font-semibold">
              Corvus<span className="text-emerald-600 dark:text-emerald-400">PT</span>
              <span className="text-accent">.ai</span>
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Texas property tax help, powered by AI. Real property protest, BPP, payments, and
            savings — one platform.
          </p>
        </div>
        <FooterCol
          title="Platform"
          links={[
            ["Property Tax Management", "/property-tax-management"],
            ["How It Works", "/how-it-works"],
            ["Pricing", "/pricing"],
          ]}
        />
        <FooterCol
          title="Services"
          links={[
            ["Protest", "/property-protest"],
            ["Personal Property", "/bpp-rendition"],
            ["Pay Tax", "/tax-payment"],
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            ["Contact Us", "/contact"],
            ["Sign In", "/sign-in"],
          ]}
        />
      </div>
      <div className="border-t border-border/70">
        <div className="container-page py-5 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} CorvusPT.ai — Texas Property Tax AI.</span>
          <span>Serving all 254 Texas counties.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {links.map(([label, to]) => (
          <li key={to}>
            <Link
              to={to}
              search={to === "/sign-in" ? { redirect: pathname } : undefined}
              className="hover:text-foreground"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogoMark() {
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand text-brand-foreground"
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M4 20c3-6 5-9 8-9s5 3 8 9" strokeLinecap="round" />
        <circle cx="16" cy="7" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="min-h-[70vh]">{children}</main>
      <SiteFooter />
    </>
  );
}
