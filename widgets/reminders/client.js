Dash.register('reminders', {
  title: 'Reminders',
  render(el, d, { h, fmt }) {
    if (!d.items.length) return el.replaceChildren(h('div', { class: 'msg' }, 'Nothing to do. 🎉'));
    const today = fmt.dayKey(new Date());
    el.replaceChildren(...d.items.map((r) => {
      let due = null;
      if (r.due) {
        const cls = r.due < today ? 'late' : r.due === today ? 'soon' : '';
        due = h('span', { class: `due ${cls}` }, r.due === today ? 'Today' : fmt.dateShort(r.due));
      }
      return h('div', { class: `rem ${r.done ? 'done' : ''}` }, h('span', { class: 'box' }), h('span', {}, r.text), due);
    }));
  },
});
