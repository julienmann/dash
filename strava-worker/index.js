/**
 * Strava OAuth + Anthropic AI proxy + accounts worker
 *
 * Keeps the Strava Client Secret, Anthropic API key, and password hashes
 * server-side. The server-side Origin check (exact match against ALLOWED_ORIGIN)
 * is the real gate — CORS response headers alone don't stop non-browser callers.
 * The /ai proxy additionally allow-lists models, caps max_tokens and body size,
 * and is rate-limited so it can't be abused to spend Anthropic credits.
 *
 * Required secrets (set via `wrangler secret put`):
 *   STRAVA_CLIENT_ID     — numeric ID from strava.com/settings/api
 *   STRAVA_CLIENT_SECRET — 40-char hex secret from the same page
 *   ANTHROPIC_API_KEY    — sk-ant-… key from console.anthropic.com
 *   SESSION_SECRET       — random 32+ byte string used to sign session tokens
 *
 * Optional secrets (Garmin/Polar connect — the frontend's connect buttons for a
 * provider stay disabled until its client id/secret are set):
 *   GARMIN_CLIENT_ID     — from a Garmin Connect Developer Program app
 *   GARMIN_CLIENT_SECRET — from the same app
 *   POLAR_CLIENT_ID      — client id from a Polar AccessLink app (admin.polaraccesslink.com)
 *   POLAR_CLIENT_SECRET  — client secret from the same app
 *
 * Note on Garmin: unlike Strava/Polar, Garmin's public API does not offer a simple
 * "list recent activities" pull — activity data is delivered via webhook (Ping/Push)
 * or a one-time backfill request, both of which need server-side storage. This worker
 * implements the OAuth connect (so tokens can be obtained/refreshed) but /garmin/activities
 * is a stub — wire it to a webhook receiver + D1 table before relying on it for real data.
 *
 * Required var (set in wrangler.toml [vars]):
 *   ALLOWED_ORIGIN — comma-separated dashboard origin(s), e.g.
 *                    https://julienmann.ca,http://localhost:8080
 *
 * Required binding (set in wrangler.toml [[d1_databases]]):
 *   DB — D1 database created from schema.sql, used for accounts + synced plans.
 *
 * Optional binding (set in wrangler.toml [[kv_namespaces]]):
 *   RATE_LIMIT — KV namespace for per-IP rate limiting on /ai and /auth/*.
 *                When unbound, rate limiting is disabled (handlers still work).
 */

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const SESSION_TTL_SEC   = 60 * 60 * 24 * 30; // 30 days (HMAC tokens are not revocable; keep short)

// AI proxy guards — the worker holds the Anthropic key, so the browser must not be able to
// pick arbitrary models, unbounded output, or oversized prompts on the owner's dime.
const AI_ALLOWED_MODELS = [
  'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
];
const AI_MAX_TOKENS_CAP  = 8192;
const AI_MAX_BODY_BYTES  = 50_000;
const PLAN_MAX_BYTES     = 1_000_000; // 1 MB cap on a synced plan

// ── Connected data-source OAuth config ──────────────────────────────────
// One entry per provider the frontend can connect. `tokenUrl` is the OAuth2 token
// endpoint; `auth` picks how the client id/secret are sent (Strava wants them in the
// JSON body, Garmin/Polar want HTTP Basic auth over a form-encoded body per their docs).
const PROVIDER_CONFIG = {
  strava: {
    tokenUrl:     'https://www.strava.com/oauth/token',
    auth:         'body',
    clientIdKey:  'STRAVA_CLIENT_ID',
    clientSecretKey: 'STRAVA_CLIENT_SECRET',
  },
  garmin: {
    tokenUrl:     'https://diauthz.garmin.com/di-oauth2-service/oauth/token',
    auth:         'basic',
    clientIdKey:  'GARMIN_CLIENT_ID',
    clientSecretKey: 'GARMIN_CLIENT_SECRET',
  },
  polar: {
    tokenUrl:     'https://polarremote.com/v2/oauth2/token',
    auth:         'basic',
    clientIdKey:  'POLAR_CLIENT_ID',
    clientSecretKey: 'POLAR_CLIENT_SECRET',
  },
};

