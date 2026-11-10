// All dataåtkomst går via denna modul.
// Gränssnitt: list(table), add, update, remove, clear(table), subscribe(cb(table?)), samt för Supabase:
// getSession(), getAccessToken(), signIn(email, pw), signOut(), onAuthChange(cb),
// resetPassword(email), updatePassword(pw), isPasswordRecovery(), authRedirectError().
import { createLocalStore } from './local.js';
import { createSupabaseStore } from './supabase.js';
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const store = url && key ? createSupabaseStore({ supabaseUrl: url, supabaseAnonKey: key }) : createLocalStore();
