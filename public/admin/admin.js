'use strict';
(() => {
  const MASK = '__SET__';
  const $ = (s) => document.querySelector(s);
  let cfg = null;
  let types = [];
  let tab = location.hash === '#google-connected' ? 'google' : 'widgets';
  let dirty = false;
  const open = new Set();

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  async function api(method, url, body) {
    const res = await fetch(`/api/admin${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `show ${err ? 'err' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ''), err ? 6000 : 2500);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  const touch = () => { dirty = true; $('#save').disabled = false; };

  // ---- generic field renderer ------------------------------------------
  function field(f, obj, key = f.key) {
    const val = obj[key];
    const set = (v) => { obj[key] = v; touch(); };
    const wrap = (input, extra) => h('label', { class: 'f' }, h('span', {}, f.label), input, f.help ? h('small', {}, f.help) : null, extra);
    if (f.type === 'checkbox') {
      return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: val === undefined ? !!f.default : val, onchange: (e) => set(e.target.checked) }), f.label);
    }
    if (f.type === 'select') {
      return wrap(h('select', { onchange: (e) => { set(e.target.value); if (f.rerender) render(); } }, f.options.map((o) => h('option', { value: o.value, selected: (val || f.options[0].value) === o.value }, o.label))));
    }
    if (f.type === 'color') {
      const hex = /^#[0-9a-f]{6}$/i.test(val || '') ? val : f.fallback || '#5ab0ff';
      const picker = h('input', { type: 'color', value: hex, style: 'width:56px;height:36px;padding:2px;flex:none', oninput: (e) => { set(e.target.value); state.textContent = e.target.value; } });
      const state = h('span', { class: 'muted small' }, val || 'theme default');
      return h('div', { class: 'f' }, h('span', { style: 'display:block;font-weight:600;font-size:13px;margin-bottom:3px' }, f.label),
        h('div', { class: 'row' }, picker, state, h('button', { class: 'btn sm', type: 'button', onclick: () => { set(''); render(); } }, 'Use theme default')),
        f.help ? h('small', { class: 'muted' }, f.help) : null);
    }
    if (f.type === 'range') {
      const has = val !== '' && val != null && Number.isFinite(Number(val));
      const unit = f.unit || '';
      const out = h('span', { class: 'muted small', style: 'min-width:92px' }, has ? `${val}${unit}` : `theme default (${f.default}${unit})`);
      const input = h('input', { type: 'range', class: 'grow', min: f.min, max: f.max, step: f.step || 1, value: has ? val : (f.default ?? f.min),
        oninput: (e) => { set(Number(e.target.value)); out.textContent = `${e.target.value}${unit}`; } });
      return h('div', { class: 'f' }, h('span', { style: 'display:block;font-weight:600;font-size:13px;margin-bottom:3px' }, f.label),
        h('div', { class: 'row' }, input, out, f.resettable ? h('button', { class: 'btn sm', type: 'button', onclick: () => { set(''); render(); } }, 'Theme default') : null),
        f.help ? h('small', { class: 'muted' }, f.help) : null);
    }
    const hadSecret = f.secret && val === MASK;
    const common = {
      value: hadSecret ? '' : (val ?? ''),
      placeholder: hadSecret ? '•••••• saved - type to replace' : f.placeholder || '',
      oninput: (e) => set(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value || (hadSecret ? MASK : '')),
    };
    if (f.type === 'textarea') return wrap(h('textarea', common));
    return wrap(h('input', { type: f.secret ? 'password' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', autocomplete: 'off', ...common }));
  }

  // ---- tabs --------------------------------------------------------------
  const TABS = { widgets: 'Widgets', display: 'Display', google: 'Google', health: 'Health', reminders: 'Reminders', security: 'Security' };

  function render() {
    $('#tabs').replaceChildren(...Object.entries(TABS).map(([k, label]) =>
      h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; render(); } }, label)));
    const view = $('#view');
    view.replaceChildren(...({ widgets: viewWidgets, display: viewDisplay, google: viewGoogle, health: viewHealth, reminders: viewReminders, security: viewSecurity })[tab]());
  }

  // ---- widgets -----------------------------------------------------------
  function viewWidgets() {
    const addSel = h('select', { class: 'grow' }, types.map((t) => h('option', { value: t.type }, `${t.name} - ${t.description}`)));
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= cfg.widgets.length) return; [cfg.widgets[i], cfg.widgets[j]] = [cfg.widgets[j], cfg.widgets[i]]; touch(); render(); };

    const cards = cfg.widgets.map((w, i) => {
      const t = types.find((x) => x.type === w.type) || { name: w.type, fields: [] };
      w.options = w.options || {};
      const isOpen = open.has(w.id);
      return h('div', { class: `wcard ${w.enabled ? '' : 'off'}` },
        h('div', { class: 'head' },
          h('div', { class: 'title', onclick: () => { isOpen ? open.delete(w.id) : open.add(w.id); render(); } }, `${isOpen ? '▾' : '▸'} ${w.options.title || t.name}`, h('small', {}, w.options.title ? `${t.name} · ${w.id}` : w.id)),
          h('label', { class: 'chk', style: 'margin:0' }, h('input', { type: 'checkbox', checked: w.enabled, onchange: (e) => { w.enabled = e.target.checked; touch(); render(); } }), 'On'),
          h('select', { style: 'width:auto', onchange: (e) => { w.slot = e.target.value; touch(); render(); } },
            h('option', { value: 'sidebar', selected: w.slot === 'sidebar' }, 'Always visible'),
            h('option', { value: 'rotate', selected: w.slot !== 'sidebar' }, 'Rotating')),
          h('button', { class: 'btn sm', title: 'Move up', onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn sm', title: 'Move down', onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'btn sm danger', onclick: () => { if (confirm(`Remove ${t.name} (${w.id})?`)) { cfg.widgets.splice(i, 1); touch(); render(); } } }, 'Remove')),
        isOpen ? h('div', { class: 'body' },
          field({ key: 'title', label: 'Title shown on this widget', type: 'text', placeholder: t.name, help: 'Rename it however you like, e.g. "Family Calendar" or "Brian\'s League". Blank = the default name.' }, w.options),
          field({ key: 'hideTitle', label: 'Hide the title bar', type: 'checkbox' }, w.options),
          w.slot !== 'sidebar' ? field({ key: 'durationSec', label: 'Seconds on screen (blank = default)', type: 'number', placeholder: String(cfg.display.rotateSeconds) }, w.options) : null,
          t.fields.length ? t.fields.map((f) => field(f, w.options)) : h('p', { class: 'muted' }, 'No settings for this widget.')) : null);
    });

    return [
      h('div', { class: 'panel' }, h('h2', {}, 'Widgets'),
        h('p', { class: 'muted small' }, '"Always visible" widgets sit in the side panel. "Rotating" widgets take turns on the main screen. Click a widget to edit its settings (including API keys), then press Save & apply.'),
        cards.length ? cards : h('p', { class: 'muted' }, 'No widgets yet.')),
      h('div', { class: 'panel' }, h('h2', {}, 'Add a widget'),
        h('div', { class: 'row' }, addSel, h('button', { class: 'btn primary', onclick: guard(async () => {
          const type = addSel.value;
          const { id } = await api('GET', `/new-id/${type}`);
          cfg.widgets.push({ id, type, enabled: true, slot: 'rotate', options: {} });
          open.add(id); touch(); render();
        }) }, 'Add')),
        h('p', { class: 'muted small' }, 'Want something that is not listed? Drop a folder into the widgets directory - see docs/WRITING_WIDGETS.md.')),
    ];
  }

  // ---- display -----------------------------------------------------------
  function themeGrid(d, key, allowNone, multi) {
    const all = Object.entries(window.PIDASH_THEMES).filter(([k]) => k !== 'dark');
    const pool = multi ? (d[key] = Array.isArray(d[key]) ? d[key] : []) : null;
    const isSel = (k) => (multi ? pool.includes(k) : (d[key] === 'dark' ? 'midnight' : d[key]) === k);
    const tile = ([k, t]) => {
      const sel = isSel(k);
      const v = t.vars;
      return h('button', {
        type: 'button', title: t.label, class: `tile ${sel ? 'sel' : ''}`,
        style: `background:linear-gradient(135deg,${v['--bg1']},${v['--bg2']});color:${v['--text']};border-color:${sel ? v['--accent'] : 'transparent'}`,
        onclick: () => {
          if (multi) { const i = pool.indexOf(k); if (i >= 0) pool.splice(i, 1); else pool.push(k); } else d[key] = k;
          touch(); render();
        },
      }, h('b', { style: `color:${v['--accent']}` }, multi && sel ? '\u2713' : 'Aa'), h('span', {}, t.label));
    };
    const none = allowNone ? h('button', { type: 'button', class: `tile none ${!d[key] ? 'sel' : ''}`, onclick: () => { d[key] = ''; touch(); render(); } }, h('span', {}, 'Same as day')) : null;
    return h('div', {},
      h('div', { class: 'tiles' }, none, all.filter(([, t]) => t.group !== 'seasonal').map(tile)),
      h('div', { class: 'tile-group' }, 'Seasonal & holiday'),
      h('div', { class: 'tiles' }, all.filter(([, t]) => t.group === 'seasonal').map(tile)));
  }

  // Fixed / Random / Seasonal theme controls (shown under the theme mode selector).
  function themeModeControls(d, F) {
    const mode = d.themeMode || 'fixed';
    if (mode === 'random') {
      return [
        F('randomEvery', 'Pick a new theme', 'select', { options: [{ value: 'day', label: 'Once a day' }, { value: 'hour', label: 'Every hour' }, { value: 'load', label: 'Every time the screen loads' }] }),
        F('randomSeasonal', 'Include the seasonal & holiday themes in the shuffle', 'checkbox'),
        h('span', { style: 'display:block;font-weight:600;font-size:13px;margin:10px 0 4px' }, 'Shuffle among'),
        h('p', { class: 'muted small' }, 'Tap themes to include them. With none selected, every classic theme is used (plus the seasonal ones if ticked above).'),
        themeGrid(d, 'randomPool', false, true),
      ];
    }
    if (mode === 'seasonal') {
      const now = window.PIDASH_SEASON(new Date(), { hemisphere: d.seasonHemisphere, holidays: d.seasonHolidays !== false });
      return [
        h('p', { class: 'small' }, 'Today this shows: ', h('b', {}, now.label), window.PIDASH_THEMES[now.key].label === now.label ? ' theme' : ` (${window.PIDASH_THEMES[now.key].label} theme)`),
        F('seasonHemisphere', 'Hemisphere (flips the four seasons)', 'select', { options: [{ value: 'north', label: 'Northern' }, { value: 'south', label: 'Southern' }] }),
        F('seasonHolidays', 'Switch to holiday themes around the holidays', 'checkbox', { default: true }),
        h('p', { class: 'muted small' }, 'Seasons: Winter Dec-Feb, Spring Mar-May, Summer Jun-Aug, Autumn Sep-Nov. Holidays (US dates): New Year Dec 31-Jan 2, Valentine\'s Feb 7-14, St. Patrick\'s Mar 10-17, 4th of July Jun 28-Jul 5, Halloween Oct 15-31, Thanksgiving Nov 16 until the day, Christmas Dec 1-26.'),
      ];
    }
    return themeGrid(d, 'theme', false);
  }

  function layoutIcon(name) {
    const sb = () => h('div', { class: 'sb' }, h('i'), h('i'));
    if (name === 'grid') return h('div', { class: 'lay-ico grid' }, [1, 2, 3, 4].map(() => h('i')));
    if (name === 'focus') return h('div', { class: 'lay-ico focus' }, h('i', { class: 'main' }));
    if (name === 'grid-rotate') return h('div', { class: 'lay-ico grid-rotate' }, h('i', { class: 'wide' }), h('i'), h('i'));
    return h('div', { class: `lay-ico ${name}` }, sb(), h('i', { class: 'main' }));
  }

  function layoutGrid(d) {
    const current = window.PIDASH_LAYOUTS[d.layout] ? d.layout : 'sidebar-left';
    return h('div', { class: 'ltiles' }, Object.entries(window.PIDASH_LAYOUTS).map(([k, l]) =>
      h('button', { type: 'button', class: `ltile ${current === k ? 'sel' : ''}`, title: l.desc, onclick: () => { d.layout = k; touch(); render(); } },
        layoutIcon(k), h('b', {}, l.label), h('small', {}, l.desc))));
  }

  // Rotating grid: choose which widgets each pane cycles through.
  function paneEditor(d) {
    const enabled = cfg.widgets.filter((w) => w.enabled);
    const label = (w) => `${w.options && w.options.title ? w.options.title : (types.find((t) => t.type === w.type) || { name: w.type }).name} (${w.id})`;
    const panes = d.gridPanes || (d.gridPanes = []);
    const sizeOpts = Object.entries(window.PIDASH_PANE_SIZES);
    const inAny = new Set(panes.flatMap((p) => p.widgets));
    const missing = enabled.filter((w) => !inAny.has(w.id));
    const swap = (list, i, j) => { if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; touch(); render(); };

    const paneCard = (p, i) => {
      const sel = p.widgets.filter((id) => enabled.some((w) => w.id === id));
      const rows = [
        ...sel.map((id, k) => {
          const w = enabled.find((x) => x.id === id);
          return h('div', { class: 'row', style: 'margin:4px 0' },
            h('label', { class: 'chk grow', style: 'margin:0' }, h('input', { type: 'checkbox', checked: true, onchange: () => { p.widgets = p.widgets.filter((x) => x !== id); touch(); render(); } }), label(w)),
            h('button', { class: 'btn sm', title: 'Earlier in the rotation', onclick: () => { const a = p.widgets.indexOf(id); const b = p.widgets.indexOf(sel[k - 1]); if (k > 0) swap(p.widgets, a, b); } }, '\u2191'),
            h('button', { class: 'btn sm', title: 'Later in the rotation', onclick: () => { const a = p.widgets.indexOf(id); const b = p.widgets.indexOf(sel[k + 1]); if (k < sel.length - 1) swap(p.widgets, a, b); } }, '\u2193'));
        }),
        ...enabled.filter((w) => !sel.includes(w.id)).map((w) =>
          h('label', { class: 'chk', style: 'margin:4px 0;opacity:.75' }, h('input', { type: 'checkbox', onchange: () => { p.widgets.push(w.id); touch(); render(); } }), label(w))),
      ];
      return h('div', { class: 'wcard' },
        h('div', { class: 'head' },
          h('div', { class: 'title', style: 'cursor:default' }, `Pane ${i + 1}`, h('small', {}, sel.length > 1 ? `rotates ${sel.length} widgets` : sel.length === 1 ? 'static' : 'empty')),
          h('select', { style: 'width:auto', title: 'Size in the grid', onchange: (e) => { p.size = e.target.value; touch(); } }, sizeOpts.map(([k, s]) => h('option', { value: k, selected: (p.size || 's') === k }, s.label))),
          h('input', { type: 'number', min: 5, placeholder: `${d.rotateSeconds || 20} s`, title: 'Seconds per widget (blank = default)', value: p.seconds || '', style: 'width:90px', oninput: (e) => { p.seconds = e.target.value === '' ? '' : Number(e.target.value); touch(); } }),
          h('button', { class: 'btn sm', title: 'Move up', onclick: () => swap(panes, i, i - 1) }, '\u2191'),
          h('button', { class: 'btn sm', title: 'Move down', onclick: () => swap(panes, i, i + 1) }, '\u2193'),
          h('button', { class: 'btn sm danger', onclick: () => { panes.splice(i, 1); touch(); render(); } }, 'Remove')),
        h('div', { class: 'body' }, rows.length ? rows : h('p', { class: 'muted' }, 'Enable some widgets on the Widgets tab first.')));
    };

    return h('div', { class: 'panel' }, h('h2', {}, 'Rotating Grid Panes'),
      h('p', { class: 'muted small' }, 'Each pane is one cell of the grid. A pane with several widgets rotates through them in the order shown (use the arrows); with one widget it stays put. Pane sizes are measured in grid cells, from ½ × ½ (small) up to 2 × 2 (large): a clock, verse or health pane often needs only half a cell (narrow ½ × 1 or short 1 × ½), while the calendar suits wide, tall or large. A widget can appear in more than one pane. A widget\'s own "Seconds on screen" setting overrides the pane timing.'),
      panes.length ? panes.map(paneCard) : h('p', { class: 'muted' }, 'No panes yet, so PiDash uses a suggested arrangement: each always-visible widget gets its own pane, and all the rotating widgets share one. Start from it and adjust:'),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn primary', onclick: () => { panes.push({ widgets: [], size: 's', seconds: '' }); touch(); render(); } }, 'Add pane'),
        h('button', { class: 'btn', onclick: () => { d.gridPanes = window.PIDASH_SUGGEST_PANES(cfg.widgets); touch(); render(); } }, panes.length ? 'Reset to suggested' : 'Start from suggested')),
      panes.length && missing.length ? h('p', { class: 'small', style: 'color:var(--bad)' }, `Not shown on the grid: ${missing.map(label).join(', ')}`) : null);
  }

  // ---- background: gradient, slideshow options and the photo manager -----------------------------
  function backgroundPanel(d, F) {
    const themeKey = d.themeMode === 'fixed' || !d.themeMode ? d.theme : window.PIDASH_RESOLVE_THEME(d);
    const tv = (window.PIDASH_THEMES[themeKey] || window.PIDASH_THEMES.midnight).vars;
    const hex = /^#[0-9a-f]{6}$/i;
    const preview = h('div', { class: 'bg-preview', title: 'Preview of the gradient' });
    const paint = () => {
      const a = hex.test(d.bg1 || '') ? d.bg1 : tv['--bg1'];
      const b = hex.test(d.bg2 || '') ? d.bg2 : tv['--bg2'];
      const ang = Number.isFinite(Number(d.gradientAngle)) ? Number(d.gradientAngle) : 135;
      preview.style.background = d.gradientStyle === 'solid' ? a : d.gradientStyle === 'radial' ? `radial-gradient(circle at 50% 35%, ${a}, ${b})` : `linear-gradient(${ang}deg, ${a}, ${b})`;
    };
    paint();

    // photo manager (uploads and deletes apply immediately; they are not part of "Save & apply")
    const MAXES = [['1280', '1280 px (small, fastest)'], ['1920', '1920 px (recommended)'], ['2560', '2560 px (large screens)'], ['0', 'Original size (no resizing)']];
    let maxDim = 1920;
    try { maxDim = Number(localStorage.getItem('pidash.photoMax') || 1920); } catch { /* private mode */ }
    const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const gallery = h('div', { class: 'photos' });
    const status = h('p', { class: 'small muted', style: 'min-height:1.2em' }, '');
    const count = h('span', { class: 'muted small' }, '');
    const warn = h('p', { class: 'small', style: 'color:var(--bad);display:none' }, 'Background is set to Photo slideshow but there are no photos yet, so the gradient is shown. Add some below.');

    const loadPhotos = guard(async () => {
      const list = await api('GET', '/backgrounds');
      const total = list.reduce((n, p) => n + p.size, 0);
      count.textContent = list.length ? `${list.length} photo${list.length === 1 ? '' : 's'}, ${fmtSize(total)}` : '';
      warn.style.display = d.background === 'photos' && !list.length ? '' : 'none';
      gallery.replaceChildren(...(list.length ? list.map((p) =>
        h('div', { class: 'photo' },
          h('img', { src: p.url, loading: 'lazy', alt: p.name }),
          h('div', { class: 'pn', title: p.name }, p.name),
          h('div', { class: 'small muted' }, fmtSize(p.size)),
          h('button', { class: 'btn sm danger', type: 'button', title: `Delete ${p.name}`, onclick: guard(async () => {
            if (!confirm(`Delete ${p.name}?`)) return;
            await api('DELETE', `/backgrounds/${encodeURIComponent(p.name)}`);
            await loadPhotos();
          }) }, '\u2715'))) : [h('p', { class: 'muted small' }, 'No photos yet.')]));
    });

    // Big phone photos are shrunk in the browser first (smaller upload, faster Pi, and proxies with small upload limits cope).
    async function prepare(file) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !maxDim) return { blob: file, name: file.name };
      let bmp;
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return { blob: file, name: file.name }; }
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      if (scale >= 1 && file.size < 2 * 1048576) { if (bmp.close) bmp.close(); return { blob: file, name: file.name }; }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
      return blob && blob.size < file.size ? { blob, name: `${file.name.replace(/\.\w+$/, '')}.jpg` } : { blob: file, name: file.name };
    }

    async function uploadFiles(files) {
      files = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(f.name));
      if (!files.length) return toast('Choose image files (JPG, PNG, WebP, GIF or AVIF).', true);
      let done = 0;
      const failed = [];
      for (const f of files) {
        status.textContent = `Uploading ${done + failed.length + 1} of ${files.length}: ${f.name} ...`;
        try {
          if (/heic|heif/i.test(f.type + f.name)) throw new Error('HEIC photos are not supported - export or share them as JPG first');
          const { blob, name } = await prepare(f);
          const res = await fetch(`/api/admin/backgrounds?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(res.status === 413 ? 'too big for your web server or reverse proxy (raise its upload size limit, e.g. client_max_body_size)' : j.error || `HTTP ${res.status}`);
          }
          done++;
        } catch (e) { failed.push(`${f.name}: ${e.message}`); }
      }
      status.textContent = '';
      await loadPhotos();
      if (failed.length) toast(failed[0] + (failed.length > 1 ? ` (+${failed.length - 1} more)` : ''), true);
      else toast(`${done} photo${done === 1 ? '' : 's'} added`);
    }

    const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, onchange: (e) => { const fs = [...e.target.files]; e.target.value = ''; uploadFiles(fs); } });
    const drop = h('div', { class: 'dropzone' }, 'Drop photos here, or choose files: ', picker);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); });
    const sizeSel = h('select', { style: 'width:auto', onchange: (e) => { maxDim = Number(e.target.value); try { localStorage.setItem('pidash.photoMax', String(maxDim)); } catch { /* ignore */ } } },
      MAXES.map(([v, l]) => h('option', { value: v, selected: String(maxDim) === v }, l)));
    loadPhotos();

    const sub = (t) => h('h3', { style: 'font-size:14px;margin:16px 0 4px' }, t);
    const panel = h('div', { class: 'panel' }, h('h2', {}, 'Background'),
      h('p', { class: 'muted small' }, 'What is behind your widgets: a gradient, or a slideshow of your own photos. The gradient colors come from the theme unless you set your own below.'),
      F('background', 'Show', 'select', { options: [{ value: 'gradient', label: 'Gradient' }, { value: 'photos', label: 'Photo slideshow' }], rerender: true }),
      sub('Gradient'),
      preview,
      F('gradientStyle', 'Style', 'select', { options: [{ value: 'linear', label: 'Linear (angled)' }, { value: 'radial', label: 'Radial (glow from the middle)' }, { value: 'solid', label: 'Solid color' }] }),
      F('gradientAngle', 'Angle (linear)', 'range', { min: 0, max: 360, step: 5, unit: '\u00B0', default: 135 }),
      h('div', { class: 'row', style: 'align-items:flex-start;gap:24px' },
        F('bg1', 'Color A', 'color', { fallback: tv['--bg1'] }),
        F('bg2', 'Color B', 'color', { fallback: tv['--bg2'] })),
      sub('Photo slideshow'),
      warn,
      F('photoSeconds', 'Seconds per photo', 'number', { placeholder: '60' }),
      F('photoOrder', 'Order', 'select', { options: [{ value: 'random', label: 'Shuffled' }, { value: 'name', label: 'By file name' }] }),
      F('photoFit', 'Fit', 'select', { options: [{ value: 'cover', label: 'Fill the screen (crops the edges)' }, { value: 'contain', label: 'Show the whole photo (gradient fills the bars)' }] }),
      F('photoDim', 'Dim the photos', 'range', { min: 0, max: 90, step: 5, unit: '%', default: 45, resettable: true, help: 'Darkens the photo (lightens it on light themes) so widget text stays readable.' }),
      F('photoBlur', 'Blur', 'range', { min: 0, max: 30, step: 1, unit: ' px', default: 0 }),
      F('photoFade', 'Cross-fade time', 'range', { min: 0, max: 10, step: 0.5, unit: ' s', default: 2 }),
      sub('Your photos'),
      h('p', { class: 'muted small' }, 'Uploads and deletes happen immediately (no need to Save). Photos are stored on the PiDash server. Large photos are shrunk in your browser before uploading, which keeps the Pi fast.'),
      h('div', { class: 'row', style: 'margin-bottom:8px' }, h('span', { class: 'small' }, 'Shrink photos to:'), sizeSel, count),
      drop, status, gallery);
    panel.addEventListener('input', paint);
    panel.addEventListener('change', paint);
    return panel;
  }

  function viewDisplay() {
    const d = cfg.display;
    const F = (key, label, type, extra = {}) => field({ key, label, type, ...extra }, d);
    const fonts = Object.entries(window.PIDASH_FONTS).map(([value, f]) => ({ value, label: f.label }));
    return [
      h('div', { class: 'panel' }, h('h2', {}, 'Theme'),
        h('p', { class: 'muted small' }, 'Pick a look, or let PiDash choose: shuffle through your themes, or follow the seasons and holidays automatically. Everything below customizes it.'),
        F('themeMode', 'Theme mode', 'select', { rerender: true, options: [{ value: 'fixed', label: 'Fixed - always the theme I pick' }, { value: 'random', label: 'Random - shuffle my themes' }, { value: 'seasonal', label: 'Seasonal - follows the calendar and holidays' }] }),
        themeModeControls(d, F),
        F('accent', 'Accent color (highlights, today, dots)', 'color', { help: 'Overrides the theme accent.' }),
        F('cardStyle', 'Card style', 'select', { options: [{ value: 'glass', label: 'Glass (translucent blur)' }, { value: 'solid', label: 'Solid' }, { value: 'flat', label: 'Outline only' }] }),
        F('font', 'Font', 'select', { options: fonts }),
        F('fontScale', 'Text size (%)', 'number', { placeholder: '100', help: '80-150. Use this to fit your screen or TV.' })),
      backgroundPanel(d, F),
      h('div', { class: 'panel' }, h('h2', {}, 'Layout'),
        h('p', { class: 'muted small' }, 'How the screen is arranged. "Always visible" widgets (set on the Widgets tab) go in the bar or sidebar; the rest rotate. On portrait screens the side-by-side layouts become a top bar automatically.'),
        layoutGrid(d),
        F('sidebarSize', 'Sidebar width (Sidebar left / right)', 'select', { options: [{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }] }),
        F('gridColumns', 'Grid columns (Grid layout)', 'select', { options: [{ value: 'auto', label: 'Automatic' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }] }),
        F('spacing', 'Spacing', 'select', { options: [{ value: 'tight', label: 'Tight - fits more' }, { value: 'normal', label: 'Normal' }, { value: 'roomy', label: 'Roomy' }] }),
        F('corners', 'Corners', 'select', { options: [{ value: 'sharp', label: 'Sharp' }, { value: 'normal', label: 'Rounded' }, { value: 'round', label: 'Very round' }] }),
        F('transition', 'Rotation transition', 'select', { options: [{ value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }, { value: 'zoom', label: 'Zoom' }, { value: 'none', label: 'None (instant)' }] }),
        F('titleCase', 'Widget titles', 'select', { options: [{ value: 'upper', label: 'CAPITALS (default look)' }, { value: 'normal', label: 'As typed (keeps your capitalization)' }], help: 'Rename widgets on the Widgets tab.' }),
        F('contentFit', 'Widget content fit', 'select', { options: [{ value: 'fill', label: 'Fill - shrink to fit and grow to use spare room' }, { value: 'shrink', label: 'Shrink only - never enlarge' }, { value: 'off', label: 'Off - fixed size' }], help: 'Scales each widget so nothing is cut off in its cell.' }),
        F('dots', 'Show the page dots at the bottom', 'checkbox', { default: true })),
      d.layout === 'grid-rotate' ? paneEditor(d) : null,
      h('div', { class: 'panel' }, h('h2', {}, 'Night'),
        h('p', { class: 'muted small' }, 'Between the night hours below you can switch to a different theme and/or dim the screen.'),
        F('nightMode', 'Dim the screen at night', 'checkbox'),
        F('nightStart', 'Night starts (hour 0-23)', 'number'),
        F('nightEnd', 'Night ends (hour 0-23)', 'number'),
        F('nightDim', 'Night brightness (0 = black, 1 = full)', 'number'),
        h('span', { style: 'display:block;font-weight:600;font-size:13px;margin:10px 0 6px' }, 'Night theme'),
        themeGrid(d, 'nightTheme', true)),
      h('div', { class: 'panel' }, h('h2', {}, 'Display'),
        F('title', 'Browser tab title', 'text'),
        F('rotateSeconds', 'Seconds each rotating widget stays on screen', 'number'),
        F('timeFormat', 'Clock', 'select', { options: [{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }] }),
        F('units', 'Units', 'select', { options: [{ value: 'imperial', label: 'Imperial (°F, mph)' }, { value: 'metric', label: 'Metric (°C, km/h)' }] }),
        F('locale', 'Locale (optional)', 'text', { placeholder: 'en-US', help: 'Controls date/day names. Blank = browser default.' }),
        F('rotation', 'Screen rotation (degrees)', 'select', { options: [0, 90, 180, 270].map((v) => ({ value: v, label: `${v}°` })), help: 'For portrait-mounted screens.' })),
    ].filter(Boolean);
  }

  // ---- google ------------------------------------------------------------
  function viewGoogle() {
    const g = cfg.google;
    const status = h('span', { class: 'pill' }, 'checking…');
    const calBox = h('div');
    const redirectCode = h('code', {}, 'http://localhost:8080/api/google/callback');
    const paste = h('input', { type: 'text', class: 'grow', placeholder: 'Paste the address-bar URL (http://localhost:8080/api/google/callback?code=…)' });
    const refresh = guard(async () => {
      const s = await api('GET', '/google/status');
      status.textContent = s.connected ? 'Connected' : s.configured ? 'Not connected' : 'Not configured';
      status.className = `pill ${s.connected ? 'good' : ''}`;
      redirectCode.textContent = s.redirectUri;
    });
    refresh();
    const saveFirst = async () => { if (dirty) await save(true); };

    return [
      h('div', { class: 'panel' }, h('h2', {}, 'Google Calendar ', status),
        h('p', { class: 'muted small' }, 'Prefer zero setup? Skip this tab: in Google Calendar open Settings → your calendar → "Secret address in iCal format", and paste that URL into the Calendar widget\'s ICS field.'),
        field({ key: 'clientId', label: 'OAuth Client ID', type: 'text' }, g),
        field({ key: 'clientSecret', label: 'OAuth Client Secret', type: 'text', secret: true }, g),
        field({ key: 'redirectUri', label: 'Redirect URI (advanced, optional)', type: 'text', placeholder: 'default: http://localhost:<port>/api/google/callback' }, g),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: guard(async () => {
            await saveFirst();
            const { url } = await api('POST', '/google/auth-url');
            window.open(url, '_blank', 'noopener');
            toast('Complete sign-in in the new tab.');
          }) }, 'Connect Google'),
          h('button', { class: 'btn danger', onclick: guard(async () => { await api('POST', '/google/disconnect'); toast('Disconnected'); refresh(); }) }, 'Disconnect')),
        h('p', { class: 'small muted' }, 'If you are doing this from a phone/PC (not the Pi itself), Google will redirect to a "localhost" page that fails to load. That is expected: copy the full URL from the address bar and paste it here:'),
        h('div', { class: 'row' }, paste, h('button', { class: 'btn', onclick: guard(async () => {
          await api('POST', '/google/exchange', { code: paste.value });
          toast('Google connected'); paste.value = ''; refresh();
        }) }, 'Finish connecting'))),
      h('div', { class: 'panel' }, h('h2', {}, 'Your calendars'),
        h('p', { class: 'muted small' }, 'Copy IDs into the Calendar widget to pick specific calendars (blank = primary).'),
        h('button', { class: 'btn', onclick: guard(async () => {
          const list = await api('GET', '/google/calendars');
          calBox.replaceChildren(h('ul', {}, list.map((c) => h('li', {}, c.name, ' - ', h('code', {}, c.id)))));
        }) }, 'List calendars'), calBox),
      h('div', { class: 'panel' }, h('h2', {}, 'One-time Google setup'),
        h('ol', { class: 'steps small' },
          h('li', {}, 'Go to console.cloud.google.com, create a project, and enable the "Google Calendar API".'),
          h('li', {}, 'APIs & Services → OAuth consent screen: choose External, fill in app name/email, add your own address as a test user, then ', h('b', {}, 'Publish app'), ' (set to "In production") so the login does not expire after 7 days. You may see an "unverified app" warning for your own account - that is normal for personal use.'),
          h('li', {}, 'Credentials → Create credentials → OAuth client ID → type ', h('b', {}, 'Web application'), '. Under Authorized redirect URIs add: ', redirectCode, '.'),
          h('li', {}, 'Paste the Client ID and Secret above, Save, then Connect Google.')))];
  }

  // ---- health (saved immediately, not part of "Save & apply") ------------
  function viewHealth() {
    const url = `${location.origin}/api/health/ingest`;
    const tokenBox = h('input', { type: 'text', readonly: true, class: 'grow', value: '...', onclick: (e) => e.target.select() });
    const people = h('span', { class: 'muted small' }, '');
    const urlCode = h('code', {}, url);
    const tokenCode = h('code', {}, '(loading...)');
    const safariCode = h('code', {}, `${location.origin}/api/health`);
    let token = '';
    const curlText = () => `curl -X POST "${url}" \\\n  -H "Authorization: Bearer ${token || '<token>'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"steps": 8421, "activeCalories": 420, "exerciseMinutes": 32, "restingHeartRate": 58, "sleepHours": 7.2}'`;
    const curl = h('pre', { style: 'overflow:auto;background:var(--bg);padding:10px;border-radius:8px;font-size:12px' }, curlText());
    const refresh = guard(async () => {
      const i = await api('GET', '/health/info');
      token = i.token;
      tokenBox.value = token;
      tokenCode.textContent = token;
      people.textContent = i.people.length ? `Data received for: ${i.people.join(', ')}` : 'No data received yet.';
      curl.textContent = curlText();
    });
    refresh();
    return [
      h('div', { class: 'panel' }, h('h2', {}, 'Send health data to PiDash'),
        h('p', { class: 'muted small' }, 'Apple Health and Android Health Connect keep your data on the phone - there is no cloud API PiDash can read from. Instead your phone (or watch app) pushes a daily summary to the address below. The token acts like a password for this one address, separate from the admin password.'),
        h('label', { class: 'f' }, h('span', {}, 'Endpoint (POST)'), h('input', { type: 'text', readonly: true, value: url, onclick: (e) => e.target.select() })),
        h('label', { class: 'f' }, h('span', {}, 'Token'), h('div', { class: 'row' }, tokenBox,
          h('button', { class: 'btn', onclick: guard(async () => { try { await navigator.clipboard.writeText(token); toast('Token copied'); } catch { tokenBox.select(); toast('Press Ctrl+C to copy'); } }) }, 'Copy'),
          h('button', { class: 'btn danger', onclick: guard(async () => { if (!confirm('Generate a new token? Anything using the old one stops working.')) return; await api('POST', '/health/token'); await refresh(); toast('New token created'); }) }, 'Regenerate'))),
        people,
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'btn', onclick: guard(async () => { await api('POST', '/health/sample', { person: 'me' }); await refresh(); toast('Sample data added - add a Health widget to see it'); }) }, 'Send sample data'),
          h('button', { class: 'btn danger', onclick: guard(async () => { if (confirm('Delete all stored health data?')) { await api('DELETE', '/health/data'); await refresh(); } }) }, 'Clear stored data'))),
      h('div', { class: 'panel' }, h('h2', {}, 'Step 1 - check your iPhone can reach PiDash'),
        h('p', { class: 'small' }, 'On the iPhone, open this address in Safari: ', safariCode),
        h('p', { class: 'small' }, 'You should see ', h('code', {}, '{"ok":true}'), ' and no warning. Use exactly this address (same host name, same http/https) for the endpoint in the shortcut. If Safari shows a certificate warning, Shortcuts will refuse the connection too ("the certificate for this server is invalid"):'),
        h('ul', { class: 'small' },
          h('li', {}, h('b', {}, 'Wrong name: '), 'the certificate only covers a host name such as ', h('code', {}, 'dash.example.com'), ', not an IP address or a different name. Open PiDash by the name on the certificate (point that name at the server in your router/DNS).'),
          h('li', {}, h('b', {}, 'Self-signed or private certificate: '), 'get a real one (Let\'s Encrypt works for a home domain, including with the DNS challenge for names that are not public), or install your certificate authority on the iPhone: open the .crt file, Settings > Profile Downloaded > Install, then Settings > General > About > Certificate Trust Settings and switch it on.'),
          h('li', {}, h('b', {}, 'Expired or incomplete chain: '), 'renew it and have the proxy serve the full chain (fullchain.pem), not just the leaf certificate.'),
          h('li', {}, h('b', {}, 'Simplest on your home network: '), 'skip the proxy and use the direct address ', h('code', {}, 'http://<server-ip>:8080/api/health/ingest'), '. It is unencrypted, but only on your own Wi-Fi, and the token still protects it.'))),
      h('div', { class: 'panel' }, h('h2', {}, 'Step 2 - Apple Health with Shortcuts (iPhone / Apple Watch)'),
        h('p', { class: 'muted small' }, 'Free, built in, about 10 minutes. Keep these handy to paste into the shortcut:'),
        h('p', { class: 'small' }, 'Endpoint: ', urlCode, h('br'), 'Token: ', tokenCode),
        h('h3', { style: 'font-size:14px;margin:14px 0 4px' }, 'A. Build the shortcut'),
        h('p', { class: 'small' }, 'Open the ', h('b', {}, 'Shortcuts'), ' app, tap ', h('b', {}, '+'), ' (top right) and name it ', h('b', {}, 'PiDash Health'), '.'),
        h('ol', { class: 'steps small' },
          h('li', {}, h('b', {}, 'Get today\'s steps. '), 'Add Action > ', h('i', {}, 'Find Health Samples'), '. Add Filter: ', h('b', {}, 'Type'), ' is ', h('b', {}, 'Steps'), '; add another filter: ', h('b', {}, 'Start Date'), ' is ', h('b', {}, 'Today'), '. Then add ', h('i', {}, 'Calculate Statistics'), ' and set it to ', h('b', {}, 'Sum'), '. Then add ', h('i', {}, 'Set Variable'), ': name it ', h('code', {}, 'steps'), ', value = the Calculation Result.'),
          h('li', {}, h('b', {}, 'Repeat for the other numbers '), '(copy those four actions and change the type). Start with just steps and active calories to see it work, then add more:'),
          h('table', { class: 'small', style: 'border-collapse:collapse;margin:6px 0 6px 18px' },
            h('tr', {}, ['Metric', 'Type to pick', 'Statistic', 'Variable name'].map((t) => h('th', { style: 'text-align:left;padding:2px 14px 2px 0' }, t))),
            ...[['Active calories', 'Active Energy', 'Sum', 'activeCalories'], ['Exercise minutes', 'Exercise Minutes', 'Sum', 'exerciseMinutes'], ['Resting heart rate', 'Resting Heart Rate', 'Latest', 'restingHeartRate'], ['Weight (lb)', 'Body Mass', 'Latest', 'weightLb']]
              .map((r) => h('tr', {}, r.map((t, k) => h('td', { style: 'padding:2px 14px 2px 0' }, k === 3 ? h('code', {}, t) : t))))),
          h('li', {}, h('b', {}, 'Send it. '), 'Add ', h('i', {}, 'Get Contents of URL'), '. ', h('b', {}, 'URL'), ': paste the endpoint above. Tap ', h('b', {}, 'Show More'), ' and set ', h('b', {}, 'Method'), ' to ', h('b', {}, 'POST'), '.'),
          h('li', {}, h('b', {}, 'Headers > Add new header: '), 'Key ', h('code', {}, 'Authorization'), ', Text ', h('code', {}, 'Bearer '), ' followed by the token above (one space after "Bearer").'),
          h('li', {}, h('b', {}, 'Request Body > JSON > Add new field '), 'for each number: choose type ', h('b', {}, 'Number'), ', Key ', h('code', {}, 'steps'), ', and for the Value tap the box and pick the variable ', h('code', {}, 'steps'), '. Do the same for ', h('code', {}, 'activeCalories'), ' and any others. The keys must be spelled exactly like the variable names in the table.'),
          h('li', {}, 'Optional but recommended: wrap the ', h('i', {}, 'Get Contents of URL'), ' action in an ', h('i', {}, 'If'), ' action: ', h('b', {}, 'If steps is greater than 0'), '. iOS locks Health data while the phone is locked, so a run at that moment can read zero and would otherwise overwrite today\'s steps.'),
          h('li', {}, 'Add ', h('i', {}, 'Show Result'), ' at the very end while testing (delete it later).')),
        h('h3', { style: 'font-size:14px;margin:14px 0 4px' }, 'B. Test it'),
        h('p', { class: 'small' }, 'Tap the ', h('b', {}, '\u25B6'), ' play button. The first time, iOS asks for access to your Health data: tap Allow for each type. You should see ', h('code', {}, '{"ok":true,...}'), ', and this page (refresh it) should say "Data received for: me". Then add the Health widget and press Save & apply.'),
        h('h3', { style: 'font-size:14px;margin:14px 0 4px' }, 'C. Run it automatically'),
        h('ol', { class: 'steps small' },
          h('li', {}, 'Shortcuts > ', h('b', {}, 'Automation'), ' tab > ', h('b', {}, '+'), ' > Create Personal Automation > ', h('b', {}, 'Time of Day'), '.'),
          h('li', {}, 'Pick a time (for example 8:00 AM) and ', h('b', {}, 'Daily'), ' > Next.'),
          h('li', {}, 'Add Action > ', h('i', {}, 'Run Shortcut'), ' > choose ', h('b', {}, 'PiDash Health'), ' > Next.'),
          h('li', {}, 'Turn ', h('b', {}, 'Ask Before Running'), ' off and confirm > Done.'),
          h('li', {}, 'Repeat for more times, such as noon, 6 PM and 10 PM.')),
        h('h3', { style: 'font-size:14px;margin:14px 0 4px' }, 'If something goes wrong'),
        h('ul', { class: 'small' },
          h('li', {}, h('code', {}, 'Invalid token'), ': the header must be exactly ', h('code', {}, 'Authorization'), ' with ', h('code', {}, 'Bearer <token>'), '.'),
          h('li', {}, h('code', {}, 'No recognized health metrics'), ': the numbers came through empty, or a key is misspelled.'),
          h('li', {}, 'Certificate error or "cannot connect": see Step 1 above.'))),
      h('div', { class: 'panel' }, h('h2', {}, 'Alternative: Health Auto Export (app)'),
        h('p', { class: 'small' }, 'If you would rather not build a shortcut, the Health Auto Export app can push to PiDash on a schedule. Create a REST API automation with the endpoint above, header ', h('code', {}, 'Authorization: Bearer <token>'), ', format JSON, and "Summarize data" on with aggregation by day. PiDash understands its steps, active energy, exercise, stand, heart rate, resting HR, sleep, weight, distance and blood oxygen metrics. The same certificate rule applies.')),
      h('div', { class: 'panel' }, h('h2', {}, 'Data format'),
        h('p', { class: 'muted small' }, 'Send any subset of these as JSON. Each send replaces that day\'s value for the metric. Add "date" (YYYY-MM-DD) to backfill, "person" for multiple people, or "days": [ ... ] for several days at once.'),
        h('p', { class: 'small' }, h('code', {}, 'steps, activeCalories, exerciseMinutes, standHours, heartRate, restingHeartRate, sleepHours (or sleepMinutes), bloodOxygen, distanceKm / distanceMi, weightKg / weightLb')),
        curl),
      h('div', { class: 'panel' }, h('h2', {}, 'Google / Android'),
        h('p', { class: 'small' }, 'Health Connect also has no cloud API, so use any Android automation app that can read Health Connect and send an HTTP POST (same JSON and header as above). Google Fit\'s cloud API is being wound down, so PiDash does not use it. If you wear a Fitbit, tell me - a direct Fitbit pull is possible as a separate integration.')),
    ];
  }

  // ---- reminders (saved immediately, not part of "Save & apply") ---------
  function viewReminders() {
    const list = h('div');
    const text = h('input', { type: 'text', class: 'grow', placeholder: 'e.g. Take out the trash' });
    const due = h('input', { type: 'date' });
    const star = h('label', { class: 'chk', style: 'margin:0' }, h('input', { type: 'checkbox' }), '\u2605 Pin');
    const load = guard(async () => {
      const items = await api('GET', '/reminders');
      list.replaceChildren(items.length ? items.map((r) => h('div', { class: `rem ${r.done ? 'done' : ''}` },
        h('input', { type: 'checkbox', checked: r.done, onchange: guard(async (e) => { await api('PATCH', `/reminders/${r.id}`, { done: e.target.checked }); load(); }) }),
        h('button', { class: 'btn sm ghost', title: r.starred ? 'Unpin from the top' : 'Pin to the top and highlight', onclick: guard(async () => { await api('PATCH', `/reminders/${r.id}`, { starred: !r.starred }); load(); }) }, r.starred ? '\u2605' : '\u2606'),
        h('span', { class: 't' }, r.text), r.due ? h('span', { class: 'pill' }, r.due) : null,
        h('button', { class: 'btn sm danger', onclick: guard(async () => { await api('DELETE', `/reminders/${r.id}`); load(); }) }, 'Delete'))) : h('p', { class: 'muted' }, 'No reminders.'));
    });
    load();
    const add = guard(async () => { await api('POST', '/reminders', { text: text.value, due: due.value || null, starred: star.querySelector('input').checked }); text.value = ''; due.value = ''; star.querySelector('input').checked = false; load(); });
    text.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    return [h('div', { class: 'panel' }, h('h2', {}, 'Reminders'),
      h('p', { class: 'muted small' }, 'Changes here apply instantly. Show them by adding the Reminders widget.'),
      h('div', { class: 'row' }, text, due, star, h('button', { class: 'btn primary', onclick: add }, 'Add')), list)];
  }

  // ---- security ----------------------------------------------------------
  function viewSecurity() {
    return [h('div', { class: 'panel' }, h('h2', {}, 'Admin password'),
      h('p', { class: 'muted small' }, `Currently: ${cfg.admin.hasPassword ? 'password protected' : 'NOT protected - anyone on your network can open this page'}. The display itself is always viewable without a password. The browser will ask for a password (any username).`),
      h('label', { class: 'f' }, h('span', {}, 'New password (blank + Save = remove password)'),
        h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => { cfg.admin.newPassword = e.target.value; touch(); } })))];
  }

  // ---- load / save -------------------------------------------------------
  async function save(quiet) {
    const body = { display: cfg.display, google: cfg.google, widgets: cfg.widgets, admin: cfg.admin.newPassword !== undefined ? { newPassword: cfg.admin.newPassword } : undefined };
    cfg = await api('PUT', '/config', body);
    dirty = false;
    $('#save').disabled = true;
    if (!quiet) toast('Saved - the display is reloading');
    render();
  }

  $('#save').addEventListener('click', guard(() => save(false)));
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

  guard(async () => {
    [cfg, types] = await Promise.all([api('GET', '/config'), api('GET', '/widget-types')]);
    render();
  })();
})();
