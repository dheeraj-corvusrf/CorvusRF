import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { checkIsAdmin } from "@/lib/admin";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/property-tax-management", label: "Property Tax Management" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/property-protest", label: "Property Protest" },
  { to: "/bpp-rendition", label: "BPP Rendition" },
  { to: "/tax-payment", label: "Tax Payment" },
  { to: "/pricing", label: "Pricing" },
  { to: "/contact", label: "Contact Us" },
] as const;

export function SiteNav() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const signedIn = !!user;
  const [isAdmin, setIsAdmin] = useState(false);

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

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-serif text-lg font-semibold tracking-tight">
            CorvusRF<span className="text-accent">.ai</span>
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "bg-secondary text-foreground" }}
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
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold"
                aria-label="Profile menu"
              >
                {(user?.email?.[0] ?? "U").toUpperCase()}
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-52 card-elev p-1 text-sm">
                  <Link
                    to="/dashboard"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 hover:bg-secondary"
                  >
                    Dashboard
                  </Link>
                  <Link
                    to="/pricing"
                    onClick={() => setProfileOpen(false)}
                    className="block rounded-md px-3 py-2 hover:bg-secondary"
                  >
                    Subscription
                  </Link>
                  {isAdmin && (
                    <Link
                      to="/admin"
                      onClick={() => setProfileOpen(false)}
                      className="block rounded-md px-3 py-2 hover:bg-secondary"
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
                    className="block w-full rounded-md px-3 py-2 text-left hover:bg-secondary"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/sign-in" className="btn-outline hidden sm:inline-flex text-sm">
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
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-sm font-medium hover:bg-secondary"
              >
                {item.label}
              </Link>
            ))}
            {!signedIn && (
              <Link to="/sign-in" onClick={() => setOpen(false)} className="btn-outline mt-2">
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
              CorvusRF<span className="text-accent">.ai</span>
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Texas property tax help, powered by AI. Real property protest, BPP, payments,
            and savings — one platform.
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
            ["Property Protest", "/property-protest"],
            ["BPP Rendition", "/bpp-rendition"],
            ["Tax Payment", "/tax-payment"],
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
          <span>© {new Date().getFullYear()} CorvusRF.ai — Texas Property Tax AI.</span>
          <span>Serving all 254 Texas counties.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {links.map(([label, to]) => (
          <li key={to}>
            <Link to={to} className="hover:text-foreground">
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
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
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
