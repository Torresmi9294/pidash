'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SECRET_MASK = '__SET__';

const DEFAULTS = () => ({
  display: {
    title: 'PiDash',
    rotateSeconds: 20,
    theme: 'midnight',
    accent: '',
    bg1: '',
    bg2: '',
    cardStyle: 'glass',
    font: 'system',
    fontScale: 100,
    nightTheme: '',
    timeFormat: '12h',
    units: 'imperial',
    locale: '',
    rotation: 0,
    background: 'gradient',
    photoSeconds: 60,
    nightMode: false,
    nightStart: 23,
    nightEnd: 6,
    nightDim: 0.35,
  },
  admin: { password: '' },
  health: { token: '' },
  google: { clientId: '', clientSecret: '', redirectUri: '', tokens: null },
  widgets: [
    { id: 'clock-1', type: 'clock', enabled: true, slot: 'sidebar', options: {} },
    { id: 'weather-1', type: 'weather', enabled: true, slot: 'sidebar', options: { location: 'New York' } },
    { id: 'calendar-1', type: 'calendar', enabled: true, slot: 'rotate', options: {} },
    { id: 'reminders-1', type: 'reminders', enabled: true, slot: 'rotate', options: {} },
  ],
});

let config = null;
let rev = Date.now();

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Atomic write so a power cut on the Pi can't leave a half-written file.
function writeJson(file, obj) {
  ensureDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[config] could not read ${file}: ${e.message}`);
    return fallback;
  }
}

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  const saved = readJson(CONFIG_FILE, null);
  config = merge(DEFAULTS(), saved || {});
  if (!saved) {
    try {
      writeJson(CONFIG_FILE, config);
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EROFS') {
        console.error(`[config] ${DATA_DIR} is not writable by uid ${process.getuid && process.getuid()}. Fix the folder's ownership (or set PUID/PGID in Docker).`);
      }
      throw e;
    }
  }
  return config;
}

function get() {
  return config || load();
}

function save(next) {
  config = next;
  writeJson(CONFIG_FILE, config);
  rev = Date.now();
}

function getRev() {
  return rev;
}

function newId(type) {
  return `${type}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = { DATA_DIR, CONFIG_FILE, SECRET_MASK, load, get, save, getRev, merge, readJson, writeJson, newId, DEFAULTS };
