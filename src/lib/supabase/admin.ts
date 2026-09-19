import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminInstance: SupabaseClient | null = null;

/**
 * Service-role client. Lazily constructed and memoized: instantiating at
 * module scope crashes `next build` (page-data collection) whenever
 * SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are not configured.
 * Bypasses RLS — server-side only, never import from client components.
 */
export function createAdminClient(): SupabaseClient {
  if (!adminInstance) {
    adminInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return adminInstance;
}