// Rate-limit budgets (requests per window per IP). Enforced only when a RATE_LIMIT KV
// namespace is bound; no-ops otherwise so local dev / pre-deploy keeps working.
const RATE_LIMITS = {
  ai:   { limit: 30, windowSec: 60 },
  auth: { limit: 10, windowSec: 60 },
};

export default {
  async fetch(req, env) {
    // Reduce a Referer (which carries a path) to a bare origin so exact-matching works.
    let refererOrigin = '';
    try { refererOrigin = new URL(req.headers.get('Referer') || '').origin; } catch { /* ignore */ }
    const origin         = req.headers.get('Origin') || refererOrigin || '';
    const allowedOrigins = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    // Exact match only. `startsWith` would let https://julienmann.ca.evil.com through.
    const isAllowed      = allowedOrigins.includes(origin);
    const allowOrigin    = isAllowed ? origin : '';

    const url = new URL(req.url);

    // Confirmation links are clicked directly from an email client as a plain GET — there's
    // no Origin/Referer to match against ALLOWED_ORIGIN, so this route sits ahead of the
    // origin gate below. It validates its own `redirect` param against the allow-list instead
    // (open-redirect guard) and never touches anything the CORS gate would otherwise protect.
    if (url.pathname === '/auth/verify' && req.method === 'GET') {
      return handleVerifyEmail(req, env, allowedOrigins);
    }

    // Calendar apps poll the feed URL directly with no Origin/Referer, so this route also
    // sits ahead of the origin gate. It's read-only and gated by the per-user secret token.
    if (url.pathname === '/calendar' && req.method === 'GET') {
      return handleCalendarFeed(req, env);
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
    }

    // Fail closed: require a configured allow-list and an exact origin match. This server-side
    // check is the real gate — CORS response headers alone don't stop non-browser callers.
    if (!allowedOrigins.length || !isAllowed) {
      return json({ error: 'Forbidden' }, 403, allowOrigin);
    }

    if (url.pathname === '/auth/register'            && req.method === 'POST') return withRateLimit(req, env, allowOrigin, 'auth', handleRegister);
    if (url.pathname === '/auth/login'                && req.method === 'POST') return withRateLimit(req, env, allowOrigin, 'auth', handleLogin);
    if (url.pathname === '/auth/resend-verification'  && req.method === 'POST') return withRateLimit(req, env, allowOrigin, 'auth', handleResendVerification);
    if (url.pathname === '/auth/forgot-password'      && req.method === 'POST') return withRateLimit(req, env, allowOrigin, 'auth', handleForgotPassword);
    if (url.pathname === '/auth/reset-password'       && req.method === 'POST') return withRateLimit(req, env, allowOrigin, 'auth', handleResetPassword);
    if (url.pathname === '/auth/change-password'      && req.method === 'POST') return withRateLimit(req, env, allowOrigin, 'auth', handleChangePassword);
    if (url.pathname === '/plan'          && req.method === 'GET')  return handleGetPlan(req, env, allowOrigin);
    if (url.pathname === '/plan'          && req.method === 'PUT')  return handlePutPlan(req, env, allowOrigin);
    if (url.pathname === '/plan'          && req.method === 'DELETE') return handleDeletePlan(req, env, allowOrigin);
    if (url.pathname === '/account'       && req.method === 'GET')  return handleGetAccount(req, env, allowOrigin);
    if (url.pathname === '/account'       && req.method === 'DELETE') return withRateLimit(req, env, allowOrigin, 'auth', handleDeleteAccount);
    if (url.pathname === '/calendar/token' && req.method === 'POST')   return handleCalendarToken(req, env, allowOrigin);
    if (url.pathname === '/calendar/token' && req.method === 'DELETE') return handleCalendarTokenDelete(req, env, allowOrigin);
    if (url.pathname === '/account/reminders' && req.method === 'POST') return handleSetReminders(req, env, allowOrigin);

    if (url.pathname === '/ai' && req.method === 'POST') return withRateLimit(req, env, allowOrigin, 'ai', handleAi);

    // Kept at POST / (rather than moving to a new path) so existing Strava-only deployments
    // don't need a URL change — the body now carries an optional `provider` field, defaulting
    // to 'strava' for callers that predate Garmin/Polar support.
    if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '')) {
      return handleTokenExchange(req, env, allowOrigin);
    }

    if (url.pathname === '/garmin/activities' && req.method === 'GET') {
      // See the GARMIN note at the top of this file — real activity data needs a
      // webhook receiver + storage that this worker doesn't implement yet.
      return json({ error: 'Garmin activity sync is not wired up yet — connect works, activity pull needs a webhook/backfill integration' }, 501, allowOrigin);
    }

    return json({ error: 'Not found' }, 404, allowOrigin);
  },

  // Hourly cron (see wrangler.toml [triggers]): sends "today's workout" emails to
  // opted-in, verified users whose local time is 6 AM. Rest days send nothing —
  // the quiet coach doesn't email to say "do nothing today".
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDailyReminders(env));
  },
};

