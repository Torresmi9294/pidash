'use strict';
// Minimal Google OAuth2 + Calendar client (no SDK, keeps the Pi install small).
const crypto = require('crypto');
const config = require('./config');

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
let pendingState = null;

function redirectUri() {
  const g = config.get().google;
  return g.redirectUri || `http://localhost:${process.env.PORT || 8080}/api/google/callback`;
}

function status() {
  const g = config.get().google;
  return {
    configured: !!(g.clientId && g.clientSecret),
    connected: !!(g.tokens && g.tokens.refresh_token),
    redirectUri: redirectUri(),
  };
}

function authUrl() {
  const g = config.get().google;
  if (!g.clientId || !g.clientSecret) throw new Error('Enter your Google Client ID and Client Secret first.');
  pendingState = crypto.randomBytes(16).toString('hex');
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: pendingState,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params) {
  const g = config.get().google;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.error || `Google token error ${res.status}`);
  return body;
}

// Accepts either a bare code or the full redirected URL (for when the browser that
// signed in was not the Pi itself and "localhost" failed to load).
async function exchange(input, { requireState = false } = {}) {
  let code = String(input || '').trim();
  let state = null;
  if (/^https?:\/\//.test(code)) {
    const u = new URL(code);
    code = u.searchParams.get('code') || '';
    state = u.searchParams.get('state');
  }
  if (!code) throw new Error('No authorization code found.');
  if ((requireState || state) && (!pendingState || state !== pendingState)) throw new Error('OAuth state mismatch - start the connection again.');
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  const cfg = config.get();
  cfg.google.tokens = {
    refresh_token: t.refresh_token || (cfg.google.tokens && cfg.google.tokens.refresh_token),
    access_token: t.access_token,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  };
  if (!cfg.google.tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and try again.');
  config.save(cfg);
  pendingState = null;
}

function disconnect() {
  const cfg = config.get();
  cfg.google.tokens = null;
  config.save(cfg);
}

async function accessToken() {
  const cfg = config.get();
  const t = cfg.google.tokens;
  if (!t || !t.refresh_token) throw new Error('Google Calendar is not connected (open the admin page > Google).');
  if (t.access_token && t.expires_at > Date.now()) return t.access_token;
  const r = await tokenRequest({ refresh_token: t.refresh_token, grant_type: 'refresh_token' });
  cfg.google.tokens = { ...t, access_token: r.access_token, expires_at: Date.now() + (r.expires_in - 60) * 1000 };
  config.save(cfg);
  return r.access_token;
}

async function api(url) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || `Google API error ${res.status}`);
  return body;
}

async function listCalendars() {
  const b = await api('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader');
  return (b.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary }));
}

async function events(calendarId, from, to) {
  const q = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });
  const b = await api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
  return (b.items || [])
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      id: e.id,
      title: e.summary || '(No title)',
      location: e.location || '',
      allDay: !!(e.start && e.start.date),
      start: e.start.date || e.start.dateTime,
      end: e.end.date || e.end.dateTime,
    }));
}

module.exports = { status, authUrl, exchange, disconnect, listCalendars, events };
