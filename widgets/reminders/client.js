Dash.register('reminders', {
  title: 'Reminders',
  fitFloor: 0.8,
  render(el, d, { h, fmt, options }) {
    const hi = options.highlight !== false;
    if (!d.items.length) return el.replaceChildren(h('div', { class: 'msg' }, 'Nothing to do. 🎉'));
    const today = fmt.dayKey(new Date());
    el.replaceChildren(...d.items.map((r) => {
      let due = null;
      if (r.due) {
        const cls = r.due < today ? 'late' : r.due === today ? 'soon' : '';
        due = h('span', { class: `due ${cls}` }, r.due === today ? 'Today' : r.due < today && hi && !r.done ? `Overdue \u00B7 ${fmt.dateShort(r.due)}` : fmt.dateShort(r.due));
      }
      const status = r.done ? '' : r.due && r.due < today ? 'late' : r.due === today ? 'soon' : '';
      return h('div', { 'data-fit-item': true, class: `rem ${r.done ? 'done' : ''} ${hi && status ? `row-${status}` : ''} ${r.starred ? 'starred' : ''}` },
        h('span', { class: 'box' }), r.starred ? h('span', { class: 'star' }, '\u2605') : null, h('span', {}, r.text), due);
    }));
  },
});
