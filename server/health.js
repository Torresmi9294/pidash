'use strict';
// Health data store. Phones/watches PUSH daily summaries to /api/health/ingest
// (Apple Health and Health Connect have no cloud API to pull from).
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const FILE = path.join(config.DATA_DIR, 'health.json');
const KEEP_DAYS = 60;
const KM_PER_MI = 1.609344;
const KG_PER_LB = 0.45359237;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function ensureToken() {
  const cfg = config.get();
  if (!cfg.health.token) {
    cfg.health.token = crypto.randomBytes(24).toString('hex');
    config.save(cfg);
  }
  return cfg.health.token;
}

function regenerateToken() {
  const cfg = config.get();
  cfg.health.token = crypto.randomBytes(24).toString('hex');
  config.save(cfg);
  return cfg.health.token;
}

function tokenOk(given) {
  const t = config.get().health.token;
  if (!t || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(t).digest();
  return crypto.timingSafeEqual(a, b);
}

const readAll = () => config.readJson(FILE, {});

// Accepts flexible key names and units; returns only valid metrics in canonical units
// (km, kg, hours, kcal, minutes, bpm).
function normalize(o) {
  const out = {};
  const set = (key, v, min, max) => {
    const n = num(v);
    if (n !== null && n >= min && n <= max) out[key] = Math.round(n * 100) / 100;
  };
  set('steps', o.steps, 0, 200000);
  set('heartRate', o.heartRate ?? o.heart_rate, 20, 300);
  set('restingHeartRate', o.restingHeartRate ?? o.resting_heart_rate, 20, 250);
  set('activeCalories', o.activeCalories ?? o.active_calories ?? o.calories, 0, 20000);
  set('exerciseMinutes', o.exerciseMinutes ?? o.exercise_minutes, 0, 1440);
  set('standHours', o.standHours ?? o.stand_hours, 0, 24);
  set('bloodOxygen', o.bloodOxygen ?? o.spo2, 50, 100);
  const sleepMin = num(o.sleepMinutes);
  set('sleepHours', o.sleepHours ?? (sleepMin === null ? undefined : sleepMin / 60), 0, 24);

  const unit = (u, a) => String(u || '').toLowerCase().startsWith(a);
  if (o.distanceKm != null) set('distanceKm', o.distanceKm, 0, 1000);
  else if (o.distanceMi != null) set('distanceKm', num(o.distanceMi) * KM_PER_MI, 0, 1000);
  else if (o.distance != null) set('distanceKm', num(o.distance) * (unit(o.distanceUnit, 'mi') ? KM_PER_MI : 1), 0, 1000);

  if (o.weightKg != null) set('weightKg', o.weightKg, 20, 500);
  else if (o.weightLb != null) set('weightKg', num(o.weightLb) * KG_PER_LB, 20, 500);
  else if (o.weight != null) set('weightKg', num(o.weight) * (unit(o.weightUnit, 'lb') ? KG_PER_LB : 1), 20, 500);
  return out;
}

// Health Auto Export (iOS app) JSON: { data: { metrics: [{ name, units, data: [{ date, qty|Avg|... }] }] } }
// Best-effort mapping of its common metrics; set the export to "Summarize data: day".
function fromHealthAutoExport(body) {
  const days = new Map();
  for (const m of (body.data && body.data.metrics) || []) {
    const name = String(m.name || '').toLowerCase();
    const units = String(m.units || '').toLowerCase();
    for (const e of m.data || []) {
      const date = String(e.date || '').slice(0, 10);
      if (!DATE_RE.test(date)) continue;
      const d = days.get(date) || { date };
      const q = num(e.qty);
      switch (name) {
        case 'step_count': d.steps = q; break;
        case 'active_energy': d.activeCalories = q === null ? null : units === 'kj' ? q / 4.184 : q; break;
        case 'apple_exercise_time': d.exerciseMinutes = q; break;
        case 'apple_stand_hour': d.standHours = q; break;
        case 'heart_rate': d.heartRate = num(e.Avg ?? e.avg ?? e.qty); break;
        case 'resting_heart_rate': d.restingHeartRate = q; break;
        case 'blood_oxygen_saturation': d.bloodOxygen = q !== null && q <= 1 ? q * 100 : q; break;
        case 'weight_body_mass': d.weight = q; d.weightUnit = units; break;
        case 'walking_running_distance':
        case 'distance_walking_running': d.distance = q; d.distanceUnit = units; break;
        case 'sleep_analysis':
          d.sleepHours = num(e.asleep ?? e.totalSleep) ?? (['deep', 'core', 'rem'].reduce((s, k) => s + (num(e[k]) || 0), 0) || undefined);
          break;
        default: break;
      }
      days.set(date, d);
    }
  }
  return [...days.values()];
}

function ingest(body) {
  if (!body || typeof body !== 'object') throw new Error('Expected a JSON body.');
  const person = String(body.person || 'me').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'me';
  let days;
  if (body.data && Array.isArray(body.data.metrics)) days = fromHealthAutoExport(body);
  else if (Array.isArray(body.days)) days = body.days;
  else days = [body];

  const all = readAll();
  const mine = all[person] || {};
  let stored = 0;
  for (const d of days) {
    const date = DATE_RE.test(String(d.date || '')) ? d.date : dayKey();
    const metrics = normalize(d);
    if (!Object.keys(metrics).length) continue;
    mine[date] = { ...(mine[date] || {}), ...metrics, updated: Date.now() };
    stored++;
  }
  if (!stored) throw new Error('No recognized health metrics in the request (e.g. steps, heartRate, sleepHours).');

  const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * 86400000));
  for (const k of Object.keys(mine)) if (k < cutoff) delete mine[k];
  all[person] = mine;
  config.writeJson(FILE, all);
  return { stored, person };
}

function summary(person) {
  const mine = readAll()[person];
  if (!mine || !Object.keys(mine).length) return null;
  const dates = Object.keys(mine).sort();
  const latest = dates[dates.length - 1];
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const key = dayKey(new Date(Date.now() - i * 86400000));
    week.push({ date: key, steps: (mine[key] && mine[key].steps) || 0 });
  }
  // Metrics that are not logged every day (weight, resting HR) fall back to the most recent value.
  const fallback = {};
  for (const k of ['weightKg', 'restingHeartRate', 'bloodOxygen']) {
    for (let i = dates.length - 1; i >= 0; i--) {
      if (mine[dates[i]][k] != null) { fallback[k] = mine[dates[i]][k]; break; }
    }
  }
  return { date: latest, isToday: latest === dayKey(), metrics: { ...fallback, ...mine[latest] }, week, updated: mine[latest].updated };
}

function people() {
  return Object.keys(readAll());
}

function clear() {
  config.writeJson(FILE, {});
}

function sample(person = 'me') {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const today = i === 0;
    days.push({
      date: dayKey(new Date(Date.now() - i * 86400000)),
      steps: today ? 6432 : 5000 + Math.round(Math.random() * 7000),
      activeCalories: today ? 410 : 300 + Math.round(Math.random() * 400),
      exerciseMinutes: today ? 28 : 10 + Math.round(Math.random() * 50),
      standHours: today ? 8 : 12,
      heartRate: 72, restingHeartRate: 58, sleepHours: 7.1, bloodOxygen: 97,
      distanceKm: today ? 4.8 : 6, weightKg: 79.4,
    });
  }
  return ingest({ person, days });
}

module.exports = { ensureToken, regenerateToken, tokenOk, ingest, summary, people, clear, sample, normalize, KM_PER_MI, KG_PER_LB };