async function sendDailyReminders(env) {
  if (!env.DB || !env.RESEND_API_KEY) return;

  const { results } = await env.DB.prepare(
    'SELECT u.email, u.tz, p.schedule_json FROM users u JOIN plans p ON p.user_id = u.id ' +
    'WHERE u.reminders = 1 AND u.email_verified = 1 AND p.schedule_json IS NOT NULL'
  ).all();

  for (const row of results || []) {
    try {
      const tz = row.tz || 'UTC';
      const hour = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date());
      if (parseInt(hour, 10) !== 6) continue; // not 6 AM in this user's zone

      const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const sessions = JSON.parse(row.schedule_json).filter(s => s.date === today && s.type !== 'rest');
      if (!sessions.length) continue;

      const list = sessions.map(s => {
        const sport = String(s.type || '').replace(/^./, c => c.toUpperCase());
        const mins  = s.duration > 0 ? ` — ${Math.round(s.duration)} min` : '';
        return `<li><strong>[${sport}]</strong> ${escapeHtml(s.label || sport)}${mins}</li>`;
      }).join('');
      const first   = sessions[0];
      const subject = sessions.length === 1
        ? `Today: ${first.label || first.type}${first.duration > 0 ? ` — ${Math.round(first.duration)} min` : ''}`
        : `Today: ${sessions.length} sessions`;

      await sendEmail(env, row.email, subject,
        `<p>On the plan today:</p><ul>${list}</ul>` +
        `<p style="color:#666;font-size:13px;">You can turn these emails off any time from your account menu on the dashboard.</p>`);
    } catch (e) {
      console.error('[reminders] failed for a user', e);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Rate limiting (KV-optional) ──────────────────────────────────
// Fixed-window counter keyed on client IP. No-ops when env.RATE_LIMIT (a KV namespace) is
// not bound, so the worker runs unchanged in local dev and before the namespace is created.

async function withRateLimit(req, env, allowOrigin, bucket, handler) {
  const overLimit = await isRateLimited(req, env, bucket);
  if (overLimit) return json({ error: 'Too many requests — slow down and try again shortly' }, 429, allowOrigin);
  return handler(req, env, allowOrigin);
}

async function isRateLimited(req, env, bucket) {
  if (!env.RATE_LIMIT) return false; // KV not bound → limiting disabled
  const cfg = RATE_LIMITS[bucket];
  if (!cfg) return false;
  const ip     = req.headers.get('CF-Connecting-IP') || 'unknown';
  const window = Math.floor(Date.now() / 1000 / cfg.windowSec);
  const key    = `rl:${bucket}:${ip}:${window}`;
  try {
    const current = parseInt(await env.RATE_LIMIT.get(key), 10) || 0;
    if (current >= cfg.limit) return true;
    await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: cfg.windowSec });
    return false;
  } catch {
    return false; // never let a KV hiccup take down the endpoint
  }
}

