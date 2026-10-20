'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const style = new Map();
  const root = { style: { setProperty: (k, v) => style.set(k, v) }, dataset: {} };
  const ctx = { window: {}, document: { documentElement: root }, Math, Date };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'themes.js'), 'utf8'), ctx);
  return { w: ctx.window, style, root };
}

// WCAG relative luminance / contrast ratio
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every theme defines the same variables and stays readable (text 4.5:1, muted and accent 3:1 on both background colors)', () => {
  const { w } = load();
  const keys = Object.keys(w.PIDASH_THEMES.midnight.vars).sort();
  const failures = [];
  for (const [name, t] of Object.entries(w.PIDASH_THEMES)) {
    if (name === 'dark') continue;
    assert.deepEqual(Object.keys(t.vars).sort(), keys, `${name} has all theme variables`);
    assert.ok(t.label && ['classic', 'seasonal'].includes(t.group), `${name} has a label and group`);
    for (const bg of [t.vars['--bg1'], t.vars['--bg2']]) {
      const text = contrast(t.vars['--text'], bg);
      const muted = contrast(t.vars['--muted'], bg);
      const accent = contrast(t.vars['--accent'], bg);
      if (text < 4.5) failures.push(`${name}: text ${text.toFixed(2)} on ${bg}`);
      if (muted < 3) failures.push(`${name}: muted ${muted.toFixed(2)} on ${bg}`);
      if (accent < 3) failures.push(`${name}: accent ${accent.toFixed(2)} on ${bg}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('there are 11 seasonal/holiday themes alongside the classic ones', () => {
  const { w } = load();
  const seasonal = Object.entries(w.PIDASH_THEMES).filter(([, t]) => t.group === 'seasonal').map(([k]) => k).sort();
  assert.deepEqual(seasonal, ['autumn', 'christmas', 'halloween', 'newyear', 'spring', 'stpatrick', 'summer', 'thanksgiving', 'valentine', 'july4', 'winter'].sort());
});

test('seasonal mode: seasons, holiday windows, hemisphere flip and the holidays switch', () => {
  const { w } = load();
  const on = (y, m, d, o) => w.PIDASH_SEASON(new Date(y, m - 1, d), o).key;
  assert.equal(on(2026, 1, 15), 'winter');
  assert.equal(on(2026, 4, 15), 'spring');
  assert.equal(on(2026, 7, 15), 'summer');
  assert.equal(on(2026, 9, 15), 'autumn');
  assert.equal(on(2026, 12, 28), 'winter');
  // holidays
  assert.equal(on(2026, 12, 31), 'newyear');
  assert.equal(on(2026, 1, 1), 'newyear');
  assert.equal(on(2026, 2, 14), 'valentine');
  assert.equal(on(2026, 3, 17), 'stpatrick');
  assert.equal(on(2026, 7, 4), 'july4');
  assert.equal(on(2026, 10, 20), 'halloween');
  assert.equal(on(2026, 10, 31), 'halloween');
  assert.equal(on(2026, 12, 25), 'christmas');
  // Thanksgiving = 4th Thursday of November (Nov 26 2026, Nov 27 2025, Nov 25 2027); autumn the day after
  assert.equal(on(2026, 11, 26), 'thanksgiving');
  assert.equal(on(2026, 11, 27), 'autumn');
  assert.equal(on(2025, 11, 27), 'thanksgiving');
  assert.equal(on(2025, 11, 28), 'autumn');
  assert.equal(on(2027, 11, 25), 'thanksgiving');
  // switches
  assert.equal(on(2026, 10, 20, { holidays: false }), 'autumn');
  assert.equal(on(2026, 12, 25, { holidays: false }), 'winter');
  assert.equal(on(2026, 4, 15, { hemisphere: 'south' }), 'autumn');
  assert.equal(on(2026, 12, 28, { hemisphere: 'south', holidays: false }), 'summer');
  // every result is a real theme
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d += 3) for (const h of ['north', 'south']) assert.ok(w.PIDASH_THEMES[on(2026, m, d, { hemisphere: h })], `${m}/${d} ${h}`);
});

test('resolve: fixed mode returns the chosen theme; seasonal mode follows the calendar', () => {
  const { w } = load();
  assert.equal(w.PIDASH_RESOLVE_THEME({ theme: 'ocean' }, new Date(2026, 5, 1)), 'ocean');
  assert.equal(w.PIDASH_RESOLVE_THEME({ theme: 'ocean', themeMode: 'seasonal' }, new Date(2026, 5, 1)), 'summer');
  assert.equal(w.PIDASH_RESOLVE_THEME({ theme: 'ocean', themeMode: 'seasonal', seasonHemisphere: 'south' }, new Date(2026, 5, 1)), 'winter');
});

test('random mode: stable within the period, different from the previous one, respects the pool', () => {
  const { w } = load();
  const base = { themeMode: 'random', theme: 'midnight', randomEvery: 'day' };
  const day = (d, o) => w.PIDASH_RESOLVE_THEME({ ...base, ...o }, new Date(2026, 5, d, 9, 30));
  // stable all day, whatever the time
  assert.equal(day(10), w.PIDASH_RESOLVE_THEME(base, new Date(2026, 5, 10, 23, 59)));
  // never the same theme two days in a row
  for (let d = 1; d < 28; d++) assert.notEqual(day(d), day(d + 1), `day ${d} -> ${d + 1}`);
  // by default only classic themes (no seasonal, no high-contrast)
  const seen = new Set();
  for (let d = 1; d <= 28; d++) for (let m = 0; m < 12; m++) seen.add(w.PIDASH_RESOLVE_THEME(base, new Date(2026, m, d)));
  for (const k of seen) assert.equal(w.PIDASH_THEMES[k].group, 'classic');
  assert.ok(!seen.has('contrast'));
  assert.ok(seen.size >= 8, `varied: ${seen.size} themes seen`);
  // include seasonal themes when asked
  const withSeasonal = new Set();
  for (let d = 1; d <= 28; d++) for (let m = 0; m < 12; m++) withSeasonal.add(w.PIDASH_RESOLVE_THEME({ ...base, randomSeasonal: true }, new Date(2026, m, d)));
  assert.ok([...withSeasonal].some((k) => w.PIDASH_THEMES[k].group === 'seasonal'));
  // a chosen pool is respected exactly (and unknown names are ignored)
  const pool = { randomPool: ['ocean', 'rose', 'nope'] };
  for (let d = 1; d <= 28; d++) assert.ok(['ocean', 'rose'].includes(day(d, pool)));
  // a one-theme pool always gives that theme
  assert.equal(day(5, { randomPool: ['slate'] }), 'slate');
  // hourly mode changes between hours
  const hr = (h) => w.PIDASH_RESOLVE_THEME({ ...base, randomEvery: 'hour' }, new Date(2026, 5, 10, h, 5));
  for (let h = 0; h < 23; h++) assert.notEqual(hr(h), hr(h + 1));
});

test('random "every load" picks once per page load and stays put', () => {
  const { w } = load();
  const d = { themeMode: 'random', randomEvery: 'load', theme: 'midnight' };
  const first = w.PIDASH_RESOLVE_THEME(d, new Date(2026, 0, 1));
  for (let i = 0; i < 5; i++) assert.equal(w.PIDASH_RESOLVE_THEME(d, new Date(2026, 6, i + 1)), first);
});

test('apply: gradient styles, photo dimming (keeps the theme overlay colour), blur, fit and fade, with clamping', () => {
  const { w, style, root } = load();
  w.PIDASH_APPLY_THEME({ theme: 'midnight', gradientStyle: 'linear', gradientAngle: 45 });
  assert.equal(style.get('--grad'), 'linear-gradient(45deg, #0b1220, #1b2440)');
  w.PIDASH_APPLY_THEME({ theme: 'midnight', gradientStyle: 'radial' });
  assert.match(style.get('--grad'), /^radial-gradient\(circle at 50% 35%, #0b1220, #1b2440\)$/);
  w.PIDASH_APPLY_THEME({ theme: 'midnight', gradientStyle: 'solid', bg1: '#112233' });
  assert.equal(style.get('--grad'), '#112233');
  w.PIDASH_APPLY_THEME({ theme: 'midnight', gradientStyle: 'bogus', gradientAngle: 9999 });
  assert.equal(style.get('--grad'), 'linear-gradient(360deg, #0b1220, #1b2440)'); // unknown style -> linear, angle clamped

  w.PIDASH_APPLY_THEME({ theme: 'midnight', photoDim: 70, photoBlur: 12, photoFit: 'contain', photoFade: 3.5 });
  assert.equal(style.get('--overlay'), 'rgba(0,0,0, 0.7)');
  assert.equal(style.get('--photo-blur'), '12px');
  assert.equal(style.get('--photo-fit'), 'contain');
  assert.equal(style.get('--photo-fade'), '3.5s');
  w.PIDASH_APPLY_THEME({ theme: 'light', photoDim: 20 });
  assert.equal(style.get('--overlay'), 'rgba(255,255,255, 0.2)'); // light themes keep their light overlay
  w.PIDASH_APPLY_THEME({ theme: 'midnight', photoDim: '', photoBlur: 999, photoFit: 'weird', photoFade: -4 });
  assert.equal(style.get('--overlay'), 'rgba(0,0,0,0.45)');      // blank = theme default
  assert.equal(style.get('--photo-blur'), '30px');
  assert.equal(style.get('--photo-fit'), 'cover');
  assert.equal(style.get('--photo-fade'), '0s');
  assert.equal(root.dataset.theme, 'midnight');
});

test('the display resolves the theme and re-checks it as time passes', () => {
  const dash = fs.readFileSync(path.join(__dirname, '..', 'public', 'dash.js'), 'utf8');
  assert.match(dash, /PIDASH_APPLY_THEME\(display, \{ theme: PIDASH_RESOLVE_THEME\(display\) \}\)/);
  assert.match(dash, /display\.themeMode \|\| 'fixed'\) === 'fixed'\) return;/);
  assert.match(dash, /night && display\.nightTheme \? display\.nightTheme : PIDASH_RESOLVE_THEME\(display\)/);
});
