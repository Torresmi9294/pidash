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

  const MEDIA = /^(IMG|VIDEO|CANVAS|SVG|PICTURE)$/i;

  // Does this element hide some of its own content (overflow hidden/clip/auto with more inside)?
  function clipped(el) {
    // scroll/client sizes are rounded to whole pixels, so a strict comparison catches even 1px of hidden content
    if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
    // A frame that only holds pictures crops them on purpose (object-fit: cover), or opts out explicitly.
    if (el.hasAttribute && el.hasAttribute('data-fit-ignore')) return false;
    const kids = el.children;
    if (kids && kids.length && Array.prototype.every.call(kids, (k) => MEDIA.test(k.tagName || ''))) return false;
    const cs = getComputedStyle(el);
    return cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
  }

  // A scale-independent quirk (e.g. a frame whose picture is a few px too tall) overflows by a sliver; content that
  // truly doesn't fit overflows by a lot. Only slivers may be ignored.
  const sliver = (n) => {
    const amount = Math.max(n.scrollHeight - n.clientHeight, n.scrollWidth - n.clientWidth);
    return amount <= 8 && amount <= 0.2 * Math.max(n.clientHeight, n.clientWidth);
  };

  // Overlay blocks (marked data-fit-bounds) must lie inside their parent frame. Browsers only report overflow towards
  // the bottom/right, so text pushed out of the top/left of a frame would otherwise go unnoticed.
  function outOfBounds(el) {
    const parent = el.parentElement;
    if (!parent) return false;
    const a = el.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    return a.top < p.top - 1 || a.left < p.left - 1 || a.bottom > p.bottom + 1 || a.right > p.right + 1;
  }

  // `ignore` = elements known to clip at every scale (scale-independent quirks); they don't count.
  function firstClipped(body, ignore) {
    if (!(ignore && ignore.has(body)) && clipped(body)) return body;
    for (const n of body.querySelectorAll('*')) if (!(ignore && ignore.has(n)) && clipped(n)) return n;
    for (const n of body.querySelectorAll('[data-fit-bounds]')) if (!(ignore && ignore.has(n)) && outOfBounds(n)) return n;
    return null;
  }

  const overflows = (body, ignore) => !!firstClipped(body, ignore);
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

  function hideItem(x) {
    x.style.display = 'none';
    x.setAttribute('data-fit-hidden', '');
  }

  function restore(body) {
    for (const x of body.querySelectorAll('[data-fit-hidden]')) {
      x.style.removeProperty('display');
      x.removeAttribute('data-fit-hidden');
    }
    body.removeAttribute('data-fit-trim');
  }

  // Hide trailing items inside whichever element is clipping until nothing is clipped (keeps at least one).
  function trim(body, ignore) {
    let hidden = 0;   // list entries hidden (these get a "+N more" note)
    let steps = 0;
    for (let i = 0; i < 80; i++) {
      const bad = firstClipped(body, ignore);
      if (!bad) break;
      const items = [...bad.querySelectorAll('[data-fit-item]')].filter(visible);
      const total = [...body.querySelectorAll('[data-fit-item]')].filter(visible).length;
      if (!items.length || total <= 1) break;
      const last = items[items.length - 1];
      hideItem(last);
      steps++;
      if (!(last.hasAttribute && last.hasAttribute('data-fit-silent'))) hidden++; // optional extras (forecast, chart...) are dropped quietly
      const group = items[items.length - 1].closest('[data-fit-group]');
      if (group && ![...group.querySelectorAll('[data-fit-item]')].some(visible)) hideItem(group);
    }
    if (hidden) body.setAttribute('data-fit-trim', String(hidden));
    return steps;
  }

  // Elements that are STILL clipped at the smallest size with only one list item showing: shrinking can't
  // fix those (e.g. a frame whose picture is a little taller than it), so they must not drive the scale.
  function persistent(body, set) {
    const items = [...body.querySelectorAll('[data-fit-item]')];
    items.slice(1).forEach(hideItem);
    set(MIN);
    const out = new Set();
    for (const n of body.querySelectorAll('*')) if (clipped(n) && sliver(n)) out.add(n); // never the widget body itself
    restore(body);
    return out;
  }

  const ceiling = (opts) => (mode === 'shrink' ? 1 : Math.max(1, (opts && opts.max) || FILL_MAX));

  // One widget in its own cell (rotating stage, grid tile, pane).
  function card(body, opts) {
    restore(body);
    const floor = Math.min(Math.max((opts && opts.floor) || READABLE, MIN), 1);
    if (mode === 'off') { body.style.removeProperty('--u'); delete body.dataset.fit; return 1; }
    if (!body.isConnected || body.clientHeight <= 0 || body.clientWidth <= 0) return null;
    const set = (v) => apply(body, v);
    const top = Math.max(ceiling(opts), floor);
    let ignore = null;
    const bad = () => overflows(body, ignore);

    let r = search(set, bad, top, floor);
    if (!r.ok) {
      trim(body, ignore);               // drop whole trailing items rather than cutting text mid-line
      // With the extras gone there is usually room again: shrink further if still needed, else GROW back up
      // as far as the trimmed content allows (so a short pane gets big text, not minimum-size text).
      r = bad() ? search(set, bad, floor, MIN) : search(set, bad, top, floor);
    }
    if (!r.ok) {
      // Still clipped at the smallest size: if some element clips at EVERY scale it is a quirk, not too much
      // content. Ignore just those elements and fit against everything else, rather than collapsing to the floor.
      restore(body);
      ignore = persistent(body, set);
      if (ignore.size) {
        r = search(set, bad, top, floor);
        if (!r.ok) {
          trim(body, ignore);
          r = bad() ? search(set, bad, floor, MIN) : search(set, bad, top, floor);
        }
      }
    }
    body.dataset.fit = r.s.toFixed(2);
    return r.s;
  }

  // Widgets in the sidebar / top or bottom bar share one scale so they stay visually consistent and their
  // natural heights add up to what fits: the column must not overflow, a bar must stay under ~1/3 of the screen.
  function group(bodies, container, opts) {
    if (!bodies.length) return null;
    if (mode === 'off') { bodies.forEach((b) => b.style.removeProperty('--u')); return 1; }
    const o = opts || {};
    let ignore = null;
    const bad = () => {
      if (o.horizontal) {
        if (container.offsetHeight > o.layoutEl.clientHeight * 0.32) return true;
      } else if (container.scrollHeight > container.clientHeight + 1) {
        return true;
      }
      return bodies.some((b) => overflows(b, ignore));
    };
    const set = (v) => bodies.forEach((b) => apply(b, v));
    let r = search(set, bad, ceiling(o), 0.45);
    if (!r.ok) {
      set(MIN);
      ignore = new Set();
      for (const b of bodies) for (const n of b.querySelectorAll('*')) if (clipped(n) && sliver(n)) ignore.add(n);
      if (ignore.size) r = search(set, bad, ceiling(o), 0.45);
    }
    bodies.forEach((b) => { b.dataset.fit = r.s.toFixed(2); });
    return r.s;
  }

  window.PidashFit = { card, group, overflows, setMode: (m) => { mode = ['fill', 'shrink', 'off'].includes(m) ? m : 'fill'; }, mode: () => mode };
})();
