'use strict';
// Theme presets, shared by the display and the admin page.
// To add one, copy an entry - it appears in Admin > Display automatically.
window.PIDASH_THEMES = {
  midnight: { label: 'Midnight', vars: { '--bg1': '#0b1220', '--bg2': '#1b2440', '--card': 'rgba(255,255,255,0.07)', '--card-solid': '#18213a', '--card-border': 'rgba(255,255,255,0.10)', '--text': '#f2f5fb', '--muted': '#9aa6c2', '--accent': '#5ab0ff', '--overlay': 'rgba(0,0,0,0.45)' } },
  light:    { label: 'Light', vars: { '--bg1': '#eef2f9', '--bg2': '#d9e2f3', '--card': 'rgba(255,255,255,0.75)', '--card-solid': '#ffffff', '--card-border': 'rgba(20,30,60,0.10)', '--text': '#16203a', '--muted': '#5a6784', '--accent': '#1c6fd1', '--overlay': 'rgba(255,255,255,0.35)' } },
  ocean:    { label: 'Ocean', vars: { '--bg1': '#031d33', '--bg2': '#0a4a6e', '--card': 'rgba(255,255,255,0.08)', '--card-solid': '#0b3452', '--card-border': 'rgba(160,220,255,0.16)', '--text': '#eaf6ff', '--muted': '#8fb8d6', '--accent': '#3dd5f3', '--overlay': 'rgba(0,10,25,0.45)' } },
  forest:   { label: 'Forest', vars: { '--bg1': '#0b1b14', '--bg2': '#1d4a33', '--card': 'rgba(255,255,255,0.07)', '--card-solid': '#16382a', '--card-border': 'rgba(170,255,200,0.14)', '--text': '#eef7f1', '--muted': '#9cbba8', '--accent': '#6fdc8c', '--overlay': 'rgba(0,15,5,0.45)' } },
  sunset:   { label: 'Sunset', vars: { '--bg1': '#2a1233', '--bg2': '#8a3140', '--card': 'rgba(255,255,255,0.09)', '--card-solid': '#4a2040', '--card-border': 'rgba(255,200,180,0.18)', '--text': '#fff3ee', '--muted': '#e0b3b8', '--accent': '#ffb454', '--overlay': 'rgba(30,5,20,0.45)' } },
  nebula:   { label: 'Nebula', vars: { '--bg1': '#120a2a', '--bg2': '#3d1f75', '--card': 'rgba(255,255,255,0.08)', '--card-solid': '#2a1855', '--card-border': 'rgba(210,180,255,0.18)', '--text': '#f3eeff', '--muted': '#b1a3d8', '--accent': '#b388ff', '--overlay': 'rgba(10,0,30,0.45)' } },
  rose:     { label: 'Rose', vars: { '--bg1': '#2a0f1a', '--bg2': '#6a2142', '--card': 'rgba(255,255,255,0.08)', '--card-solid': '#47172d', '--card-border': 'rgba(255,190,220,0.18)', '--text': '#fff0f6', '--muted': '#dba8c0', '--accent': '#ff7eb6', '--overlay': 'rgba(30,0,15,0.45)' } },
  slate:    { label: 'Slate', vars: { '--bg1': '#1c2128', '--bg2': '#2f3640', '--card': 'rgba(255,255,255,0.06)', '--card-solid': '#262c35', '--card-border': 'rgba(255,255,255,0.10)', '--text': '#cdd9e5', '--muted': '#8b98a8', '--accent': '#539bf5', '--overlay': 'rgba(0,0,0,0.45)' } },
  amoled:   { label: 'AMOLED black', vars: { '--bg1': '#000000', '--bg2': '#000000', '--card': 'rgba(255,255,255,0.06)', '--card-solid': '#0d0d0d', '--card-border': 'rgba(255,255,255,0.12)', '--text': '#f5f5f5', '--muted': '#8e8e93', '--accent': '#4da3ff', '--overlay': 'rgba(0,0,0,0.5)' } },
  paper:    { label: 'Paper', vars: { '--bg1': '#f6f1e7', '--bg2': '#e6dac1', '--card': 'rgba(255,255,255,0.65)', '--card-solid': '#fffaf0', '--card-border': 'rgba(70,50,20,0.14)', '--text': '#2b2418', '--muted': '#7a6e58', '--accent': '#b5651d', '--overlay': 'rgba(255,250,235,0.4)' } },
  contrast: { label: 'High contrast', vars: { '--bg1': '#000000', '--bg2': '#000000', '--card': 'rgba(0,0,0,0)', '--card-solid': '#000000', '--card-border': 'rgba(255,255,255,0.85)', '--text': '#ffffff', '--muted': '#d0d0d0', '--accent': '#ffe600', '--overlay': 'rgba(0,0,0,0.6)' } },
  autumn: { label: 'Autumn', group: 'seasonal', vars: { '--bg1': '#2a1408', '--bg2': '#7a3b12', '--card': 'rgba(255,235,210,0.09)', '--card-solid': '#4a2610', '--card-border': 'rgba(255,200,150,0.20)', '--text': '#fff3e6', '--muted': '#e3bb98', '--accent': '#ff9f43', '--overlay': 'rgba(25,8,0,0.45)' } },
  winter: { label: 'Winter', group: 'seasonal', vars: { '--bg1': '#0b1a2e', '--bg2': '#35577d', '--card': 'rgba(255,255,255,0.10)', '--card-solid': '#1d3552', '--card-border': 'rgba(200,230,255,0.22)', '--text': '#f2f9ff', '--muted': '#b9d2e8', '--accent': '#8fd3ff', '--overlay': 'rgba(0,10,25,0.4)' } },
  spring: { label: 'Spring', group: 'seasonal', vars: { '--bg1': '#eaf7ee', '--bg2': '#d3efe0', '--card': 'rgba(255,255,255,0.72)', '--card-solid': '#ffffff', '--card-border': 'rgba(30,90,55,0.16)', '--text': '#1c3a2a', '--muted': '#4d7a62', '--accent': '#d6478f', '--overlay': 'rgba(255,255,255,0.35)' } },
  summer: { label: 'Summer', group: 'seasonal', vars: { '--bg1': '#06304d', '--bg2': '#b04a14', '--card': 'rgba(255,255,255,0.10)', '--card-solid': '#4a2f3a', '--card-border': 'rgba(255,225,180,0.25)', '--text': '#fff8ec', '--muted': '#ffd9b0', '--accent': '#ffd166', '--overlay': 'rgba(10,20,30,0.4)' } },
  halloween: { label: 'Halloween', group: 'seasonal', vars: { '--bg1': '#0d0714', '--bg2': '#3b1452', '--card': 'rgba(255,255,255,0.07)', '--card-solid': '#26103a', '--card-border': 'rgba(255,140,40,0.25)', '--text': '#fff1e0', '--muted': '#cfaadf', '--accent': '#ff7a00', '--overlay': 'rgba(8,0,15,0.5)' } },
  christmas: { label: 'Christmas', group: 'seasonal', vars: { '--bg1': '#0a2a16', '--bg2': '#6b1020', '--card': 'rgba(255,255,255,0.09)', '--card-solid': '#3a1f20', '--card-border': 'rgba(255,230,160,0.25)', '--text': '#fffaf0', '--muted': '#f0d9b5', '--accent': '#ffd23f', '--overlay': 'rgba(5,15,8,0.45)' } },
  valentine: { label: "Valentine's", group: 'seasonal', vars: { '--bg1': '#3a0a22', '--bg2': '#a8245a', '--card': 'rgba(255,255,255,0.10)', '--card-solid': '#5e1a3c', '--card-border': 'rgba(255,190,215,0.25)', '--text': '#fff0f5', '--muted': '#f4bcd2', '--accent': '#ff9ec4', '--overlay': 'rgba(30,0,15,0.45)' } },
  stpatrick: { label: "St. Patrick's", group: 'seasonal', vars: { '--bg1': '#062b12', '--bg2': '#1a7034', '--card': 'rgba(255,255,255,0.09)', '--card-solid': '#0f4a25', '--card-border': 'rgba(190,255,200,0.22)', '--text': '#f2fff5', '--muted': '#b2e2bd', '--accent': '#ffd700', '--overlay': 'rgba(0,20,5,0.45)' } },
  july4: { label: '4th of July', group: 'seasonal', vars: { '--bg1': '#0a1a4a', '--bg2': '#7a1424', '--card': 'rgba(255,255,255,0.09)', '--card-solid': '#341a3c', '--card-border': 'rgba(255,255,255,0.22)', '--text': '#ffffff', '--muted': '#cdd6f2', '--accent': '#ff5a6a', '--overlay': 'rgba(5,5,30,0.45)' } },
  thanksgiving: { label: 'Thanksgiving', group: 'seasonal', vars: { '--bg1': '#2b1a0a', '--bg2': '#6b4a1e', '--card': 'rgba(255,240,215,0.09)', '--card-solid': '#4a3114', '--card-border': 'rgba(255,215,150,0.22)', '--text': '#fff4e0', '--muted': '#dcc296', '--accent': '#e6a23c', '--overlay': 'rgba(25,12,0,0.45)' } },
  newyear: { label: 'New Year', group: 'seasonal', vars: { '--bg1': '#0a0a0f', '--bg2': '#2e2410', '--card': 'rgba(255,255,255,0.07)', '--card-solid': '#1c1810', '--card-border': 'rgba(245,208,97,0.25)', '--text': '#ffffff', '--muted': '#c9bd94', '--accent': '#f5d061', '--overlay': 'rgba(0,0,0,0.5)' } },
};
window.PIDASH_THEMES.dark = window.PIDASH_THEMES.midnight; // old saved value
for (const t of Object.values(window.PIDASH_THEMES)) if (!t.group) t.group = 'classic';
window.PIDASH_THEMES.contrast.skipRandom = true; // the high-contrast accessibility theme is never picked at random

