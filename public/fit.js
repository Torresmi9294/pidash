'use strict';
// Content fit: every size inside a widget is expressed through one CSS variable, --u (1rem by default).
// Setting --u on a widget's body scales ALL of its text, icons and spacing together, with real layout
// reflow. These helpers find the largest --u at which nothing in the widget is clipped, so widgets
// shrink to fit a small cell and (in "fill" mode) grow to use a big one.
//
// If a list-style widget still doesn't fit at a readable size, whole trailing items (elements marked
// data-fit-item) are hidden instead of being cut off mid-line, and a "+N more" note is shown.
(() => {
  const READABLE = 0.6;  // smallest scale we like; below this we first hide trailing list items
  const MIN = 0.35;      // absolute floor for widgets that can't be trimmed
  const FILL_MAX = 1.6;  // default upper limit when growing into spare room
  let mode = 'fill';     // 'fill' | 'shrink' | 'off'

  // Does this element hide some of its own content (overflow hidden/clip/auto with more inside)?
  function clipped(el) {
    // scroll/client sizes are rounded to whole pixels, so a strict comparison catches even 1px of hidden content
    if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
    const cs = getComputedStyle(el);
    return cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
  }

  function firstClipped(body) {
    if (clipped(body)) return body;
    for (const n of body.querySelectorAll('*')) if (clipped(n)) return n;
    return null;
  }

  const overflows = (body) => !!firstClipped(body);
  const apply = (el, s) => el.style.setProperty('--u', `calc(1rem * ${s})`);

  // Largest s in [min, max] with bad() false. Returns { s, ok } (ok=false: even min is too big).
  function search(set, bad, max, min) {
    set(max);
    if (!bad()) return { s: max, ok: true };
    set(min);
    if (bad()) return { s: min, ok: false };
    let lo = min;
    let hi = max;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      set(mid);
      if (bad()) hi = mid;
      else lo = mid;
    }
    set(lo);
    return { s: lo, ok: true };
  }

  const visible = (x) => x.style.display !== 'none';

  function restore(body) {
    for (const x of body.querySelectorAll('[data-fit-hidden]')) {
      x.style.removeProperty('display');
      x.removeAttribute('data-fit-hidden');
    }
    body.removeAttribute('data-fit-trim');
  }

  // Hide trailing items inside whichever element is clipping until nothing is clipped (keeps at least one).
  function trim(body) {
    let hidden = 0;
    for (let i = 0; i < 80; i++) {
      const bad = firstClipped(body);
      if (!bad) break;
      const items = [...bad.querySelectorAll('[data-fit-item]')].filter(visible);
      const total = [...body.querySelectorAll('[data-fit-item]')].filter(visible).length;
      if (!items.length || total <= 1) break;
      const last = items[items.length - 1];
      last.style.display = 'none';
      last.setAttribute('data-fit-hidden', '');
      hidden++;
      const group = last.closest('[data-fit-group]');
      if (group && ![...group.querySelectorAll('[data-fit-item]')].some(visible)) {
        group.style.display = 'none';
        group.setAttribute('data-fit-hidden', '');
      }
    }
    if (hidden) body.setAttribute('data-fit-trim', String(hidden));
    return hidden;
  }

  const ceiling = (opts) => (mode === 'shrink' ? 1 : Math.max(1, (opts && opts.max) || FILL_MAX));

  // One widget in its own cell (rotating stage, grid tile, pane).
  function card(body, opts) {
    restore(body);
    const floor = Math.min(Math.max((opts && opts.floor) || READABLE, MIN), 1);
    if (mode === 'off') { body.style.removeProperty('--u'); delete body.dataset.fit; return 1; }
    if (!body.isConnected || body.clientHeight <= 0 || body.clientWidth <= 0) return null;
    const set = (v) => apply(body, v);
    const bad = () => overflows(body);
    let r = search(set, bad, Math.max(ceiling(opts), floor), floor);
    if (!r.ok) {
      trim(body);                       // drop whole trailing items rather than cutting text mid-line
      if (bad()) r = search(set, bad, floor, MIN);
    }
    body.dataset.fit = (r.s).toFixed(2);
    return r.s;
  }

  // Widgets in the sidebar / top or bottom bar share one scale so they stay visually consistent and their
  // natural heights add up to what fits: the column must not overflow, a bar must stay under ~1/3 of the screen.
  function group(bodies, container, opts) {
    if (!bodies.length) return null;
    if (mode === 'off') { bodies.forEach((b) => b.style.removeProperty('--u')); return 1; }
    const o = opts || {};
    const bad = () => {
      if (o.horizontal) {
        if (container.offsetHeight > o.layoutEl.clientHeight * 0.32) return true;
      } else if (container.scrollHeight > container.clientHeight + 1) {
        return true;
      }
      return bodies.some(overflows);
    };
    const { s } = search((v) => bodies.forEach((b) => apply(b, v)), bad, ceiling(o), 0.45);
    bodies.forEach((b) => { b.dataset.fit = s.toFixed(2); });
    return s;
  }

  window.PidashFit = { card, group, overflows, setMode: (m) => { mode = ['fill', 'shrink', 'off'].includes(m) ? m : 'fill'; }, mode: () => mode };
})();
