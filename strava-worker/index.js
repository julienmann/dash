/**
 * Strava OAuth + Anthropic AI proxy + accounts worker
 *
 * Keeps the Strava Client Secret, Anthropic API key, and password hashes
 * server-side. CORS headers restrict browser access to ALLOWED_ORIGIN; the
 * server-side Origin check blocks non-browser callers that ignore CORS.
 *
 * Required secrets (set via `wrangler secret put`):
 *   STRAVA_CLIENT_ID     — numeric ID from strava.com/settings/api
 *   STRAVA_CLIENT_SECRET — 40-char hex secret from the same page
 *   ANTHROPIC_API_KEY    — sk-ant-… key from console.anthropic.com
 *   SESSION_SECRET       — random 32+ byte string used to sign session tokens
 *
 * Required var (set in wrangler.toml [vars]):
 *   ALLOWED_ORIGIN — comma-separated dashboard origin(s), e.g.
 *                    https://julienmann.ca,http://localhost:8080
 *
 * Required binding (set in wrangler.toml [[d1_databases]]):
 *   DB — D1 database created from schema.sql, used for accounts + synced plans.
 */

const STRAVA_TOKEN_URL  = 'https://www.strava.com/oauth/token';
const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const SESSION_TTL_SEC   = 60 * 60 * 24 * 90; // 90 days

export default {
  async fetch(req, env) {
    const origin         = req.headers.get('Origin') || req.headers.get('Referer') || '';
    const allowedOrigins = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowOrigin    = allowedOrigins.find(a => origin.startsWith(a)) || allowedOrigins[0] || '*';

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
    }

    // Server-side origin check — CORS headers alone don't stop non-browser callers
    if (allowedOrigins.length && !allowedOrigins.some(a => origin.startsWith(a))) {
      return json({ error: 'Forbidden' }, 403, allowOrigin);
    }

    const url = new URL(req.url);

    if (url.pathname === '/auth/register' && req.method === 'POST') return handleRegister(req, env, allowOrigin);
    if (url.pathname === '/auth/login'    && req.method === 'POST') return handleLogin(req, env, allowOrigin);
    if (url.pathname === '/plan'          && req.method === 'GET')  return handleGetPlan(req, env, allowOrigin);
    if (url.pathname === '/plan'          && req.method === 'PUT')  return handlePutPlan(req, env, allowOrigin);

    if (url.pathname === '/ai' && req.method === 'POST') return handleAi(req, env, allowOrigin);

    if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '')) {
      if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
        return json({ error: 'Worker not configured — set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET secrets' }, 503, allowOrigin);
      }
      return handleStrava(req, env, allowOrigin);
    }

    return json({ error: 'Not found' }, 404, allowOrigin);
  },
};

// ── Accounts ─────────────────────────────────────────────────────

async function handleRegister(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);

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

  await env.DB.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, email, passwordHash, createdAt).run();

  const token = await signSession(env, id);
  return json({ token, email }, 201, allowOrigin);
}

async function handleLogin(req, env, allowOrigin) {
  if (!env.DB) return json({ error: 'Accounts not configured — bind a D1 database as DB' }, 503, allowOrigin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const email    = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?').bind(email).first();
  const ok   = user && await verifyPassword(password, user.password_hash);
  if (!ok) return json({ error: 'Incorrect email or password' }, 401, allowOrigin);

  const token = await signSession(env, user.id);
  return json({ token, email }, 200, allowOrigin);
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

  const updatedAt = Date.now();
  await env.DB.prepare(
    'INSERT INTO plans (user_id, plan_json, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET plan_json = excluded.plan_json, updated_at = excluded.updated_at'
  ).bind(userId, JSON.stringify(body.plan), updatedAt).run();

  return json({ ok: true, updatedAt }, 200, allowOrigin);
}

// ── Strava token exchange ────────────────────────────────────────

async function handleStrava(req, env, allowOrigin) {
  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

  const { grant_type, code, refresh_token } = body;

  if (grant_type === 'authorization_code') {
    if (!code) return json({ error: 'Missing code' }, 400, allowOrigin);
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) return json({ error: 'Missing refresh_token' }, 400, allowOrigin);
  } else {
    return json({ error: 'Invalid grant_type' }, 400, allowOrigin);
  }

  const payload = {
    client_id:     env.STRAVA_CLIENT_ID,
    client_secret: env.STRAVA_CLIENT_SECRET,
    grant_type,
    ...(grant_type === 'authorization_code' ? { code } : { refresh_token }),
  };

  let stravaRes;
  try {
    stravaRes = await fetch(STRAVA_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch {
    return json({ error: 'Failed to reach Strava' }, 502, allowOrigin);
  }

  const data = await stravaRes.json();
  if (!stravaRes.ok) {
    return json({ error: data.message || 'Strava rejected the request' }, stravaRes.status, allowOrigin);
  }

  // Return only the fields the frontend needs
  return json({
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    data.expires_at,
  }, 200, allowOrigin);
}

// ── Anthropic AI proxy ───────────────────────────────────────────

async function handleAi(req, env, allowOrigin) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI not configured — set ANTHROPIC_API_KEY secret' }, 503, allowOrigin);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, allowOrigin); }

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status, allowOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(allowOrigin) },
  });
}