// ── Accounts ─────────────────────────────────────────────────────

async function handleRegister(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  if (!env.SESSION_SECRET) return json({ error: 'Accounts not configured — set SESSION_SECRET secret' }, 503, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const email    = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400, allowOrigin);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400, allowOrigin);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'An account with this email already exists' }, 409, allowOrigin);

  const id           = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const createdAt    = Date.now();

  await env.DB.prepare('INSERT INTO users (id, email, password_hash, created_at, email_verified) VALUES (?, ?, ?, ?, 0)')
    .bind(id, email, passwordHash, createdAt).run();

  // Don't block account creation on the email provider — a Resend outage shouldn't
  // stop someone from signing up; they can always hit /auth/resend-verification later.
  await sendVerificationLink(req, env, allowOrigin, id, email);

  const token = await signSession(env, id);
  return json({ token, email, verified: false }, 201, allowOrigin);
}

async function handleLogin(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  if (!env.SESSION_SECRET) return json({ error: 'Accounts not configured — set SESSION_SECRET secret' }, 503, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const email    = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const user = await env.DB.prepare('SELECT id, password_hash, email_verified FROM users WHERE email = ?').bind(email).first();
  const ok   = user && await verifyPassword(password, user.password_hash);
  if (!ok) return json({ error: 'Incorrect email or password' }, 401, allowOrigin);

  const token = await signSession(env, user.id);
  return json({ token, email, verified: !!user.email_verified }, 200, allowOrigin);
}

// ── Account details ────────────────────────────────────────────────

async function handleGetAccount(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);

  const user = await env.DB.prepare('SELECT email, created_at, email_verified, calendar_token, reminders FROM users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: 'Account not found' }, 404, allowOrigin);
  return json({
    email:       user.email,
    createdAt:   user.created_at,
    verified:    !!user.email_verified,
    reminders:   !!user.reminders,
    calendarUrl: user.calendar_token ? `${new URL(req.url).origin}/calendar?t=${user.calendar_token}` : null,
  }, 200, allowOrigin);
}

// ── Email confirmation ───────────────────────────────────────────

async function handleResendVerification(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);

  const user = await env.DB.prepare('SELECT email, email_verified FROM users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: 'Account not found' }, 404, allowOrigin);
  if (user.email_verified) return json({ ok: true, alreadyVerified: true }, 200, allowOrigin);

  await env.DB.prepare('DELETE FROM verification_tokens WHERE user_id = ?').bind(userId).run();
  await sendVerificationLink(req, env, allowOrigin, userId, user.email);
  return json({ ok: true }, 200, allowOrigin);
}

// Clicked from the confirmation email — a plain top-level GET, so this is a redirect,
// not a JSON response. `redirect` is validated against the allow-list before use (the
// token itself can't be used to redirect somewhere off-list).
async function handleVerifyEmail(req, env, allowedOrigins) {
  const url           = new URL(req.url);
  const token         = url.searchParams.get('token') || '';
  const redirectParam = url.searchParams.get('redirect') || '';
  const dest           = allowedOrigins.includes(redirectParam) ? redirectParam : (allowedOrigins[0] || '');

  if (!env.DB || !token) return Response.redirect(`${dest}/?verified=0`, 302);

  const row = await env.DB.prepare('SELECT user_id, expires_at FROM verification_tokens WHERE token = ?').bind(token).first();
  if (!row || row.expires_at < Date.now()) {
    if (row) await env.DB.prepare('DELETE FROM verification_tokens WHERE token = ?').bind(token).run();
    return Response.redirect(`${dest}/?verified=0`, 302);
  }

  await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(row.user_id).run();
  await env.DB.prepare('DELETE FROM verification_tokens WHERE user_id = ?').bind(row.user_id).run();
  return Response.redirect(`${dest}/?verified=1`, 302);
}

const VERIFY_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

async function sendVerificationLink(req, env, allowOrigin, userId, email) {
  if (!env.DB) return;
  const token     = b64encode(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + VERIFY_TOKEN_TTL_MS;
  await env.DB.prepare('INSERT INTO verification_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt).run();

  const workerOrigin = new URL(req.url).origin;
  const verifyUrl = `${workerOrigin}/auth/verify?token=${token}&redirect=${encodeURIComponent(allowOrigin)}`;
  await sendVerificationEmail(env, email, verifyUrl);
}

async function sendVerificationEmail(env, to, verifyUrl) {
  await sendEmail(env, to, 'Confirm your email',
    `<p>Welcome — click below to confirm your email and finish setting up your account.</p>` +
    `<p><a href="${verifyUrl}">Confirm email address</a></p>` +
    `<p>This link expires in 24 hours. You can keep using the dashboard before confirming — this just verifies it's really you.</p>`);
}

async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) { console.error('[email] RESEND_API_KEY not set — skipping email'); return; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    env.EMAIL_FROM || 'Training Dashboard <onboarding@resend.dev>',
        to:      [to],
        subject,
        html,
      }),
    });
    if (!res.ok) console.error('[email] Resend send failed', res.status, await res.text());
  } catch (e) {
    console.error('[email] failed to reach Resend', e);
  }
}

