// Imara Capital — admin-users Edge Function.
// Account actions that need Supabase's secret key (set password, suspend,
// delete, invite, ...). Only callers whose role is "admin" are allowed:
// logic.ts checks the caller's own session token and role on every request.
//
// Deployed with verify_jwt = false because the platform's built-in check does
// not understand the new API keys; authorization happens in logic.ts instead.
import { createClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.5';
import { handle, type Deps, type Role } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SECRET_KEY = (() => {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    if (keys.default) return keys.default as string;
  } catch { /* fall back to the legacy key */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
})();

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Direct database connection, used only to end a user's sessions
// (auth.sessions isn't reachable through the Auth admin API).
let sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (!sql) sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 20 });
  return sql;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const deps: Deps = {
  async userFromToken(token) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  },
  async roleOf(userId) {
    const { data } = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
    return ((data?.role as Role) || 'user');
  },
  async countAdmins() {
    const { count } = await admin.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
    return count ?? 0;
  },
  async getUser(userId) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, banned_until: data.user.banned_until ?? null };
  },
  async updateUser(userId, attrs) {
    const { error } = await admin.auth.admin.updateUserById(userId, attrs);
    if (error) throw error;
  },
  async deleteUser(userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
  },
  async createUser({ email, password, full_name }) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: full_name ? { full_name } : {},
    });
    if (error) throw error;
    return { id: data.user.id, email: data.user.email ?? null };
  },
  async inviteUser(email, { full_name, redirectTo }) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: full_name ? { full_name } : {}, redirectTo,
    });
    if (error) throw error;
    return { id: data.user.id, email: data.user.email ?? null };
  },
  async sendPasswordReset(email, redirectTo) {
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  },
  async setRole(userId, role, grantedBy) {
    const { error } = await admin.from('user_roles')
      .upsert({ user_id: userId, role, granted_by: grantedBy, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async revokeSessions(userId) {
    const rows = await db()`delete from auth.sessions where user_id = ${userId} returning id`;
    return rows.length;
  },
  async audit({ actor, action, target, details }) {
    const { error } = await admin.from('audit_log').insert({
      actor_id: actor.id, actor_email: actor.email, action,
      target_user_id: target?.id ?? null, target_email: target?.email ?? null,
      details: details ?? {},
    });
    if (error) console.error('audit insert failed:', error.message);
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const result = await handle(req.method, req.headers.get('Authorization'), body, deps);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
