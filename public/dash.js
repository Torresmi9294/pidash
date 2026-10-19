'use strict';
// PiDash display runtime. Widgets register themselves with Dash.register(type, def):
//   def.render(el, data, ctx)  - draw `data` into `el` (replace its content)
//   def.chrome === false       - hide the card title bar
// ctx = { id, options, display, slot: 'sidebar'|'rotate', fmt, h }
(() => {
  const registry = {};
  const timers = [];
  let display = null;
  let rev = null;

  // Safe DOM builder - never uses innerHTML, so calendar/RSS text can't inject markup.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function makeFmt(d) {
    const loc = d.locale || undefined;
    const hour12 = d.timeFormat !== '24h';
    // 'YYYY-MM-DD' (all-day) must be read as a local date, not UTC.
    const toDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v));
    return {
      toDate,
      time: (v, tz) => toDate(v).toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', hour12, timeZone: tz || undefined }),
      weekday: (v, style = 'long') => toDate(v).toLocaleDateString(loc, { weekday: style }),
      dateLong: (v, tz) => toDate(v).toLocaleDateString(loc, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz || undefined }),
      dateShort: (v) => toDate(v).toLocaleDateString(loc, { month: 'short', day: 'numeric' }),
      dayKey: (v) => {
        const x = toDate(v);
        return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      },
      hour12,
    };
  }

  async function getJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function loadClient(type) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `/widget-client/${encodeURIComponent(type)}.js?v=${rev}`;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.append(s);
    });
  }

  async function refresh(c) {
    try {
      const data = c.w.clientOnly ? {} : await getJson(`/api/widgets/${encodeURIComponent(c.w.id)}/data`);
      c.def.render(c.body, data, c.ctx);
      c.loaded = true;
      c.card.classList.toggle('stale', !!data._stale);
    } catch (e) {
      if (!c.loaded) c.body.replaceChildren(h('div', { class: 'msg' }, e.message));
      else c.card.classList.add('stale');
    }
  }

  async function buildCard(w, slot) {
    if (!registry[w.type] && !(await loadClient(w.type) && registry[w.type])) {
      return { card: h('section', { class: `card ${slot}` }, h('div', { class: 'msg' }, `Widget "${w.type}" has no client script.`)), w, def: null, start() {} };
    }
    const def = registry[w.type];
    const body = h('div', { class: 'card-body' });
    const card = h('section', { class: `card card-${w.type} ${slot}` }, def.chrome === false ? null : h('h2', { class: 'card-title' }, def.title || w.name), body);
    const c = { w, def, card, body, loaded: false, ctx: { id: w.id, options: w.options || {}, display, slot, fmt: makeFmt(display), h } };
    // Called once the card is attached to the page (widgets such as the clock check el.isConnected).
    c.start = () => {
      refresh(c);
      if (!w.clientOnly) timers.push(setInterval(() => refresh(c), Math.max(15, w.refreshSec || 300) * 1000));
    };
    return c;
  }

  function startRotation(slides) {
    const dots = document.getElementById('dots');
    dots.replaceChildren(...slides.map(() => h('i')));
    let i = 0;
    const show = (n) => {
      slides.forEach((s, k) => s.card.classList.toggle('active', k === n));
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === n));
    };
    const dur = (k) => Math.max(5, Number(slides[k].w.options.durationSec) || display.rotateSeconds || 20) * 1000;
    show(0);
    if (slides.length < 2) {
      dots.replaceChildren();
      return;
    }
    const next = () => {
      i = (i + 1) % slides.length;
      show(i);
      timers.push(setTimeout(next, dur(i)));
    };
    timers.push(setTimeout(next, dur(0)));
  }

  function applyLayout() {
    const root = document.getElementById('root');
    const rot = Number(display.rotation) || 0;
    root.className = [rot ? `rot${rot}` : '', display.background === 'photos' ? 'photos' : ''].join(' ').trim();
    const w = root.clientWidth;
    const hgt = root.clientHeight;
    document.getElementById('layout').classList.toggle('portrait', hgt > w * 1.05);
  }

  async function initBackground() {
    if (display.background !== 'photos') return;
    let list = [];
    try { list = await getJson('/api/backgrounds'); } catch { /* none */ }
    if (!list.length) return;
    const layers = [...document.querySelectorAll('.bg-layer')];
    let idx = Math.floor(Math.random() * list.length);
    let front = 0;
    const swap = () => {
      const img = new Image();
      img.onload = () => {
        const back = layers[1 - front];
        back.style.backgroundImage = `url("${list[idx]}")`;
        back.classList.add('on');
        layers[front].classList.remove('on');
        front = 1 - front;
        idx = (idx + 1) % list.length;
      };
      img.src = list[idx];
    };
    swap();
    if (list.length > 1) timers.push(setInterval(swap, Math.max(10, display.photoSeconds || 60) * 1000));
  }

  function initNightMode() {
    const el = document.getElementById('night');
    if (!display.nightMode && !display.nightTheme) return;
    let themeShown = display.theme;
    const tick = () => {
      const hr = new Date().getHours();
      const s = Number(display.nightStart);
      const e = Number(display.nightEnd);
      const night = s > e ? hr >= s || hr < e : hr >= s && hr < e;
      if (display.nightMode) el.style.opacity = night ? String(1 - Math.min(Math.max(Number(display.nightDim), 0), 1)) : '0';
      const want = night && display.nightTheme ? display.nightTheme : display.theme;
      if (want !== themeShown) {
        themeShown = want;
        PIDASH_APPLY_THEME(display, { theme: want });
      }
    };
    tick();
    timers.push(setInterval(tick, 60000));
  }

  function liveReload() {
    const reload = () => setTimeout(() => location.reload(), 300);
    try {
      const es = new EventSource('/api/events');
      es.addEventListener('config', reload);
    } catch { /* fall through to polling */ }
    // Polling fallback + nightly refresh to keep Chromium's memory in check on small Pis.
    setInterval(async () => {
      try { if ((await getJson('/api/display')).rev !== rev) reload(); } catch { /* offline */ }
    }, 60000);
    const now = new Date();
    const four = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() >= 4 ? 1 : 0), 4, 0, 0);
    setTimeout(() => location.reload(), four - now);
  }

  async function boot() {
    let cfg;
    try {
      cfg = await getJson('/api/display');
    } catch (e) {
      document.getElementById('stage').append(h('div', { class: 'msg' }, `Waiting for server... (${e.message})`));
      return setTimeout(boot, 3000);
    }
    rev = cfg.rev;
    display = cfg.display;
    PIDASH_APPLY_THEME(display);
    document.title = display.title || 'PiDash';
    applyLayout();
    window.addEventListener('resize', applyLayout);

    const sidebar = document.getElementById('sidebar');
    const stage = document.getElementById('stage');
    const side = cfg.widgets.filter((w) => w.slot === 'sidebar');
    const rot = cfg.widgets.filter((w) => w.slot !== 'sidebar');
    if (!side.length) {
      sidebar.remove();
      document.getElementById('layout').style.gridTemplateColumns = '1fr';
    }

    for (const w of side) {
      const c = await buildCard(w, 'sidebar');
      sidebar.append(c.card);
      c.start();
    }
    const slides = [];
    for (const w of rot) {
      const c = await buildCard(w, 'rotate');
      stage.append(c.card);
      c.start();
      slides.push(c);
    }
    if (!side.length && !rot.length) stage.append(h('div', { class: 'msg' }, 'No widgets enabled. Open /admin on this device to add some.'));
    if (slides.length) startRotation(slides);

    initBackground();
    initNightMode();
    liveReload();
  }

  window.Dash = { register: (type, def) => { registry[type] = def; }, h, getJson };
  boot();
})();