// ── Password reset / change ──────────────────────────────────────

const RESET_TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutes

async function handleForgotPassword(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const email = String(body.email || '').trim().toLowerCase();
  // Always answer ok — revealing whether an email has an account enables enumeration.
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (user) {
    await env.DB.prepare('DELETE FROM reset_tokens WHERE user_id = ?').bind(user.id).run();
    const token = b64encode(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare('INSERT INTO reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(token, user.id, Date.now() + RESET_TOKEN_TTL_MS).run();
    const resetUrl = `${allowOrigin}/?reset=${token}`;
    await sendEmail(env, email, 'Reset your password',
      `<p>Someone (hopefully you) asked to reset the password for this account.</p>` +
      `<p><a href="${resetUrl}">Choose a new password</a></p>` +
      `<p>This link expires in 30 minutes. If you didn't ask for this, you can ignore it — your password is unchanged.</p>`);
  }
  return json({ ok: true }, 200, allowOrigin);
}

async function handleResetPassword(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  if (!env.SESSION_SECRET) return json({ error: 'Accounts not configured — set SESSION_SECRET secret' }, 503, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const token    = String(body.token || '');
  const password = String(body.password || '');
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400, allowOrigin);

  const row = await env.DB.prepare('SELECT user_id, expires_at FROM reset_tokens WHERE token = ?').bind(token).first();
  if (!row || row.expires_at < Date.now()) {
    if (row) await env.DB.prepare('DELETE FROM reset_tokens WHERE token = ?').bind(token).run();
    return json({ error: 'This reset link has expired — request a new one' }, 400, allowOrigin);
  }

  const passwordHash = await hashPassword(password);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, row.user_id).run();
  await env.DB.prepare('DELETE FROM reset_tokens WHERE user_id = ?').bind(row.user_id).run();

  // Log the user straight in — they just proved control of the email.
  const user = await env.DB.prepare('SELECT email, email_verified FROM users WHERE id = ?').bind(row.user_id).first();
  const sessionToken = await signSession(env, row.user_id);
  return json({ token: sessionToken, email: user.email, verified: !!user.email_verified }, 200, allowOrigin);
}

async function handleChangePassword(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const current = String(body.currentPassword || '');
  const next    = String(body.newPassword || '');
  if (next.length < 8) return json({ error: 'New password must be at least 8 characters' }, 400, allowOrigin);

  const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: 'Account not found' }, 404, allowOrigin);
  const ok = await verifyPassword(current, user.password_hash);
  if (!ok) return json({ error: 'Current password is incorrect' }, 401, allowOrigin);

  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(next), userId).run();
  return json({ ok: true }, 200, allowOrigin);
}

