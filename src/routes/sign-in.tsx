import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/sign-in")({
  head: () => ({
    meta: [
      { title: "Sign In — CorvusRF.ai" },
      { name: "description", content: "Sign in to your CorvusRF.ai property tax dashboard." },
      { property: "og:title", content: "Sign In — CorvusRF.ai" },
      { property: "og:description", content: "Access your property tax dashboard." },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError(null);
    setCheckEmail(false);
    setPassword("");
    setConfirmPassword("");
    setFirstName("");
    setLastName("");
    setPhone("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup" && (!firstName.trim() || !lastName.trim())) {
      setError("Please enter your first and last name.");
      return;
    }
    if (mode === "signup" && !/^[0-9+()\- ]{7,20}$/.test(phone.trim())) {
      setError("Please enter a valid phone number.");
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!isSupabaseConfigured) {
      setError("Accounts aren't set up in this deployment yet. Please check back soon.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              phone: phone.trim(),
            },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          // Email confirmation is required before a session is issued.
          setCheckEmail(true);
        } else {
          nav({ to: "/dashboard" });
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        nav({ to: "/dashboard" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (checkEmail) {
    return (
      <div className="container-page py-16 max-w-md">
        <span className="badge-soft">Almost there</span>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Check your email.</h1>
        <p className="mt-2 text-muted-foreground">
          We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
          account, then sign in.
        </p>
        <button onClick={() => switchMode("signin")} className="btn-primary btn-primary-hover mt-6">
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="container-page py-16 max-w-md">
      <span className="badge-soft">{mode === "signin" ? "Sign In" : "Create Account"}</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">
        {mode === "signin" ? "Welcome back." : "Create your CorvusRF account."}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {mode === "signin"
          ? "Your properties, protests, deadlines, and savings — all in one place."
          : "Save your property, analysis, documents, and preview history."}
      </p>
      <form onSubmit={onSubmit} className="mt-8 card-elev p-6 grid gap-4">
        {mode === "signup" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm min-w-0">
              <span className="font-medium">First Name</span>
              <input
                required
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm min-w-0">
              <span className="font-medium">Last Name</span>
              <input
                required
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
          </div>
        )}
        {mode === "signup" && (
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Phone Number</span>
            <input
              required
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
        )}
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Password</span>
          <input
            required
            type="password"
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        {mode === "signup" && (
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Confirm Password</span>
            <input
              required
              type="password"
              minLength={6}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button disabled={loading} className="btn-primary btn-primary-hover disabled:opacity-60">
          {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>
        <button
          type="button"
          onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "Need an account? Create one." : "Already have an account? Sign in."}
        </button>
      </form>
    </div>
  );
}
