(() => {
  Dash.register('calendar', {
    title: 'Calendar',
    fitFloor: 0.8,
    render(el, d, ctx) {
      const paint = () => (d.view === 'month' ? month(el, d, ctx) : agenda(el, d, ctx));
      paint();
      // Re-evaluate NOW / NEXT / past once a minute without refetching.
      clearInterval(el._calTick);
      el._calTick = setInterval(() => (el.isConnected ? paint() : clearInterval(el._calTick)), 60000);
    },
  });

  // Google Calendar's look: timed events get a dot in the calendar's (or the event's) color, all-day events a filled bar.
  // Text on a bar is white or near-black, whichever reads better on that color.
  function ink(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '';
    const n = parseInt(m[1], 16);
    const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? '#202124' : '#ffffff';
  }
  const colored = (options, e) => options.useColors !== false && /^#[0-9a-f]{6}$/i.test(e.color || '');
  const dot = (h, e) => h('span', { class: 'cal-dot', style: `background:${e.color}` });
  const barStyle = (e) => `background:${e.color};color:${ink(e.color)}`;

  // "birthday, anniversary" -> matcher for pinned events
  function matcher(options) {
    const words = String(options.highlightWords || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    return (e) => words.some((w) => e.title.toLowerCase().includes(w));
  }

  function agenda(el, d, { h, fmt, options }) {
    if (!d.events.length) return el.replaceChildren(h('div', { class: 'msg' }, 'No upcoming events.'));
    const hi = options.highlight !== false;
    const pinned = matcher(options);
    const now = Date.now();
    const todayKey = fmt.dayKey(new Date());
    const tomorrowKey = fmt.dayKey(new Date(now + 86400000));
    const startMs = (e) => fmt.toDate(e.start).getTime();
    const endMs = (e) => fmt.toDate(e.end).getTime();
    const nextEvent = d.events.filter((e) => !e.allDay && startMs(e) > now).sort((a, b) => startMs(a) - startMs(b))[0];

    const groups = new Map();
    for (const e of d.events) {
      // Multi-day all-day events appear on each day (end is exclusive).
      const first = fmt.dayKey(e.start) < todayKey ? todayKey : fmt.dayKey(e.start);
      const lastKey = e.allDay ? fmt.dayKey(new Date(fmt.toDate(e.end) - 1)) : first;
      for (let k = first, n = 0; k <= lastKey && n < 14; n++) {
        (groups.get(k) || groups.set(k, []).get(k)).push(e);
        const nx = fmt.toDate(k);
        nx.setDate(nx.getDate() + 1);
        k = fmt.dayKey(nx);
      }
    }
    const label = (k) => (k === todayKey ? 'Today' : k === tomorrowKey ? 'Tomorrow' : fmt.dateLong(k));

    el.replaceChildren(...[...groups.keys()].sort().map((k) =>
      h('div', { class: 'cal-day', 'data-fit-group': true }, h('h3', {}, label(k)),
        groups.get(k).map((e) => {
          const isNow = hi && !e.allDay && startMs(e) <= now && now < endMs(e);
          const isNext = hi && e === nextEvent;
          const past = hi && !e.allDay && endMs(e) <= now;
          const pin = pinned(e);
          const cls = ['cal-ev', isNow && 'now', isNext && 'next', past && 'past', pin && 'pin', hi && e.allDay && 'allday'].filter(Boolean).join(' ');
          const tint = colored(options, e);
          const bar = tint && e.allDay; // all-day events are a filled bar, like Google Calendar
          return h('div', { class: cls, 'data-fit-item': true },
            h('div', { class: 'when' }, tint && !e.allDay ? dot(h, e) : null, e.allDay ? 'All day' : fmt.time(e.start)),
            h('div', {},
              h('div', { class: `title ${bar ? 'bar' : ''}`, style: bar ? barStyle(e) : null }, pin ? h('span', { class: 'star' }, '★ ') : null, e.title,
                isNow ? h('span', { class: 'badge-now' }, 'NOW') : isNext ? h('span', { class: 'badge-next' }, 'NEXT') : null),
              e.location ? h('div', { class: 'loc' }, e.location) : null));
        }))));
  }

  function month(el, d, { h, fmt, options }) {
    const hi = options.highlight !== false;
    const pinned = matcher(options);
    const start = fmt.toDate(d.rangeStart);
    const now = new Date();
    const cur = new Date(start.getTime() + 15 * 86400000).getMonth(); // a mid-grid day is always in the shown month
    const byDay = new Map();
    for (const e of d.events) {
      const first = fmt.toDate(e.start);
      const last = e.allDay ? new Date(fmt.toDate(e.end) - 1) : fmt.toDate(e.end);
      for (let x = new Date(first.getFullYear(), first.getMonth(), first.getDate()); x <= last; x.setDate(x.getDate() + 1)) {
        const k = fmt.dayKey(x);
        (byDay.get(k) || byDay.set(k, []).get(k)).push(e);
      }
    }
    const cells = [];
    for (let i = 0; i < 7; i++) {
      cells.push(h('div', { class: 'dow' }, fmt.weekday(new Date(2023, 0, 1 + i), 'short')));
    }
    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = fmt.dayKey(day);
      // Pinned events first so they are never hidden behind "+N more".
      const evs = (byDay.get(k) || []).slice().sort((a, b) => pinned(b) - pinned(a));
      const weekend = day.getDay() === 0 || day.getDay() === 6;
      cells.push(h('div', { class: `cell ${day.getMonth() !== cur ? 'other' : ''} ${k === fmt.dayKey(now) ? 'today' : ''} ${hi && weekend ? 'weekend' : ''} ${hi && evs.length ? 'busy' : ''}` },
        h('div', { class: 'n' }, day.getDate()),
        evs.slice(0, 2).map((e) => {
          const tint = colored(options, e);
          const bar = tint && (e.allDay || fmt.dayKey(e.start) !== fmt.dayKey(new Date(fmt.toDate(e.end) - 1))); // all-day and multi-day: a bar
          return h('div', { class: `e ${pinned(e) ? 'pin' : ''} ${tint ? (bar ? 'bar' : 'dotted') : ''}`, style: bar ? barStyle(e) : null },
            tint && !bar ? dot(h, e) : null, pinned(e) ? '★ ' : '', e.title);
        }),
        evs.length > 2 ? h('div', { class: 'e' }, `+${evs.length - 2} more`) : null));
    }
    el.replaceChildren(h('div', { class: 'month' }, cells));
  }
})();
