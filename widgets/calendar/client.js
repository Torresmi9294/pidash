(() => {
  Dash.register('calendar', {
    title: 'Calendar',
    render(el, d, ctx) {
      return d.view === 'month' ? month(el, d, ctx) : agenda(el, d, ctx);
    },
  });

  function agenda(el, d, { h, fmt }) {
    if (!d.events.length) return el.replaceChildren(h('div', { class: 'msg' }, 'No upcoming events.'));
    const todayKey = fmt.dayKey(new Date());
    const tomorrowKey = fmt.dayKey(new Date(Date.now() + 86400000));
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
      h('div', { class: 'cal-day' }, h('h3', {}, label(k)),
        groups.get(k).map((e) =>
          h('div', { class: 'cal-ev' },
            h('div', { class: 'when' }, e.allDay ? 'All day' : fmt.time(e.start)),
            h('div', {}, h('div', { class: 'title' }, e.title), e.location ? h('div', { class: 'loc' }, e.location) : null))))));
  }

  function month(el, d, { h, fmt }) {
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
      const evs = byDay.get(k) || [];
      cells.push(h('div', { class: `cell ${day.getMonth() !== cur ? 'other' : ''} ${k === fmt.dayKey(now) ? 'today' : ''}` },
        h('div', { class: 'n' }, day.getDate()),
        evs.slice(0, 2).map((e) => h('div', { class: 'e' }, e.title)),
        evs.length > 2 ? h('div', { class: 'e' }, `+${evs.length - 2} more`) : null));
    }
    el.replaceChildren(h('div', { class: 'month' }, cells));
  }
})();
