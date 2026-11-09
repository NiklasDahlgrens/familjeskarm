// All dataåtkomst går via denna modul.
// Gränssnitt: list(table), add, update, remove, subscribe(cb), samt för Supabase:
// getSession(), signIn(email, pw), signOut().
import { createLocalStore } from './local.js';
import { createSupabaseStore } from './supabase.js';
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const store = url && key ? createSupabaseStore({ supabaseUrl: url, supabaseAnonKey: key }) : createLocalStore();
export const TABLES = ['events', 'todos', 'recipes', 'meal_plan', 'shopping_items'];
