// Imara Capital — admin-users Edge Function: request handling and rules.
// Pure logic with injected dependencies, so it can be unit-tested outside Deno.

export type Role = 'user' | 'employee' | 'admin';
export interface AuthUser { id: string; email: string | null; banned_until?: string | null }

export interface Deps {
  /** Validate a user access token; null if invalid or expired. */
  userFromToken(token: string): Promise<AuthUser | null>;
  roleOf(userId: string): Promise<Role>;
  countAdmins(): Promise<number>;
  getUser(userId: string): Promise<AuthUser | null>;
  updateUser(userId: string, attrs: Record<string, unknown>): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  createUser(attrs: { email: string; password: string; full_name?: string }): Promise<AuthUser>;
  inviteUser(email: string, opts: { full_name?: string; redirectTo?: string }): Promise<AuthUser>;
  sendPasswordReset(email: string, redirectTo?: string): Promise<void>;
  setRole(userId: string, role: Role, grantedBy: string): Promise<void>;
  revokeSessions(userId: string): Promise<number>;
  audit(entry: { actor: AuthUser; action: string; target?: AuthUser | null; details?: Record<string, unknown> }): Promise<void>;
}

export interface Result { status: number; body: Record<string, unknown> }

const ROLES: Role[] = ['user', 'employee', 'admin'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FOREVER = '876000h'; // ~100 years: Supabase's way of saying "banned"

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

export function strongPassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 72 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

function safeRedirect(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.hostname === 'localhost' ? u.toString() : undefined;
  } catch { return undefined; }
}

export async function handle(method: string, authHeader: string | null, body: unknown, deps: Deps): Promise<Result> {
  try {
    if (method !== 'POST') fail(405, 'Use POST.');
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) fail(401, 'Log in first.');
    const actor = await deps.userFromToken(token);
    if (!actor) fail(401, 'Your session has expired. Log in again.');
    if ((await deps.roleOf(actor!.id)) !== 'admin') fail(403, 'Only administrators can do this.');

    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const action = String(b.action || '');

    if (action === 'ping') return { status: 200, body: { ok: true, time: new Date().toISOString() } };

    // ---- actions that create users ----
    if (action === 'create_user' || action === 'invite_user') {
      const email = String(b.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
      const role = (b.role ?? 'user') as Role;
      if (!ROLES.includes(role)) fail(400, 'Unknown role.');
      // Administration belongs to the site owner only (also enforced by the database).
      if (role === 'admin') fail(400, 'Only the site owner can be an administrator. Choose Employee or Customer.');
      const fullName = typeof b.full_name === 'string' ? b.full_name.trim().slice(0, 120) : undefined;
      let created: AuthUser;
      if (action === 'create_user') {
        if (!strongPassword(b.password)) fail(400, 'Password must be 8–72 characters with letters and numbers.');
        created = await deps.createUser({ email, password: b.password as string, full_name: fullName });
      } else {
        created = await deps.inviteUser(email, { full_name: fullName, redirectTo: safeRedirect(b.redirect_to) });
      }
      if (role !== 'user') await deps.setRole(created.id, role, actor!.id);
      await deps.audit({ actor: actor!, action: action === 'create_user' ? 'user.created' : 'user.invited', target: created, details: { role } });
      return { status: 200, body: { ok: true, user_id: created.id } };
    }

    // ---- actions on an existing user ----
    const userId = String(b.user_id || '');
    if (!UUID_RE.test(userId)) fail(400, 'Missing or invalid user.');
    const target = await deps.getUser(userId);
    if (!target) fail(404, 'User not found.');
    const isSelf = target!.id === actor!.id;

    switch (action) {
      case 'set_password': {
        if (!strongPassword(b.password)) fail(400, 'Password must be 8–72 characters with letters and numbers.');
        await deps.updateUser(userId, { password: b.password });
        await deps.audit({ actor: actor!, action: 'user.password_set', target });
        return { status: 200, body: { ok: true } };
      }
      case 'send_password_reset': {
        if (!target!.email) fail(400, 'This user has no email address.');
        await deps.sendPasswordReset(target!.email!, safeRedirect(b.redirect_to));
        await deps.audit({ actor: actor!, action: 'user.password_reset_sent', target });
        return { status: 200, body: { ok: true } };
      }
      case 'confirm_email': {
        await deps.updateUser(userId, { email_confirm: true });
        await deps.audit({ actor: actor!, action: 'user.email_confirmed', target });
        return { status: 200, body: { ok: true } };
      }
      case 'update_email': {
        const email = String(b.email || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');
        await deps.updateUser(userId, { email, email_confirm: true });
        await deps.audit({ actor: actor!, action: 'user.email_changed', target, details: { from: target!.email, to: email } });
        return { status: 200, body: { ok: true } };
      }
      case 'suspend': {
        if (isSelf) fail(400, 'You can’t suspend your own account.');
        if ((await deps.roleOf(userId)) === 'admin') fail(400, 'Remove the administrator role before suspending this account.');
        await deps.updateUser(userId, { ban_duration: FOREVER });
        const ended = await deps.revokeSessions(userId);
        await deps.audit({ actor: actor!, action: 'user.suspended', target, details: { sessions_ended: ended } });
        return { status: 200, body: { ok: true, sessions_ended: ended } };
      }
      case 'unsuspend': {
        await deps.updateUser(userId, { ban_duration: 'none' });
        await deps.audit({ actor: actor!, action: 'user.unsuspended', target });
        return { status: 200, body: { ok: true } };
      }
      case 'sign_out_everywhere': {
        const ended = await deps.revokeSessions(userId);
        await deps.audit({ actor: actor!, action: 'user.sessions_revoked', target, details: { sessions_ended: ended } });
        return { status: 200, body: { ok: true, sessions_ended: ended } };
      }
      case 'delete_user': {
        if (isSelf) fail(400, 'You can’t delete your own account.');
        if (String(b.confirm_email || '').trim().toLowerCase() !== (target!.email || '').toLowerCase()) {
          fail(400, 'Type the user’s email address exactly to confirm.');
        }
        if ((await deps.roleOf(userId)) === 'admin' && (await deps.countAdmins()) <= 1) fail(400, 'You can’t delete the last administrator.');
        // Audit first: the user row (and its profile and applications) is gone afterwards.
        await deps.audit({ actor: actor!, action: 'user.deleted', target, details: { email: target!.email } });
        await deps.deleteUser(userId);
        return { status: 200, body: { ok: true } };
      }
      default:
        return fail(400, 'Unknown action.');
    }
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
    const msg = err instanceof Error ? err.message : String(err);
    // Surface Supabase Auth's own validation messages (e.g. "email already registered").
    if (/already (been )?registered|already exists/i.test(msg)) return { status: 409, body: { error: 'A user with this email already exists.' } };
    if (/password/i.test(msg) && /weak|short|characters/i.test(msg)) return { status: 400, body: { error: msg } };
    console.error('admin-users error:', msg);
    return { status: 500, body: { error: 'Something went wrong. Check the Edge Function logs.' } };
  }
}
