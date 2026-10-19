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
      return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: val, onchange: (e) => set(e.target.checked) }), f.label);
    }
    if (f.type === 'select') {
      return wrap(h('select', { onchange: (e) => set(e.target.value) }, f.options.map((o) => h('option', { value: o.value, selected: (val || f.options[0].value) === o.value }, o.label))));
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
  const TABS = { widgets: 'Widgets', display: 'Display', google: 'Google', reminders: 'Reminders', security: 'Security' };

  function render() {
    $('#tabs').replaceChildren(...Object.entries(TABS).map(([k, label]) =>
      h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; render(); } }, label)));
    const view = $('#view');
    view.replaceChildren(...({ widgets: viewWidgets, display: viewDisplay, google: viewGoogle, reminders: viewReminders, security: viewSecurity })[tab]());
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
  function viewDisplay() {
    const d = cfg.display;
    const F = (key, label, type, extra = {}) => field({ key, label, type, ...extra }, d);
    return [h('div', { class: 'panel' }, h('h2', {}, 'Display'),
      F('title', 'Browser tab title', 'text'),
      F('rotateSeconds', 'Seconds each rotating widget stays on screen', 'number'),
      F('theme', 'Theme', 'select', { options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] }),
      F('timeFormat', 'Clock', 'select', { options: [{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }] }),
      F('units', 'Units', 'select', { options: [{ value: 'imperial', label: 'Imperial (°F, mph)' }, { value: 'metric', label: 'Metric (°C, km/h)' }] }),
      F('locale', 'Locale (optional)', 'text', { placeholder: 'en-US', help: 'Controls date/day names. Blank = browser default.' }),
      F('rotation', 'Screen rotation (degrees)', 'select', { options: [0, 90, 180, 270].map((v) => ({ value: v, label: `${v}°` })), help: 'For portrait-mounted screens.' }),
      F('background', 'Background', 'select', { options: [{ value: 'gradient', label: 'Gradient' }, { value: 'photos', label: 'Photo slideshow' }], help: 'Photos: put images in <data dir>/backgrounds on the Pi (JPG/PNG/WebP).' }),
      F('photoSeconds', 'Seconds per photo', 'number'),
      F('nightMode', 'Dim the screen at night', 'checkbox'),
      F('nightStart', 'Night starts (hour 0-23)', 'number'),
      F('nightEnd', 'Night ends (hour 0-23)', 'number'),
      F('nightDim', 'Night brightness (0 = black, 1 = full)', 'number'))];
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

  // ---- reminders (saved immediately, not part of "Save & apply") ---------
  function viewReminders() {
    const list = h('div');
    const text = h('input', { type: 'text', class: 'grow', placeholder: 'e.g. Take out the trash' });
    const due = h('input', { type: 'date' });
    const load = guard(async () => {
      const items = await api('GET', '/reminders');
      list.replaceChildren(items.length ? items.map((r) => h('div', { class: `rem ${r.done ? 'done' : ''}` },
        h('input', { type: 'checkbox', checked: r.done, onchange: guard(async (e) => { await api('PATCH', `/reminders/${r.id}`, { done: e.target.checked }); load(); }) }),
        h('span', { class: 't' }, r.text), r.due ? h('span', { class: 'pill' }, r.due) : null,
        h('button', { class: 'btn sm danger', onclick: guard(async () => { await api('DELETE', `/reminders/${r.id}`); load(); }) }, 'Delete'))) : h('p', { class: 'muted' }, 'No reminders.'));
    });
    load();
    const add = guard(async () => { await api('POST', '/reminders', { text: text.value, due: due.value || null }); text.value = ''; due.value = ''; load(); });
    text.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    return [h('div', { class: 'panel' }, h('h2', {}, 'Reminders'),
      h('p', { class: 'muted small' }, 'Changes here apply instantly. Show them by adding the Reminders widget.'),
      h('div', { class: 'row' }, text, due, h('button', { class: 'btn primary', onclick: add }, 'Add')), list)];
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
