Dash.register('verse', {
  title: 'Verse of the Day',
  render(el, d, { h, slot }) {
    const n = d.text.length;
    const size = n > 380 ? 'xl' : n > 240 ? 'l' : n > 120 ? 'm' : 's';
    el.replaceChildren(
      h('div', { class: `verse v-${size} ${slot}` },
        h('div', { class: 'vq', 'data-fit-item': true, 'data-fit-silent': true }, '“'),
        h('p', { class: 'vt' }, d.text),
        h('div', { class: 'vr' }, d.reference, h('span', { class: 'vv' }, ` · ${d.version}`)),
        d.copyright ? h('small', { class: 'vc muted', 'data-fit-item': true, 'data-fit-silent': true }, d.copyright) : null));
  },
});
