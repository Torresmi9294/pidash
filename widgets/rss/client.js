Dash.register('rss', {
  title: 'News',
  render(el, d, { h, options, slot }) {
    if (!d.items.length) return el.replaceChildren(h('div', { class: 'msg' }, 'No headlines.'));
    const thumbs = options.showThumbnails !== false;
    const hasImages = thumbs && d.items.some((i) => i.image);
    const featured = hasImages && d.layout === 'featured' && slot !== 'sidebar' && d.items[0].image;

    const ago = (iso) => {
      const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
      return !Number.isFinite(m) || m < 0 ? '' : m < 60 ? `${Math.max(m, 1)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
    };
    const meta = (i) => [i.source, ago(i.date)].filter(Boolean).join(' · ');

    // An image that fails to load simply disappears (the row keeps its layout).
    const thumb = (i) => {
      if (!hasImages) return null;
      if (!i.image) return h('div', { class: 'rss-thumb empty' }, '\u{1F4F0}');
      const img = h('img', { src: i.image, alt: '', loading: 'lazy' });
      const box = h('div', { class: 'rss-thumb' }, img);
      img.addEventListener('error', () => {
        box.classList.add('empty');
        box.replaceChildren('\u{1F4F0}');
      });
      return box;
    };

    const row = (i) => h('div', { 'data-fit-item': true, class: `rss ${hasImages ? 'with-thumb' : ''}` },
      thumb(i),
      h('div', { class: 'rss-body' }, h('div', { class: 'rss-title' }, i.title), i.summary ? h('div', { class: 'rss-sum' }, i.summary) : null, h('small', {}, meta(i))));

    const parts = [];
    if (featured) {
      const f = d.items[0];
      const img = h('img', { src: f.image, alt: '' });
      const hero = h('div', { class: 'rss-hero' }, img,
        h('div', { class: 'rss-hero-text' }, h('div', { class: 'rss-hero-title' }, f.title), f.summary ? h('div', { class: 'rss-sum' }, f.summary) : null, h('small', {}, meta(f))));
      img.addEventListener('error', () => img.remove());
      parts.push(hero, ...d.items.slice(1).map(row));
    } else {
      parts.push(...d.items.map(row));
    }
    el.replaceChildren(h('div', { class: `rss-wrap ${slot}` }, parts));
  },
});
