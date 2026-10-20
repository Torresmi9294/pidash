'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const widgets = require('./widgets');
const google = require('./google');
const store = require('./store');
const health = require('./health');
const logos = require('./logos');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BG_DIR = path.join(config.DATA_DIR, 'backgrounds');
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminAuth(req, res, next) {
  const pw = config.get().admin.password;
  if (!pw) return next();
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (m) {
    const given = Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':');
    if (safeEqual(given, pw)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="PiDash admin"');
  res.status(401).send('Authentication required');
}

// Replace stored secrets with a mask before sending config to the browser...
function maskConfig(cfg) {
  const out = JSON.parse(JSON.stringify(cfg));
  out.admin = { hasPassword: !!cfg.admin.password };
  out.google.clientSecret = cfg.google.clientSecret ? config.SECRET_MASK : '';
  out.google.tokens = undefined;
  out.health = undefined;
  for (const w of out.widgets) {
    for (const key of widgets.secretKeys(w.type)) {
      if (w.options && w.options[key]) w.options[key] = config.SECRET_MASK;
    }
  }
  return out;
}

// Rotating-grid panes: keep only well-formed entries.
function sanitizePanes(list) {
  return (Array.isArray(list) ? list : []).slice(0, 100)
    .map((p) => ({
      widgets: (Array.isArray(p && p.widgets) ? p.widgets : []).map(String).slice(0, 20),
      size: ['s', 'w', 't', 'l'].includes(p && p.size) ? p.size : 's',
      seconds: Number(p && p.seconds) >= 5 ? Math.min(Number(p.seconds), 3600) : '',
    }))
    .filter((p) => p.widgets.length)
    .slice(0, 12);
}

// ...and put them back when the browser sends the mask unchanged.
function unmaskInto(incoming, existing) {
  const next = config.merge(existing, { display: incoming.display || {} });
  if (incoming.display && 'gridPanes' in incoming.display) next.display.gridPanes = sanitizePanes(incoming.display.gridPanes);
  if (incoming.google) {
    const g = incoming.google;
    next.google.clientId = String(g.clientId || '').trim();
    next.google.redirectUri = String(g.redirectUri || '').trim();
    if (g.clientSecret !== config.SECRET_MASK) next.google.clientSecret = String(g.clientSecret || '').trim();
  }
  if (incoming.admin && typeof incoming.admin.newPassword === 'string') next.admin.password = incoming.admin.newPassword;
  if (Array.isArray(incoming.widgets)) {
    const old = new Map(existing.widgets.map((w) => [w.id, w]));
    next.widgets = incoming.widgets.map((w) => {
      if (!widgets.types.has(w.type)) throw new Error(`Unknown widget type "${w.type}"`);
      const prev = old.get(w.id);
      const options = { ...(w.options || {}) };
      // Generic options every widget has: a custom card title and a switch to hide the title bar.
      if ('title' in options) options.title = String(options.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!options.title) delete options.title;
      if ('hideTitle' in options) options.hideTitle = options.hideTitle === true;
      for (const key of widgets.secretKeys(w.type)) {
        if (options[key] === config.SECRET_MASK) options[key] = prev && prev.options ? prev.options[key] || '' : '';
      }
      return {
        id: String(w.id),
        type: w.type,
        enabled: w.enabled !== false,
        slot: w.slot === 'sidebar' ? 'sidebar' : 'rotate',
        options,
      };
    });
  }
  return next;
}

function createApp() {
  config.load();
  widgets.loadAll();

  const app = express();
  app.disable('x-powered-by');
  // Health ingest: phones POST here with the health token (separate from the admin password).
  app.post('/api/health/ingest', express.json({ limit: '2mb' }), (req, res) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const given = (m && m[1]) || req.headers['x-api-key'] || req.query.token;
    if (!config.get().health.token) return res.status(403).json({ error: 'Health ingest is not enabled yet. Open Admin > Health.' });
    if (!health.tokenOk(given)) return res.status(401).json({ error: 'Invalid token.' });
    try {
      const r = health.ingest(req.body);
      widgets.clearCache();
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.use(express.json({ limit: '256kb' }));

  // ---- live reload (SSE) -------------------------------------------------
  const clients = new Set();
  function broadcast() {
    for (const c of clients) c.write(`event: config\ndata: ${config.getRev()}\n\n`);
  }
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(`retry: 5000\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // ---- display API (read-only, no secrets) -------------------------------
  app.get('/api/display', (req, res) => {
    const cfg = config.get();
    res.set('Cache-Control', 'no-store');
    res.json({
      rev: config.getRev(),
      display: cfg.display,
      widgets: cfg.widgets
        .filter((w) => w.enabled && widgets.types.has(w.type))
        .map((w) => ({
          id: w.id,
          type: w.type,
          slot: w.slot,
          name: widgets.types.get(w.type).meta.name,
          refreshSec: widgets.types.get(w.type).meta.refreshSec,
          clientOnly: !widgets.types.get(w.type).data,
          options: widgets.publicOptions(w),
        })),
    });
  });

  app.get('/api/widgets/:id/data', async (req, res) => {
    const cfg = config.get();
    const w = cfg.widgets.find((x) => x.id === req.params.id && x.enabled);
    if (!w) return res.status(404).json({ error: 'No such widget' });
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await widgets.getData(w, { display: cfg.display }));
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  app.get('/widget-client/:type.js', (req, res) => {
    const t = widgets.types.get(req.params.type);
    if (!t || !t.clientFile) return res.status(404).end();
    res.type('js').sendFile(t.clientFile);
  });

  // Optional widget-bundled static files, e.g. /widget-assets/<type>/logo.png
  app.get('/widget-assets/:type/*', (req, res) => {
    const t = widgets.types.get(req.params.type);
    if (!t || !t.clientFile) return res.status(404).end();
    const root = path.dirname(t.clientFile);
    const file = path.resolve(root, 'assets', req.params[0]);
    if (!file.startsWith(path.join(root, 'assets') + path.sep)) return res.status(400).end();
    res.sendFile(file, (err) => err && !res.headersSent && res.status(404).end());
  });

  // Cached, server-side fetched team logos (see server/logos.js).
  app.get('/api/logo', async (req, res) => {
    try {
      const img = await logos.get(String(req.query.w || ''), String(req.query.u || ''));
      res.set({
        'Content-Type': img.type,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        // SVGs can carry scripts; this keeps them inert even if opened directly.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
      res.send(img.buf);
    } catch (e) {
      res.status(e.status || 502).type('text/plain').send(e.status === 403 ? 'Not allowed' : 'Logo unavailable');
    }
  });

  app.get('/api/backgrounds', (req, res) => {
    let files = [];
    try {
      files = fs.readdirSync(BG_DIR).filter((f) => IMAGE_RE.test(f));
    } catch {
      /* none */
    }
    res.json(files.map((f) => `/backgrounds/${encodeURIComponent(f)}`));
  });
  app.use('/backgrounds', express.static(BG_DIR, { maxAge: '1h' }));

  // Google redirects the browser here when it can reach the Pi at "localhost".
  app.get('/api/google/callback', async (req, res) => {
    try {
      if (req.query.error) throw new Error(String(req.query.error));
      await google.exchange(`http://x/?code=${encodeURIComponent(req.query.code || '')}&state=${encodeURIComponent(req.query.state || '')}`, { requireState: true });
      widgets.clearCache();
      res.redirect('/admin/#google-connected');
    } catch (e) {
      res.status(400).send(`<p>Google sign-in failed: ${String(e.message).replace(/[<>&]/g, '')}</p><p><a href="/admin/">Back to admin</a></p>`);
    }
  });

  // ---- admin API ---------------------------------------------------------
  const admin = express.Router();
  admin.use(adminAuth);

  admin.get('/config', (req, res) => res.json(maskConfig(config.get())));

  admin.put('/config', (req, res) => {
    try {
      const next = unmaskInto(req.body || {}, config.get());
      config.save(next);
      widgets.clearCache();
      broadcast();
      res.json(maskConfig(next));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  admin.get('/widget-types', (req, res) => {
    res.json([...widgets.types.values()].map((t) => ({ ...t.meta, origin: t.origin })));
  });

  admin.get('/google/status', (req, res) => res.json(google.status()));
  admin.post('/google/auth-url', (req, res) => {
    try {
      res.json({ url: google.authUrl() });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  admin.post('/google/exchange', async (req, res) => {
    try {
      await google.exchange(req.body && req.body.code);
      widgets.clearCache();
      broadcast();
      res.json(google.status());
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  admin.post('/google/disconnect', (req, res) => {
    google.disconnect();
    widgets.clearCache();
    res.json(google.status());
  });
  admin.get('/google/calendars', async (req, res) => {
    try {
      res.json(await google.listCalendars());
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  admin.get('/reminders', (req, res) => res.json(store.listReminders()));
  admin.post('/reminders', (req, res) => {
    try {
      const item = store.addReminder(req.body || {});
      widgets.clearCache();
      broadcast();
      res.json(item);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  admin.patch('/reminders/:id', (req, res) => {
    const item = store.updateReminder(req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: 'Not found' });
    widgets.clearCache();
    broadcast();
    res.json(item);
  });
  admin.delete('/reminders/:id', (req, res) => {
    widgets.clearCache();
    broadcast();
    res.json({ deleted: store.deleteReminder(req.params.id) });
  });

  admin.get('/health/info', (req, res) => res.json({ token: health.ensureToken(), people: health.people() }));
  admin.post('/health/token', (req, res) => res.json({ token: health.regenerateToken() }));
  admin.post('/health/sample', (req, res) => {
    health.sample(String((req.body && req.body.person) || 'me'));
    widgets.clearCache();
    res.json({ people: health.people() });
  });
  admin.delete('/health/data', (req, res) => {
    health.clear();
    widgets.clearCache();
    res.json({ people: [] });
  });

  admin.get('/new-id/:type', (req, res) => res.json({ id: config.newId(req.params.type.replace(/[^a-z0-9-]/gi, '')) }));

  app.use('/api/admin', admin);
  app.use('/admin', adminAuth, express.static(path.join(PUBLIC_DIR, 'admin')));
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: 0 }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

module.exports = { createApp };
