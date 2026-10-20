'use strict';
// PiDash display runtime. Widgets register themselves with Dash.register(type, def):
//   def.render(el, data, ctx)  - draw `data` into `el` (replace its content)
//   def.chrome === false       - hide the card title bar
// ctx = { id, options, display, slot: 'sidebar'|'rotate', fmt, h }
(() => {
  const registry = {};
  const timers = [];
  const allCards = [];
  let display = null;
  let rev = null;

  // Native replaceChildren() writes the text "null" for a null argument and does not accept arrays.
  // Widgets (including your own) often pass conditional children, so make it forgiving.
  const nativeReplace = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function replaceChildren(...kids) {
    return nativeReplace.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false));
  };

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
      fitNow(c);
    } catch (e) {
      if (!c.loaded) {
        c.body.replaceChildren(h('div', { class: 'msg' }, e.message));
        fitNow(c);
      } else {
        c.card.classList.add('stale');
      }
    }
  }

  // ---- content fit (see fit.js) -------------------------------------------------------------
  // def.fit may be false, or a function of the widget's options (e.g. the news slideshow fills itself).
  const fitEnabled = (c) => !!c.def && fitModeOf(c) !== 'off' && (typeof c.def.fit === 'function' ? c.def.fit(c.w.options || {}) !== false : c.def.fit !== false);
  // Content fit is a per-widget setting (Fill / Shrink only / Off). Old installs had one global setting, so fall back to it.
  const FIT_MODES = ['fill', 'shrink', 'off'];
  const fitModeOf = (c) => {
    const own = c.w.options && c.w.options.contentFit;
    if (FIT_MODES.includes(own)) return own;
    return FIT_MODES.includes(display && display.contentFit) ? display.contentFit : 'fill';
  };
  const inSidebar = (c) => !!c.card.parentElement && c.card.parentElement.id === 'sidebar';
  let fitFrame = 0;
  const fitQueue = new Set();

  function fitSidebar() {
    const side = document.getElementById('sidebar');
    if (!side || !side.isConnected) return;
    const cards = allCards.filter((c) => inSidebar(c) && fitEnabled(c));
    const layoutEl = document.getElementById('layout');
    PidashFit.group(cards.map((c) => c.body), side, {
      horizontal: ['top', 'bottom'].includes(layoutEl.dataset.layout),
      layoutEl,
      mode: cards.some((c) => fitModeOf(c) === 'shrink') ? 'shrink' : 'fill', // the shared scale can't grow if any member is shrink-only
      max: cards.length ? Math.min(...cards.map((c) => c.def.fitMax || 1.6)) : 1.6,
    });
  }

  // Widgets that fill their cell themselves (the photo/video slideshows) are never fitted or scrolled.
  const selfFilling = (c) => (typeof c.def.fit === 'function' ? c.def.fit(c.w.options || {}) === false : c.def.fit === false);
  function fitNow(c) {
    if (!c.def) return;
    if (selfFilling(c)) { c.body.style.removeProperty('--u'); return; }
    if (inSidebar(c)) { // the side panel shares one scale and never scrolls
      if (fitModeOf(c) === 'off') c.body.style.removeProperty('--u'); else fitSidebar();
      return;
    }
    const o = c.w.options || {};
    PidashFit.card(c.body, { max: c.def.fitMax, floor: c.def.fitFloor, mode: fitModeOf(c), overflow: o.overflow, speed: o.scrollSpeed });
  }

  function fitSoon(c) {
    if (c) fitQueue.add(c); else allCards.forEach((x) => x.loaded && fitQueue.add(x));
    if (fitFrame) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      let sidebarDone = false;
      for (const x of fitQueue) {
        if (inSidebar(x)) { if (!sidebarDone) { sidebarDone = true; fitSidebar(); } } else fitNow(x);
      }
      fitQueue.clear();
    });
  }


  async function buildCard(w, slot, mode = '') {
    if (!registry[w.type] && !(await loadClient(w.type) && registry[w.type])) {
      return { card: h('section', { class: `card ${slot}` }, h('div', { class: 'msg' }, `Widget "${w.type}" has no client script.`)), w, def: null, start() {} };
    }
    const def = registry[w.type];
    const body = h('div', { class: 'card-body' });
    // Title bar: the widget's custom title if set, else its default (some widgets, like the clock, have none by default).
    const custom = String((w.options && w.options.title) || '').trim();
    const hideTitle = !!(w.options && w.options.hideTitle);
    const titleText = hideTitle ? '' : custom || (def.chrome === false ? '' : def.title || w.name);
    const titleEl = titleText ? h('h2', { class: 'card-title' }, titleText) : null;
    const card = h('section', { class: `card card-${w.type} ${mode === 'tile' ? `tile ${slot === 'sidebar' ? 'sidebar' : ''}` : mode === 'pane' ? `rotate ${slot === 'sidebar' ? 'sidebar' : ''}` : slot}` }, titleEl, body);
    const c = { w, def, card, body, loaded: false, ctx: { id: w.id, options: w.options || {}, display, slot, fmt: makeFmt(display), h } };
    allCards.push(c);
    // Called once the card is attached to the page (widgets such as the clock check el.isConnected).
    c.start = () => {
      refresh(c);
      // Re-fit whenever the widget redraws itself (clock ticks, calendar minute repaint, slides...).
      let t = 0;
      new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => fitSoon(c), 600); }).observe(body, { childList: true, subtree: true, characterData: true });
      if (!w.clientOnly) timers.push(setInterval(() => refresh(c), Math.max(15, w.refreshSec || 300) * 1000));
    };
    return c;
  }

  function startRotation(slides, dots = document.getElementById('dots'), paneSeconds = 0) {
    dots.replaceChildren(...slides.map(() => h('i')));
    let i = 0;
    const show = (n) => {
      slides.forEach((s, k) => s.card.classList.toggle('active', k === n));
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === n));
    };
    const dur = (k) => Math.max(5, Number(slides[k].w.options.durationSec) || Number(paneSeconds) || display.rotateSeconds || 20) * 1000;
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

  let gridCount = 0;

  function applyLayout() {
    const root = document.getElementById('root');
    const rot = Number(display.rotation) || 0;
    root.className = [rot ? `rot${rot}` : '', display.background === 'photos' ? 'photos' : ''].join(' ').trim();
    const w = root.clientWidth;
    const hgt = root.clientHeight;
    const portrait = hgt > w * 1.05;
    const layoutEl = document.getElementById('layout');
    layoutEl.classList.toggle('portrait', portrait);
    // Side-by-side layouts become a top bar on portrait screens.
    let name = PIDASH_LAYOUTS[display.layout] ? display.layout : 'sidebar-left';
    if (portrait && (name === 'sidebar-left' || name === 'sidebar-right')) name = 'top';
    layoutEl.dataset.layout = name;
    if (name === 'grid' || name === 'grid-rotate') {
      const pref = Number(display.gridColumns);
      let cols = pref >= 1 ? pref : gridCount <= 1 ? 1 : gridCount <= 4 ? 2 : 3;
      if (portrait) cols = Math.min(cols, 2);
      layoutEl.style.setProperty('--cols', String(cols));
      layoutEl.dataset.cols = String(cols);
      // panes can't be wider than the grid: clamp their column span (in half-cells) to what exists
      layoutEl.querySelectorAll('.pane').forEach((p) => p.style.setProperty('--cs', String(Math.min(Number(p.dataset.cs) || 2, cols * 2))));
      document.documentElement.style.setProperty('--gscale', gridCount >= 7 ? '0.72' : gridCount >= 5 ? '0.82' : gridCount >= 3 ? '0.92' : '1');
    }
    document.documentElement.dataset.lay = name;
  }

  async function initBackground() {
    if (display.background !== 'photos') return;
    let list = [];
    try { list = await getJson('/api/backgrounds'); } catch { /* none */ }
    if (!list.length) return;
    const layers = [...document.querySelectorAll('.bg-layer')];
    if (display.photoOrder !== 'name') {
      for (let k = list.length - 1; k > 0; k--) { // shuffle (Fisher-Yates)
        const j = Math.floor(Math.random() * (k + 1));
        [list[k], list[j]] = [list[j], list[k]];
      }
    } // else: the server already sends them sorted by name
    let idx = 0;
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
    // The ticker also re-evaluates a random (hourly/daily) or seasonal theme as time passes, without a reload.
    if (!display.nightMode && !display.nightTheme && (display.themeMode || 'fixed') === 'fixed') return;
    let themeShown = PIDASH_RESOLVE_THEME(display);
    const tick = () => {
      const hr = new Date().getHours();
      const s = Number(display.nightStart);
      const e = Number(display.nightEnd);
      const night = s > e ? hr >= s || hr < e : hr >= s && hr < e;
      if (display.nightMode) el.style.opacity = night ? String(1 - Math.min(Math.max(Number(display.nightDim), 0), 1)) : '0';
      const want = night && display.nightTheme ? display.nightTheme : PIDASH_RESOLVE_THEME(display);
      if (want !== themeShown) {
        themeShown = want;
        PIDASH_APPLY_THEME(display, { theme: want });
      }
    };
    tick();
    timers.push(setInterval(tick, 60000));
  }

  // ---- sleep schedule (Admin > Schedule) -----------------------------------------------------------------------
  // While asleep the screen goes black (or very dim, or shows a dim clock). Touching it wakes the display for a while.
  function initSleep() {
    const sch = PidashSchedule.sanitize(display.schedule);
    if (!sch.enabled && !sch.override) return; // nothing can put it to sleep (a changed setting reloads the page)
    const fmt = makeFmt(display);
    const el = document.getElementById('sleep');
    const timeEl = el.querySelector('.sleep-time');
    const dateEl = el.querySelector('.sleep-date');
    let awakeUntil = 0; // touch-to-wake: awake until this moment even though the schedule says sleep
    let shown = null;
    const tick = () => {
      const asleep = PidashSchedule.status(sch, new Date()).asleep && Date.now() >= awakeUntil;
      if (asleep !== shown) {
        shown = asleep;
        if (asleep) document.documentElement.dataset.sleep = sch.mode;
        else delete document.documentElement.dataset.sleep;
      }
      if (asleep && sch.mode === 'clock') {
        const now = new Date();
        timeEl.textContent = fmt.time(now);
        dateEl.textContent = fmt.dateLong(now);
      }
    };
    const wake = () => {
      if (!sch.touchWake || shown !== true) return;
      awakeUntil = Date.now() + sch.touchMinutes * 60000;
      tick();
    };
    el.addEventListener('pointerdown', wake);
    document.addEventListener('keydown', wake);
    tick();
    timers.push(setInterval(tick, 15000));
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
    PIDASH_APPLY_THEME(display, { theme: PIDASH_RESOLVE_THEME(display) }); // fixed, random or seasonal
    PIDASH_APPLY_LAYOUT(display);
    PidashFit.setMode(display.contentFit);
    document.title = display.title || 'PiDash';
    initSleep();
    applyLayout();
    window.addEventListener('resize', applyLayout);
    let resizeT = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => fitSoon(), 250); });
    // Late-arriving fonts/images can change sizes slightly: re-fit shortly after startup.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitSoon());
    setTimeout(() => fitSoon(), 2000);
    setTimeout(() => fitSoon(), 7000);

    const sidebar = document.getElementById('sidebar');
    const stage = document.getElementById('stage');
    const layoutEl = document.getElementById('layout');
    const layoutName = PIDASH_LAYOUTS[display.layout] ? display.layout : 'sidebar-left';
    let side = cfg.widgets.filter((w) => w.slot === 'sidebar');
    let rot = cfg.widgets.filter((w) => w.slot !== 'sidebar');

    if (layoutName === 'grid-rotate') {
      // A grid of panes; each pane rotates through the widgets chosen for it in the admin.
      sidebar.remove();
      stage.remove();
      const byId = new Map(cfg.widgets.map((w) => [w.id, w]));
      const configured = Array.isArray(display.gridPanes) && display.gridPanes.length ? display.gridPanes : PIDASH_SUGGEST_PANES(cfg.widgets);
      const panes = configured
        .map((p) => ({ ...p, list: (p.widgets || []).map((id) => byId.get(id)).filter(Boolean) }))
        .filter((p) => p.list.length);
      gridCount = panes.reduce((n, p) => n + ((PIDASH_PANE_SIZES[p.size] || PIDASH_PANE_SIZES.s).cols * (PIDASH_PANE_SIZES[p.size] || PIDASH_PANE_SIZES.s).rows), 0);
      applyLayout();
      if (!panes.length) layoutEl.append(h('div', { class: 'msg' }, 'No panes configured. Open /admin on this device (Display > Layout) to set up the grid.'));
      for (const p of panes) {
        const sz = PIDASH_PANE_SIZES[p.size] || PIDASH_PANE_SIZES.s;
        const paneEl = h('div', { class: 'pane', 'data-cs': Math.round(sz.cols * 2), 'data-rs': Math.round(sz.rows * 2) });
        paneEl.style.setProperty('--cs', String(Math.round(sz.cols * 2)));
        paneEl.style.setProperty('--rs', String(Math.round(sz.rows * 2)));
        layoutEl.append(paneEl);
        const slides = [];
        for (const w of p.list) {
          const c = await buildCard(w, w.slot === 'sidebar' ? 'sidebar' : 'rotate', 'pane');
          paneEl.append(c.card);
          c.start();
          slides.push(c);
        }
        if (slides.length > 1) {
          const dots = h('div', { class: 'pane-dots' });
          paneEl.append(dots);
          startRotation(slides, dots, p.seconds);
        } else {
          slides[0].card.classList.add('active');
        }
      }
      applyLayout(); // now that the panes exist, clamp their widths to the number of columns
      document.getElementById('dots').replaceChildren();
      initBackground();
      initNightMode();
      liveReload();
      return;
    }

    if (layoutName === 'grid') {
      // Everything on screen at once: no sidebar/stage, no rotation.
      sidebar.remove();
      stage.remove();
      const all = [...side, ...rot];
      gridCount = all.length;
      applyLayout();
      if (!all.length) layoutEl.append(h('div', { class: 'msg' }, 'No widgets enabled. Open /admin on this device to add some.'));
      for (const w of all) {
        const c = await buildCard(w, w.slot === 'sidebar' ? 'sidebar' : 'rotate', 'tile');
        layoutEl.append(c.card);
        c.start();
      }
      document.getElementById('dots').replaceChildren();
      initBackground();
      initNightMode();
      liveReload();
      return;
    }

    if (layoutName === 'focus') {
      rot = [...side, ...rot]; // one widget at a time: the clock and weather rotate too
      side = [];
    }
    if (!side.length) {
      sidebar.remove();
      layoutEl.dataset.nosidebar = '';
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
