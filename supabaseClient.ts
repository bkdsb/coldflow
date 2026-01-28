import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export let supabase: SupabaseClient | null = null;
export let supabaseInitError: string | null = null;

if (!supabaseUrl || !supabaseAnonKey) {
  supabaseInitError = "Supabase env missing: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
  console.warn(supabaseInitError);
} else {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
  } catch (error) {
    supabaseInitError = "Supabase init failed. Check URL/anon key.";
    console.error(supabaseInitError, error);
  }
}