async function handleDeleteAccount(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: 'Account not found' }, 404, allowOrigin);
  // Require the password again, not just a valid session token, so a stolen/long-lived
  // token alone can't be used to permanently delete the account.
  const ok = await verifyPassword(String(body.password || ''), user.password_hash);
  if (!ok) return json({ error: 'Incorrect password' }, 401, allowOrigin);

  await env.DB.prepare('DELETE FROM plans WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM verification_tokens WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM reset_tokens WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  return json({ ok: true }, 200, allowOrigin);
}

// ── Calendar feed (per-user ICS subscription) ────────────────────
// The dashboard pushes its computed day-by-day schedule on every plan sync, and the
// feed renders straight from that — so a subscribed calendar always mirrors the app,
// including AI edits and rule-engine reschedules, with nothing to re-download.

async function handleCalendarToken(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);

  const user = await env.DB.prepare('SELECT calendar_token FROM users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: 'Account not found' }, 404, allowOrigin);

  let token = user.calendar_token;
  if (!token) {
    token = b64encode(crypto.getRandomValues(new Uint8Array(24)));
    await env.DB.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').bind(token, userId).run();
  }
  const feedUrl = `${new URL(req.url).origin}/calendar?t=${token}`;
  return json({ url: feedUrl }, 200, allowOrigin);
}

async function handleCalendarTokenDelete(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);
  await env.DB.prepare('UPDATE users SET calendar_token = NULL WHERE id = ?').bind(userId).run();
  return json({ ok: true }, 200, allowOrigin);
}

