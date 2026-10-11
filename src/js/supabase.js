import { createClient } from '@supabase/supabase-js';

let client;

export function getSupabaseClient() {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  const missing = [];

  if (!url) missing.push('VITE_SUPABASE_URL');
  if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (missing.length) {
    throw new Error('Missing Supabase configuration: set ' + missing.join(' and ') + ' in .env.local, then restart Vite.');
  }

  client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true
    }
  });

  return client;
}
