import { supabase } from "./supabase";

// A real, admin-toggleable runtime setting — see the app_settings table in
// schema.sql. Publicly readable (every signed-in user's own client needs to
// know whether to enforce their own entitlement — see how ai-report.tsx
// reads this), writable by admins only (RLS-enforced server-side; the
// Settings tab in admin.tsx is just the one real UI for it, not the only
// thing stopping a non-admin write).
export type AppSettings = {
  enforcePerPropertyEntitlement: boolean;
};

// Used only if the settings row is somehow missing (should never happen —
// it's inserted once by the migration and never deleted) — the same safe
// "off" default the feature originally shipped with as a hardcoded constant.
export const DEFAULT_APP_SETTINGS: AppSettings = { enforcePerPropertyEntitlement: false };

export async function getAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("enforce_per_property_entitlement")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_APP_SETTINGS;
  return { enforcePerPropertyEntitlement: data.enforce_per_property_entitlement as boolean };
}

export async function setEnforcePerPropertyEntitlement(enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .update({ enforce_per_property_entitlement: enabled, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw error;
}
