Dash.register('rss', {
  title: 'News',
  render(el, d, { h }) {
    if (!d.items.length) return el.replaceChildren(h('div', { class: 'msg' }, 'No headlines.'));
    el.replaceChildren(...d.items.map((i) => h('div', { class: 'rss' }, i.title, h('small', {}, i.source))));
  },
});
