// Runs in the browser. `data` is whatever server.js returned.
Dash.register('hello', {
  title: 'Hello',
  render(el, data, { h, fmt }) {
    el.replaceChildren(
      h('div', { class: 'msg', style: 'font-size:2rem;color:inherit' }, data.greeting),
      h('div', { class: 'muted' }, `Updated ${fmt.time(data.time)}`),
    );
  },
});
