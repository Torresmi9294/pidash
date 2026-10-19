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
};
window.PIDASH_THEMES.dark = window.PIDASH_THEMES.midnight; // old saved value

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
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const font = window.PIDASH_FONTS[display.font] || window.PIDASH_FONTS.system;
  root.style.setProperty('--font', font.css);
  root.style.setProperty('--scale', String((Number(display.fontScale) || 100) / 100));
  root.dataset.cards = display.cardStyle || 'glass';
  root.dataset.theme = key;
  return t;
};
