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
      return wrap(h('select', { onchange: (e) => set(e.target.value) }, f.options.map((o) => h('option', { value: o.value, selected: (val || f.options[0].value) === o.value }, o.label))));
    }
    if (f.type === 'color') {
      const hex = /^#[0-9a-f]{6}$/i.test(val || '') ? val : f.fallback || '#5ab0ff';
      const picker = h('input', { type: 'color', value: hex, style: 'width:56px;height:36px;padding:2px;flex:none', oninput: (e) => { set(e.target.value); state.textContent = e.target.value; } });
      const state = h('span', { class: 'muted small' }, val || 'theme default');
      return h('div', { class: 'f' }, h('span', { style: 'display:block;font-weight:600;font-size:13px;margin-bottom:3px' }, f.label),
        h('div', { class: 'row' }, picker, state, h('button', { class: 'btn sm', type: 'button', onclick: () => { set(''); render(); } }, 'Use theme default')),
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
          h('div', { class: 'title', onclick: () => { isOpen ? open.delete(w.id) : open.add(w.id); render(); } }, `${isOpen ? '▾' : '▸'} ${t.name}`, h('small', {}, w.id)),
          h('label', { class: 'chk', style: 'margin:0' }, h('input', { type: 'checkbox', checked: w.enabled, onchange: (e) => { w.enabled = e.target.checked; touch(); render(); } }), 'On'),
          h('select', { style: 'width:auto', onchange: (e) => { w.slot = e.target.value; touch(); render(); } },
            h('option', { value: 'sidebar', selected: w.slot === 'sidebar' }, 'Always visible'),
            h('option', { value: 'rotate', selected: w.slot !== 'sidebar' }, 'Rotating')),
          h('button', { class: 'btn sm', title: 'Move up', onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn sm', title: 'Move down', onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'btn sm danger', onclick: () => { if (confirm(`Remove ${t.name} (${w.id})?`)) { cfg.widgets.splice(i, 1); touch(); render(); } } }, 'Remove')),
        isOpen ? h('div', { class: 'body' },
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
  function themeGrid(d, key, allowNone) {
    const themes = Object.entries(window.PIDASH_THEMES).filter(([k]) => k !== 'dark');
    const tile = (k, label, bg, text, accent, sel) => h('button', {
      type: 'button', title: label, class: `tile ${sel ? 'sel' : ''}`,
      style: `background:linear-gradient(135deg,${bg[0]},${bg[1]});color:${text};border-color:${sel ? accent : 'transparent'}`,
      onclick: () => { d[key] = k; touch(); render(); },
    }, h('b', { style: `color:${accent}` }, 'Aa'), h('span', {}, label));
    const current = d[key] === 'dark' ? 'midnight' : d[key];
    return h('div', { class: 'tiles' },
      allowNone ? h('button', { type: 'button', class: `tile none ${!d[key] ? 'sel' : ''}`, onclick: () => { d[key] = ''; touch(); render(); } }, h('span', {}, 'Same as day')) : null,
      themes.map(([k, t]) => tile(k, t.label, [t.vars['--bg1'], t.vars['--bg2']], t.vars['--text'], t.vars['--accent'], current === k)));
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
    const label = (w) => `${(types.find((t) => t.type === w.type) || { name: w.type }).name} (${w.id})`;
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

    return h('div', { class: 'panel' }, h('h2', {}, 'Grid panes'),
      h('p', { class: 'muted small' }, 'Each pane is one cell of the grid. A pane with several widgets rotates through them in the order shown (use the arrows); with one widget it stays put. Wide/tall/large panes take more room, which suits the calendar. A widget can appear in more than one pane. A widget\'s own "Seconds on screen" setting overrides the pane timing.'),
      panes.length ? panes.map(paneCard) : h('p', { class: 'muted' }, 'No panes yet, so PiDash uses a suggested arrangement: each always-visible widget gets its own pane, and all the rotating widgets share one. Start from it and adjust:'),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn primary', onclick: () => { panes.push({ widgets: [], size: 's', seconds: '' }); touch(); render(); } }, 'Add pane'),
        h('button', { class: 'btn', onclick: () => { d.gridPanes = window.PIDASH_SUGGEST_PANES(cfg.widgets); touch(); render(); } }, panes.length ? 'Reset to suggested' : 'Start from suggested')),
      panes.length && missing.length ? h('p', { class: 'small', style: 'color:var(--bad)' }, `Not shown on the grid: ${missing.map(label).join(', ')}`) : null);
  }

  function viewDisplay() {
    const d = cfg.display;
    const F = (key, label, type, extra = {}) => field({ key, label, type, ...extra }, d);
    const fonts = Object.entries(window.PIDASH_FONTS).map(([value, f]) => ({ value, label: f.label }));
    return [
      h('div', { class: 'panel' }, h('h2', {}, 'Theme'),
        h('p', { class: 'muted small' }, 'Pick a look. Everything below customizes it.'),
        themeGrid(d, 'theme', false),
        F('accent', 'Accent color (highlights, today, dots)', 'color', { help: 'Overrides the theme accent.' }),
        h('div', { class: 'row', style: 'align-items:flex-start;gap:24px' },
          F('bg1', 'Background color A', 'color', { fallback: '#0b1220' }),
          F('bg2', 'Background color B', 'color', { fallback: '#1b2440' })),
        F('cardStyle', 'Card style', 'select', { options: [{ value: 'glass', label: 'Glass (translucent blur)' }, { value: 'solid', label: 'Solid' }, { value: 'flat', label: 'Outline only' }] }),
        F('font', 'Font', 'select', { options: fonts }),
        F('fontScale', 'Text size (%)', 'number', { placeholder: '100', help: '80-150. Use this to fit your screen or TV.' })),
      h('div', { class: 'panel' }, h('h2', {}, 'Layout'),
        h('p', { class: 'muted small' }, 'How the screen is arranged. "Always visible" widgets (set on the Widgets tab) go in the bar or sidebar; the rest rotate. On portrait screens the side-by-side layouts become a top bar automatically.'),
        layoutGrid(d),
        F('sidebarSize', 'Sidebar width (Sidebar left / right)', 'select', { options: [{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }] }),
        F('gridColumns', 'Grid columns (Grid layout)', 'select', { options: [{ value: 'auto', label: 'Automatic' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }] }),
        F('spacing', 'Spacing', 'select', { options: [{ value: 'tight', label: 'Tight - fits more' }, { value: 'normal', label: 'Normal' }, { value: 'roomy', label: 'Roomy' }] }),
        F('corners', 'Corners', 'select', { options: [{ value: 'sharp', label: 'Sharp' }, { value: 'normal', label: 'Rounded' }, { value: 'round', label: 'Very round' }] }),
        F('transition', 'Rotation transition', 'select', { options: [{ value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }, { value: 'zoom', label: 'Zoom' }, { value: 'none', label: 'None (instant)' }] }),
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
        F('rotation', 'Screen rotation (degrees)', 'select', { options: [0, 90, 180, 270].map((v) => ({ value: v, label: `${v}°` })), help: 'For portrait-mounted screens.' }),
        F('background', 'Background', 'select', { options: [{ value: 'gradient', label: 'Gradient' }, { value: 'photos', label: 'Photo slideshow' }], help: 'Photos: put images in <data dir>/backgrounds on the Pi (JPG/PNG/WebP).' }),
        F('photoSeconds', 'Seconds per photo', 'number')),
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
    let token = '';
    const curlText = () => `curl -X POST "${url}" \\\n  -H "Authorization: Bearer ${token || '<token>'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"steps": 8421, "activeCalories": 420, "exerciseMinutes": 32, "restingHeartRate": 58, "sleepHours": 7.2}'`;
    const curl = h('pre', { style: 'overflow:auto;background:var(--bg);padding:10px;border-radius:8px;font-size:12px' }, curlText());
    const refresh = guard(async () => {
      const i = await api('GET', '/health/info');
      token = i.token;
      tokenBox.value = token;
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
      h('div', { class: 'panel' }, h('h2', {}, 'Data format'),
        h('p', { class: 'muted small' }, 'Send any subset of these as JSON. Each send replaces that day\'s value for the metric. Add "date" (YYYY-MM-DD) to backfill, "person" for multiple people, or "days": [ ... ] for several days at once.'),
        h('p', { class: 'small' }, h('code', {}, 'steps, activeCalories, exerciseMinutes, standHours, heartRate, restingHeartRate, sleepHours (or sleepMinutes), bloodOxygen, distanceKm / distanceMi, weightKg / weightLb')),
        curl),
      h('div', { class: 'panel' }, h('h2', {}, 'Apple Health (iPhone / Apple Watch)'),
        h('p', { class: 'small' }, h('b', {}, 'Option A - Shortcuts (free). '), 'In the Shortcuts app create a shortcut: for each metric use ', h('i', {}, 'Find Health Samples'), ' (Start Date = today, e.g. Steps) then ', h('i', {}, 'Calculate Statistics > Sum'), ' (use Latest/Average for heart rate and weight). Finish with ', h('i', {}, 'Get Contents of URL'), ': URL = the endpoint above, Method = POST, Headers: ', h('code', {}, 'Authorization: Bearer <token>'), ', Request Body = JSON with fields like ', h('code', {}, 'steps'), ' and ', h('code', {}, 'activeCalories'), ' set to the numbers. Then Automation > Time of Day (e.g. 8am, noon, 6pm, 10pm) > Run Shortcut, with "Run Immediately".'),
        h('p', { class: 'small' }, h('b', {}, 'Option B - Health Auto Export (app). '), 'Create a REST API automation with the URL above, header ', h('code', {}, 'Authorization: Bearer <token>'), ', format JSON, and "Summarize data" on with aggregation by day. PiDash understands its steps, active energy, exercise, stand, heart rate, resting HR, sleep, weight, distance and blood oxygen metrics.')),
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
