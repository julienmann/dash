/**
 * Strava OAuth Token Exchange Worker
 *
 * Proxies authorization_code and refresh_token exchanges so the
 * Client Secret never touches the browser.
 *
 * Deploy:
 *   wrangler secret put STRAVA_CLIENT_ID
 *   wrangler secret put STRAVA_CLIENT_SECRET
 *   wrangler deploy
 *
 * Environment variables (set via `wrangler secret put`):
 *   STRAVA_CLIENT_ID     — numeric Client ID from strava.com/settings/api
 *   STRAVA_CLIENT_SECRET — 40-char hex Client Secret
 */

const ALLOWED_ORIGINS = [
  'https://julienmann.ca',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, origin);
    }

    const { grant_type, code, refresh_token } = body;

    if (!grant_type) {
      return json({ error: 'grant_type is required' }, 400, origin);
    }

    const params = new URLSearchParams({
      client_id:     env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type,
    });

    if (grant_type === 'authorization_code') {
      if (!code) return json({ error: 'code is required' }, 400, origin);
      params.set('code', code);
    } else if (grant_type === 'refresh_token') {
      if (!refresh_token) return json({ error: 'refresh_token is required' }, 400, origin);
      params.set('refresh_token', refresh_token);
    } else {
      return json({ error: 'grant_type must be authorization_code or refresh_token' }, 400, origin);
    }

    let stravaRes;
    try {
      stravaRes = await fetch('https://www.strava.com/oauth/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    params,
      });
    } catch {
      return json({ error: 'Failed to reach Strava' }, 502, origin);
    }

    const data = await stravaRes.json();

    if (!stravaRes.ok) {
      return json({ error: data.message || 'Strava error', details: data }, stravaRes.status, origin);
    }

    // Return only what the client needs — never forward client secrets
    return json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
      athlete:       data.athlete,
    }, 200, origin);
  },
};
