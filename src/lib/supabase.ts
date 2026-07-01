import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config, supabaseConfigured } from '../config.js';

// supabase-js constructs a Realtime client eagerly, which needs a WebSocket.
// Node < 22 has no global WebSocket, so provide `ws` (we don't use realtime).
// Cast to any: `ws`'s event types differ slightly from the DOM WebSocket type.
const realtime = { transport: WebSocket as any };

let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

/**
 * Service-role client — bypasses RLS. Use ONLY on the server for trusted,
 * user-scoped queries (we always filter by the authenticated user_id).
 */
export function supabaseAdmin(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error('Supabase is not configured (set SUPABASE_URL / keys in .env)');
  }
  serviceClient ??= createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime,
  });
  return serviceClient;
}

/** Anon client — used to verify a user's access token via getUser(). */
export function supabaseAnon(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error('Supabase is not configured (set SUPABASE_URL / keys in .env)');
  }
  anonClient ??= createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime,
  });
  return anonClient;
}
