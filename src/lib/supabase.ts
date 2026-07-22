import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.warn(
    "Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env " +
      "(see .env.example). Sign up / sign in will not work until this is set.",
  );
}

// The anon key is safe to ship in the client bundle by design — Supabase enforces
// per-row access via the Row Level Security policies in supabase/schema.sql, not
// by keeping this key secret.
//
// createClient() throws synchronously on an empty URL, and this app prerenders every
// route at build time, so an unconfigured env would crash the entire build rather than
// just failing auth calls at runtime. Fall back to a syntactically valid placeholder so
// the app builds and runs; unconfigured auth calls will simply fail over the network.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder-anon-key",
);
