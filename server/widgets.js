'use strict';
// Widget loader. Every folder in /widgets (and in $DATA_DIR/widgets for user
// widgets that survive updates) with a server.js is a widget type.
// See docs/WRITING_WIDGETS.md.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const BUILTIN_DIR = path.join(__dirname, '..', 'widgets');
const USER_DIR = path.join(config.DATA_DIR, 'widgets');

const types = new Map(); // type -> { meta, data, clientFile }
const cache = new Map(); // widget id -> { at, value, pending }

function loadDir(dir, origin) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const folder = path.join(dir, name);
    const serverFile = path.join(folder, 'server.js');
    if (!fs.existsSync(serverFile)) continue;
    try {
      const mod = require(serverFile);
      if (!mod.meta || !mod.meta.type) throw new Error('missing meta.type');
      const clientFile = path.join(folder, 'client.js');
      types.set(mod.meta.type, {
        meta: { refreshSec: 300, fields: [], ...mod.meta },
        data: mod.data || null,
        clientFile: fs.existsSync(clientFile) ? clientFile : null,
        origin,
      });
    } catch (e) {
      console.error(`[widgets] failed to load ${name}: ${e.message}`);
    }
  }
}

function loadAll() {
  types.clear();
  loadDir(BUILTIN_DIR, 'builtin');
  loadDir(USER_DIR, 'user');
  console.log(`[widgets] loaded: ${[...types.keys()].join(', ')}`);
}

function secretKeys(type) {
  const t = types.get(type);
  return new Set(((t && t.meta.fields) || []).filter((f) => f.secret).map((f) => f.key));
}

function publicOptions(widget) {
  const secrets = secretKeys(widget.type);
  return Object.fromEntries(Object.entries(widget.options || {}).filter(([k]) => !secrets.has(k)));
}

async function getData(widget, ctx) {
  const t = types.get(widget.type);
  if (!t) throw new Error(`unknown widget type "${widget.type}"`);
  if (!t.data) return {};
  const ttl = (t.meta.refreshSec || 300) * 1000;
  const entry = cache.get(widget.id);
  if (entry && entry.pending) return entry.pending;
  if (entry && Date.now() - entry.at < ttl) {
    if (entry.error) throw new Error(entry.error);
    return entry.value;
  }

  const pending = Promise.resolve(t.data(widget.options || {}, { ...ctx, widgetId: widget.id }))
    .then((value) => {
      cache.set(widget.id, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      // Serve the last good data (marked stale) rather than blanking the screen.
      const last = cache.get(widget.id);
      console.error(`[widget ${widget.id}] ${err.message}`);
      if (last && last.value) {
        cache.set(widget.id, { at: Date.now() - ttl + 30000, value: last.value }); // retry in 30s
        return { ...last.value, _stale: true, _error: err.message };
      }
      cache.set(widget.id, { at: Date.now() - ttl + 15000, value: null, error: err.message }); // back off 15s
      throw err;
    });
  cache.set(widget.id, { at: entry ? entry.at : 0, value: entry ? entry.value : null, pending });
  return pending;
}

function clearCache() {
  cache.clear();
}

module.exports = { types, loadAll, publicOptions, secretKeys, getData, clearCache };