async function handleCalendarFeed(req, env) {
  const token = new URL(req.url).searchParams.get('t') || '';
  if (!env.DB || !token) return new Response('Not found', { status: 404 });

  const user = await env.DB.prepare('SELECT id FROM users WHERE calendar_token = ?').bind(token).first();
  if (!user) return new Response('Not found', { status: 404 });

  const row = await env.DB.prepare('SELECT plan_json, schedule_json FROM plans WHERE user_id = ?').bind(user.id).first();
  const schedule = row?.schedule_json ? JSON.parse(row.schedule_json) : [];
  let raceName = 'Training Plan';
  try { raceName = JSON.parse(row.plan_json).raceName || raceName; } catch { /* keep default */ }

  const icsEscape = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//jm-dashboard//training-plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(raceName)} — Training`,
    'X-PUBLISHED-TTL:PT6H',
  ];
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  for (const s of schedule) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '') || s.type === 'rest') continue;
    const d0 = s.date.replace(/-/g, '');
    const next = new Date(`${s.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const d1 = next.toISOString().slice(0, 10).replace(/-/g, '');
    const sport = String(s.type || '').replace(/^./, c => c.toUpperCase());
    const mins  = Number(s.duration) > 0 ? ` — ${Math.round(s.duration)} min` : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.date}-${icsEscape(s.type)}@jm-dashboard`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${d0}`,
      `DTEND;VALUE=DATE:${d1}`,
      `SUMMARY:${icsEscape(`[${sport}] ${s.label || sport}${mins}`)}`,
      ...(s.phase ? [`DESCRIPTION:${icsEscape(`Phase: ${s.phase}`)}`] : []),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'max-age=3600',
    },
  });
}

// ── Email reminder preference ────────────────────────────────────

async function handleSetReminders(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const enabled = body.enabled ? 1 : 0;
  // IANA zone from the browser (Intl.DateTimeFormat().resolvedOptions().timeZone);
  // validated by actually trying to format with it.
  let tz = String(body.tz || 'UTC');
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }

  await env.DB.prepare('UPDATE users SET reminders = ?, tz = ? WHERE id = ?').bind(enabled, tz, userId).run();
  return json({ ok: true, reminders: !!enabled }, 200, allowOrigin);
}

// ── Plan sync ────────────────────────────────────────────────────

async function handleGetPlan(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);

  const row = await env.DB.prepare('SELECT plan_json, updated_at FROM plans WHERE user_id = ?').bind(userId).first();
  return json({ plan: row ? JSON.parse(row.plan_json) : null, updatedAt: row?.updated_at ?? null }, 200, allowOrigin);
}

async function handlePutPlan(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }
  if (!body.plan) return json({ error: 'Missing plan' }, 400, allowOrigin);

  const planJson = JSON.stringify(body.plan);
  if (new TextEncoder().encode(planJson).length > PLAN_MAX_BYTES) {
    return json({ error: 'Plan too large' }, 413, allowOrigin);
  }

  // Optional client-computed day-by-day schedule — feeds the calendar feed and
  // reminder emails. Kept as a sanitized flat list, capped so it can't balloon.
  let scheduleJson = null;
  if (Array.isArray(body.schedule)) {
    const clean = body.schedule.slice(0, 1000)
      .filter(s => s && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date || '')))
      .map(s => ({
        date:     s.date,
        type:     String(s.type || '').slice(0, 20),
        label:    String(s.label || '').slice(0, 200),
        duration: Number(s.duration) || 0,
        ...(s.phase ? { phase: String(s.phase).slice(0, 100) } : {}),
      }));
    scheduleJson = JSON.stringify(clean);
    if (new TextEncoder().encode(scheduleJson).length > PLAN_MAX_BYTES) scheduleJson = null;
  }

  const updatedAt = Date.now();
  await env.DB.prepare(
    'INSERT INTO plans (user_id, plan_json, schedule_json, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET plan_json = excluded.plan_json, schedule_json = excluded.schedule_json, updated_at = excluded.updated_at'
  ).bind(userId, planJson, scheduleJson, updatedAt).run();

  return json({ ok: true, updatedAt }, 200, allowOrigin);
}

// Used when the athlete archives a finished plan — clears the synced copy so the
// next device pull doesn't resurrect it while they build the next block.
async function handleDeletePlan(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);
  const userId = await requireSession(req, env);
  if (!userId) return json({ error: 'Not authenticated' }, 401, allowOrigin);
  await env.DB.prepare('DELETE FROM plans WHERE user_id = ?').bind(userId).run();
  return json({ ok: true }, 200, allowOrigin);
}

// ── OAuth token exchange (Strava / Garmin / Polar) ────────────────

async function handleTokenExchange(req, env, allowOrigin) {
  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const provider = PROVIDER_CONFIG[body.provider || 'strava'] ? (body.provider || 'strava') : null;
  if (!provider) return json({ error: 'Unknown provider' }, 400, allowOrigin);
  const cfg = PROVIDER_CONFIG[provider];

  const clientId     = env[cfg.clientIdKey];
  const clientSecret = env[cfg.clientSecretKey];
  if (!clientId || !clientSecret) {
    return json({ error: `Worker not configured — set ${cfg.clientIdKey} and ${cfg.clientSecretKey} secrets` }, 503, allowOrigin);
  }

  const { grant_type, code, refresh_token, code_verifier, redirect_uri } = body;
  if (grant_type === 'authorization_code') {
    if (!code) return json({ error: 'Missing code' }, 400, allowOrigin);
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) return json({ error: 'Missing refresh_token' }, 400, allowOrigin);
  } else {
    return json({ error: 'Invalid grant_type' }, 400, allowOrigin);
  }

  let upstreamRes;
  try {
    if (cfg.auth === 'body') {
      // Strava: JSON body carrying client_id/client_secret.
      const payload = {
        client_id: clientId, client_secret: clientSecret, grant_type,
        ...(grant_type === 'authorization_code' ? { code } : { refresh_token }),
      };
      upstreamRes = await fetch(cfg.tokenUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    } else {
      // Garmin / Polar: HTTP Basic auth over a form-encoded body, per their OAuth2 docs.
      // Garmin's PKCE flow additionally needs code_verifier on the authorization_code leg;
      // both want redirect_uri echoed back (the frontend sends it, since only it knows it).
      const form = new URLSearchParams({ grant_type });
      if (grant_type === 'authorization_code') {
        form.set('code', code);
        if (redirect_uri) form.set('redirect_uri', redirect_uri);
        if (code_verifier) form.set('code_verifier', code_verifier);
      } else {
        form.set('refresh_token', refresh_token);
      }
      upstreamRes = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
        },
        body: form.toString(),
      });
    }
  } catch {
    return json({ error: `Failed to reach ${provider}` }, 502, allowOrigin);
  }

  const data = await upstreamRes.json();
  if (!upstreamRes.ok) {
    // Log the upstream detail server-side; return a generic message so we don't leak provider internals.
    console.error(`[${provider}] token exchange failed`, upstreamRes.status, data);
    const msg = (upstreamRes.status === 401 || upstreamRes.status === 403) ? 'Authorization failed'
              : (upstreamRes.status === 400) ? 'Invalid request'
              : 'Service unavailable';
    return json({ error: msg }, upstreamRes.status, allowOrigin);
  }

  // Return only the fields the frontend needs. expires_at is a unix timestamp for
  // Strava; Garmin/Polar return expires_in (seconds), normalized here so the frontend's
  // ensureFreshToken() can treat all three the same way. Polar also returns x_user_id,
  // the numeric AccessLink user id needed for its exercise-pull endpoints.
  return json({
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 0)),
    x_user_id:     data.x_user_id,
  }, 200, allowOrigin);
}

// ── Anthropic AI proxy ───────────────────────────────────────────

async function handleAi(req, env, allowOrigin) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI not configured — set ANTHROPIC_API_KEY secret' }, 503, allowOrigin);
  }

  const raw = await req.text();
  // Reject oversized prompts before parsing — this proxy spends the owner's Anthropic credits.
  if (raw.length > AI_MAX_BODY_BYTES) {
    return json({ error: 'Request too large' }, 413, allowOrigin);
  }

  let body;
  try { body = JSON.parse(raw); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  // Lock down what the browser can ask for: known model, bounded output, real messages.
  if (typeof body.model !== 'string' || !AI_ALLOWED_MODELS.includes(body.model)) {
    return json({ error: 'Model not allowed' }, 400, allowOrigin);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: 'Missing messages' }, 400, allowOrigin);
  }
  if (typeof body.max_tokens !== 'number' || !Number.isFinite(body.max_tokens) || body.max_tokens <= 0) {
    body.max_tokens = AI_MAX_TOKENS_CAP;
  } else {
    body.max_tokens = Math.min(Math.floor(body.max_tokens), AI_MAX_TOKENS_CAP);
  }

  let aiRes;
  try {
    aiRes = await fetch(ANTHROPIC_URL, {
      method:  'POST',
      headers: {
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type':      'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return json({ error: 'Failed to reach Anthropic' }, 502, allowOrigin);
  }

  const data = await aiRes.json();
  return json(data, aiRes.status, allowOrigin);
}

// ── Password hashing (PBKDF2-SHA256) ──────────────────────────────

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt);
  return `${b64encode(salt)}:${b64encode(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = String(stored).split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = b64decode(saltB64);
  const bits = await deriveBits(password, salt);
  return timingSafeEqual(new Uint8Array(bits), b64decode(hashB64));
}

async function deriveBits(password, salt) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
}

// ── Session tokens (HMAC-signed, stateless) ───────────────────────

async function signSession(env, userId) {
  const payload   = b64encode(new TextEncoder().encode(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC })));
  const signature = await hmac(env.SESSION_SECRET, payload);
  return `${payload}.${signature}`;
}

async function verifySession(env, token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = await hmac(env.SESSION_SECRET, payload);
  if (!timingSafeEqualStr(expected, signature)) return null;
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(b64decode(payload))); }
  catch { return null; }
  if (!claims.sub || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims.sub;
}

async function requireSession(req, env) {
  if (!env.SESSION_SECRET) return null;
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  return verifySession(env, token);
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64encode(new Uint8Array(sig));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function timingSafeEqualStr(a, b) {
  return timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

function b64encode(bytes) {
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Helpers ──────────────────────────────────────────────────────

function corsHeaders(allowOrigin) {
  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status, allowOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(allowOrigin) },
  });
}