window.PIDASH_FONTS = {
  system: { label: 'Modern (system)', css: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif" },
  rounded: { label: 'Rounded', css: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', system-ui, sans-serif" },
  serif: { label: 'Serif', css: "Georgia, 'Noto Serif', 'DejaVu Serif', serif" },
  mono: { label: 'Monospace', css: "ui-monospace, 'SF Mono', Consolas, 'DejaVu Sans Mono', monospace" },
};

window.PIDASH_APPLY_THEME = function applyTheme(display, opts) {
  const themes = window.PIDASH_THEMES;
  const key = (opts && opts.theme) || display.theme;
  const t = themes[key] || themes.midnight;
  const root = document.documentElement;
  const vars = { ...t.vars };
  const hex = /^#[0-9a-f]{6}$/i;
  if (hex.test(display.accent || '')) vars['--accent'] = display.accent;
  if (hex.test(display.bg1 || '')) vars['--bg1'] = display.bg1;
  if (hex.test(display.bg2 || '')) vars['--bg2'] = display.bg2;
  const a = hex.test(vars['--accent']) ? vars['--accent'] : '#5ab0ff';
  vars['--accent-soft'] = `rgba(${parseInt(a.slice(1, 3), 16)},${parseInt(a.slice(3, 5), 16)},${parseInt(a.slice(5, 7), 16)},0.24)`;
  // Background gradient: linear (with angle), radial, or a single solid colour, from the theme/custom colours.
  const num = (v, lo, hi, dflt) => (v === '' || v == null || !Number.isFinite(Number(v)) ? dflt : Math.min(hi, Math.max(lo, Number(v))));
  const gstyle = ['linear', 'radial', 'solid'].includes(display.gradientStyle) ? display.gradientStyle : 'linear';
  vars['--grad'] = gstyle === 'solid' ? vars['--bg1']
    : gstyle === 'radial' ? `radial-gradient(circle at 50% 35%, ${vars['--bg1']}, ${vars['--bg2']})`
    : `linear-gradient(${num(display.gradientAngle, 0, 360, 135)}deg, ${vars['--bg1']}, ${vars['--bg2']})`;
  // Photo slideshow look: dimming (the theme's overlay colour at your strength), blur, fit and cross-fade time.
  if (display.photoDim !== '' && display.photoDim != null && Number.isFinite(Number(display.photoDim))) {
    vars['--overlay'] = String(vars['--overlay']).replace(/,\s*[\d.]+\)\s*$/, `, ${num(display.photoDim, 0, 90, 45) / 100})`);
  }
  vars['--photo-blur'] = `${num(display.photoBlur, 0, 30, 0)}px`;
  vars['--photo-fit'] = display.photoFit === 'contain' ? 'contain' : 'cover';
  vars['--photo-fade'] = `${num(display.photoFade, 0, 10, 2)}s`;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const font = window.PIDASH_FONTS[display.font] || window.PIDASH_FONTS.system;
  root.style.setProperty('--font', font.css);
  root.style.setProperty('--scale', String((Number(display.fontScale) || 100) / 100));
  root.dataset.cards = display.cardStyle || 'glass';
  root.dataset.theme = key;
  return t;
};

// Layout presets (picked in Admin > Display). To add one: add an entry here, then CSS for
// #layout[data-layout='<name>'] in dash.css, and a mini diagram in admin.css.
window.PIDASH_LAYOUTS = {
  'sidebar-left': { label: 'Sidebar left', desc: 'Always-visible widgets on the left, rotating widgets on the right.' },
  'sidebar-right': { label: 'Sidebar right', desc: 'Always-visible widgets on the right, rotating widgets on the left.' },
  top: { label: 'Top bar', desc: 'A slim bar of always-visible widgets across the top, rotating widgets below.' },
  bottom: { label: 'Bottom bar', desc: 'A slim bar of always-visible widgets along the bottom, rotating widgets above.' },
  grid: { label: 'Grid', desc: 'Every widget on screen at once, no rotation. Best on bigger screens.' },
  'grid-rotate': { label: 'Rotating grid', desc: 'A grid where each cell (pane) rotates through the widgets you choose.' },
  focus: { label: 'Focus', desc: 'One widget at a time, full screen. Everything rotates, including the clock and weather.' },
};

window.PIDASH_APPLY_LAYOUT = function applyLayoutSettings(display) {
  const root = document.documentElement;
  const SIDE = { narrow: '20%', normal: '27%', wide: '36%' };
  const SPACING = { tight: ['0.6rem', '0.7rem', '0.75rem 0.95rem'], normal: ['1.2rem', '1.4rem', '1.1rem 1.3rem'], roomy: ['1.8rem', '2.2rem', '1.5rem 1.8rem'] };
  const RADIUS = { sharp: '0.25rem', normal: '1.1rem', round: '2rem' };
  const sp = SPACING[display.spacing] || SPACING.normal;
  root.style.setProperty('--side', SIDE[display.sidebarSize] || SIDE.normal);
  root.style.setProperty('--gap', sp[0]);
  root.style.setProperty('--pad', sp[1]);
  root.style.setProperty('--cpad', sp[2]);
  root.style.setProperty('--radius', RADIUS[display.corners] || RADIUS.normal);
  root.dataset.transition = ['fade', 'slide', 'zoom', 'none'].includes(display.transition) ? display.transition : 'fade';
  root.dataset.dots = display.dots === false ? 'off' : 'on';
  root.dataset.titles = display.titleCase === 'normal' ? 'normal' : 'upper';
};

// Panes for the "Rotating grid" layout. Sizes are columns x rows of the grid; the grid itself works in half-cells,
// so a pane can be half a cell wide and/or half a cell tall.
window.PIDASH_PANE_SIZES = {
  q: { label: '\u00BD \u00D7 \u00BD (small)', cols: 0.5, rows: 0.5 },
  hw: { label: '\u00BD \u00D7 1 (narrow)', cols: 0.5, rows: 1 },
  hh: { label: '1 \u00D7 \u00BD (short)', cols: 1, rows: 0.5 },
  s: { label: '1 \u00D7 1', cols: 1, rows: 1 },
  w: { label: '2 \u00D7 1 (wide)', cols: 2, rows: 1 },
  t: { label: '1 \u00D7 2 (tall)', cols: 1, rows: 2 },
  l: { label: '2 \u00D7 2 (large)', cols: 2, rows: 2 },
  xw: { label: '2 \u00D7 \u00BD (wide strip)', cols: 2, rows: 0.5 },
  xt: { label: '\u00BD \u00D7 2 (tall strip)', cols: 0.5, rows: 2 },
  w3: { label: '3 \u00D7 1 (extra wide)', cols: 3, rows: 1 },
  t3: { label: '1 \u00D7 3 (extra tall)', cols: 1, rows: 3 },
};

// Starting point when no panes are configured: every "always visible" widget gets its own pane and
// all the rotating widgets share one wide pane.
window.PIDASH_SUGGEST_PANES = function suggestPanes(widgets) {
  const on = widgets.filter((w) => w.enabled !== false);
  const side = on.filter((w) => w.slot === 'sidebar');
  const rot = on.filter((w) => w.slot !== 'sidebar');
  const panes = side.map((w) => ({ widgets: [w.id], size: 's', seconds: '' }));
  if (rot.length) panes.push({ widgets: rot.map((w) => w.id), size: side.length >= 2 ? 'w' : 'l', seconds: '' });
  return panes;
};

// ---- Which theme is on right now? (fixed / random / seasonal) --------------------------------------
// Seasons are meteorological (Dec-Feb winter ... ) and flip in the southern hemisphere. Holiday windows are
// date-based (US-centric); turn them off to get plain seasons.
window.PIDASH_SEASON = function seasonFor(date, opts) {
  const o = opts || {};
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const md = m * 100 + d;
  if (o.holidays !== false) {
    if (md >= 1231 || md <= 102) return { key: 'newyear', label: 'New Year' };
    if (md >= 207 && md <= 214) return { key: 'valentine', label: "Valentine's Day" };
    if (md >= 310 && md <= 317) return { key: 'stpatrick', label: "St. Patrick's Day" };
    if (md >= 628 && md <= 705) return { key: 'july4', label: '4th of July' };
    if (md >= 1015 && md <= 1031) return { key: 'halloween', label: 'Halloween' };
    const firstThu = 1 + ((4 - new Date(date.getFullYear(), 10, 1).getDay() + 7) % 7); // Thanksgiving = 4th Thursday of Nov
    if (md >= 1116 && md <= 1100 + firstThu + 21) return { key: 'thanksgiving', label: 'Thanksgiving' };
    if (md >= 1201 && md <= 1226) return { key: 'christmas', label: 'Christmas' };
  }
  let season = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
  if (o.hemisphere === 'south') season = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' }[season];
  return { key: season, label: season[0].toUpperCase() + season.slice(1) };
};

window.PIDASH_THEME_POOL = function themePool(display) {
  const themes = window.PIDASH_THEMES;
  const chosen = (Array.isArray(display.randomPool) ? display.randomPool : []).filter((k) => themes[k] && k !== 'dark');
  if (chosen.length) return chosen;
  return Object.keys(themes).filter((k) => k !== 'dark' && !themes[k].skipRandom && (themes[k].group !== 'seasonal' || display.randomSeasonal));
};

window.PIDASH_RESOLVE_THEME = function resolveTheme(display, now) {
  now = now || new Date();
  if (display.themeMode === 'seasonal') return window.PIDASH_SEASON(now, { hemisphere: display.seasonHemisphere, holidays: display.seasonHolidays }).key;
  if (display.themeMode !== 'random') return display.theme;

  const pool = window.PIDASH_THEME_POOL(display);
  if (!pool.length) return display.theme;
  const every = ['load', 'hour', 'day'].includes(display.randomEvery) ? display.randomEvery : 'day';
  if (every === 'load') {
    if (window.__pidashSeed === undefined) window.__pidashSeed = Math.random();
    return pool[Math.floor(window.__pidashSeed * pool.length) % pool.length];
  }
  // Stable for the hour/day (every screen agrees, and it survives reloads), and never the same as the previous period.
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
  const bucket = (dt) => (every === 'hour' ? `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}-${dt.getHours()}` : `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`);
  const prev = new Date(now.getTime() - (every === 'hour' ? 3600e3 : 86400e3));
  let idx = hash(`pidash:${bucket(now)}`) % pool.length;
  if (pool.length > 1 && idx === hash(`pidash:${bucket(prev)}`) % pool.length) idx = (idx + 1) % pool.length;
  return pool[idx];
};
