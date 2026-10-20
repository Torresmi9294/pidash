'use strict';
// Sleep schedule: when should the display be asleep? Shared by the display page, the admin page and the server
// (which tells the Pi's kiosk when to switch the monitor off), so they always agree.
//
// A schedule is { enabled, rules: [{ days: [0-6], sleep: 'HH:MM', wake: 'HH:MM' }], mode, touchWake, touchMinutes,
// monitorOff, override }. Each rule starts a sleep on the listed days (0 = Sunday) at `sleep` and ends it at the next
// `wake`, so "sleep 22:30, wake 06:30" runs overnight into the following morning. Times are in the local time of
// whoever evaluates them (the display itself, or the Pi's server). An `override` ({ mode: 'sleep'|'awake', until }) set
// from the admin page beats the schedule until `until` (epoch ms, or null = until cancelled).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PidashSchedule = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const pad = (n) => String(n).padStart(2, '0');

  // '6:30', '06:30' -> '06:30'; anything else -> null
  function cleanTime(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v).trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    return h <= 23 && mi <= 59 ? `${pad(h)}:${pad(mi)}` : null;
  }
  const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

  // Whatever came from a form or a file -> a well-formed schedule.
  function sanitize(s) {
    const src = s && typeof s === 'object' ? s : {};
    const num = (v, lo, hi, dflt) => (v === '' || v == null || !Number.isFinite(Number(v)) ? dflt : Math.min(hi, Math.max(lo, Math.round(Number(v)))));
    const rules = (Array.isArray(src.rules) ? src.rules : []).slice(0, 8).map((r) => {
      const days = [...new Set((Array.isArray(r && r.days) ? r.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      return { days, sleep: cleanTime(r && r.sleep), wake: cleanTime(r && r.wake) };
    }).filter((r) => r.days.length && r.sleep && r.wake && r.sleep !== r.wake);
    const ov = src.override;
    const override = ov && typeof ov === 'object' && (ov.mode === 'sleep' || ov.mode === 'awake') && (ov.until === null || Number.isFinite(Number(ov.until)))
      ? { mode: ov.mode, until: ov.until === null ? null : Number(ov.until) }
      : null;
    return {
      enabled: src.enabled === true,
      rules,
      mode: ['off', 'dim', 'clock'].includes(src.mode) ? src.mode : 'off',
      touchWake: src.touchWake !== false,
      touchMinutes: num(src.touchMinutes, 1, 240, 10),
      monitorOff: src.monitorOff === true,
      override,
    };
  }

  // Every sleep interval [start, end) that begins from one day before `around` to nine days after it.
  function intervals(rules, around) {
    const y = around.getFullYear();
    const mo = around.getMonth();
    const d = around.getDate();
    const out = [];
    for (let off = -1; off <= 9; off++) {
      const dow = new Date(y, mo, d + off).getDay();
      for (const r of rules) {
        if (!r.days.includes(dow)) continue;
        const [sh, sm] = r.sleep.split(':').map(Number);
        const [wh, wm] = r.wake.split(':').map(Number);
        const overnight = minutes(r.wake) <= minutes(r.sleep);
        out.push([new Date(y, mo, d + off, sh, sm).getTime(), new Date(y, mo, d + off + (overnight ? 1 : 0), wh, wm).getTime()]);
      }
    }
    return out;
  }

  // Would the schedule alone (ignoring any override) have the display asleep at time t (ms)?
  const scheduled = (s, t) => s.enabled && intervals(s.rules, new Date(t)).some(([a, b]) => t >= a && t < b);

  // The first moment after `from` (ms) at which the schedule alone is asleep (want = true) or awake (want = false).
  function nextBoundary(s, from, want) {
    if (!s.enabled || !s.rules.length) return null;
    const edges = intervals(s.rules, new Date(from)).flat().filter((t) => t > from).sort((a, b) => a - b);
    return edges.find((t) => scheduled(s, t) === want) || null;
  }

  // { asleep, source: 'override'|'schedule'|'off', next: ms|null } - `next` is when this answer is next due to change.
  function status(schedule, now) {
    const s = sanitize(schedule);
    const t = (now instanceof Date ? now : new Date()).getTime();
    const ov = s.override && (s.override.until === null || s.override.until > t) ? s.override : null;
    if (ov) return { asleep: ov.mode === 'sleep', source: 'override', next: ov.until, override: ov };
    if (!s.enabled || !s.rules.length) return { asleep: false, source: 'off', next: null, override: null };
    const asleep = scheduled(s, t);
    return { asleep, source: 'schedule', next: nextBoundary(s, t, !asleep), override: null };
  }

  // When a manual "sleep now" should end: at the next scheduled wake-up (null = nothing scheduled, so until cancelled).
  function sleepNowUntil(schedule, now) {
    const s = sanitize(schedule);
    const t = (now instanceof Date ? now : new Date()).getTime();
    if (!s.enabled || !s.rules.length) return null;
    if (scheduled(s, t)) return nextBoundary(s, t, false);
    const start = nextBoundary(s, t, true);
    return start == null ? null : nextBoundary(s, start, false);
  }

  return { sanitize, status, sleepNowUntil, cleanTime, DEFAULT_RULE: { days: [0, 1, 2, 3, 4, 5, 6], sleep: '23:00', wake: '06:00' } };
}));
