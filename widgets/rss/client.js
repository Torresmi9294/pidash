Dash.register('rss', {
  title: 'News',
  fitFloor: 0.85,                                  // keep headlines readable; drop trailing rows instead of shrinking
  fit: (o) => o.layout !== 'slideshow',            // the slideshow fills its cell by itself
  render(el, d, ctx) {
    clearInterval(el._rssTick);
    el.classList.remove('sh-host');
    if (!d.items.length) return el.replaceChildren(ctx.h('div', { class: 'msg' }, 'No headlines.'));
    return d.layout === 'slideshow' && ctx.slot !== 'sidebar' ? slideshow(el, d, ctx) : listView(el, d, ctx);
  },
});

function rssAgo(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return !Number.isFinite(m) || m < 0 ? '' : m < 60 ? `${Math.max(m, 1)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
const rssMeta = (i) => [i.source, rssAgo(i.date)].filter(Boolean).join(' · ');

// ---- list / featured top story + list -----------------------------------------------------------
function listView(el, d, { h, options, slot }) {
  const thumbs = options.showThumbnails !== false;
  const hasImages = thumbs && d.items.some((i) => i.image);
  const featured = hasImages && d.layout === 'featured' && slot !== 'sidebar' && d.items[0].image;

  // An image that fails to load simply becomes a placeholder (the row keeps its layout).
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

  // With a hero story the summary lives in the hero; the rows stay short so more of them fit.
  const row = (i) => h('div', { 'data-fit-item': true, class: `rss ${hasImages ? 'with-thumb' : ''}` },
    thumb(i),
    h('div', { class: 'rss-body' }, h('div', { class: 'rss-title' }, i.title), !featured && i.summary ? h('div', { class: 'rss-sum' }, i.summary) : null, h('small', {}, rssMeta(i))));

  const parts = [];
  if (featured) {
    const f = d.items[0];
    const img = h('img', { src: f.image, alt: '' });
    img.addEventListener('error', () => img.remove());
    parts.push(
      h('div', { class: 'rss-hero' }, img,
        h('div', { class: 'rss-hero-text' }, h('div', { class: 'rss-hero-title' }, f.title), f.summary ? h('div', { class: 'rss-sum' }, f.summary) : null, h('small', {}, rssMeta(f)))),
      ...d.items.slice(1).map(row));
  } else {
    parts.push(...d.items.map(row));
  }
  el.replaceChildren(h('div', { class: `rss-wrap ${slot}` }, parts));
}

// ---- featured stories slideshow: one big story at a time, like Sports Highlights ----------------
function slideshow(el, d, { h, options, slot }) {
  const withImages = d.items.filter((i) => i.image);
  const items = options.showThumbnails !== false && withImages.length ? withImages : d.items; // prefer stories that have a picture
  const perItem = Math.max(5, Number(options.itemSeconds) || 12);
  let i = Math.min(el._rssIndex || 0, items.length - 1);
  let elapsed = 0;

  el.classList.add('sh-host');
  const stage = h('div', { class: `sh ${slot}` });
  const bar = h('div', { class: 'sh-progress' }, h('i'));
  const dots = h('div', { class: 'sh-dots' }, items.map(() => h('i')));
  el.replaceChildren(stage, bar, dots);

  function show(n) {
    i = (n + items.length) % items.length;
    el._rssIndex = i;
    elapsed = 0;
    const it = items[i];
    const media = [];
    if (it.image) {
      const img = h('img', { class: 'sh-img', src: it.image, alt: '' });
      img.addEventListener('error', () => img.remove()); // falls back to the plain gradient
      media.push(img);
    }
    stage.replaceChildren(
      h('div', { class: `sh-media ${it.image ? '' : 'sh-noimg'}` }, media),
      h('div', { class: 'sh-text' },
        h('div', { class: 'sh-meta' }, h('span', { class: 'sh-league' }, it.source || 'News'), h('span', { class: 'muted' }, rssAgo(it.date))),
        h('div', { class: 'sh-head' }, it.title),
        it.summary && slot !== 'sidebar' ? h('div', { class: 'sh-desc' }, it.summary) : null));
    [...dots.children].forEach((x, k) => x.classList.toggle('on', k === i));
    bar.firstChild.style.width = '0%';
  }

  show(i);
  if (items.length < 2) { dots.replaceChildren(); return; }
  // 1-second ticker: only advances while this card is actually on screen (rotating stages hide inactive cards).
  el._rssTick = setInterval(() => {
    if (!el.isConnected) return clearInterval(el._rssTick);
    const card = el.closest('.card');
    const visible = !card || !card.classList.contains('rotate') || card.classList.contains('active');
    if (!visible) return;
    elapsed += 1;
    bar.firstChild.style.width = `${Math.min(100, (elapsed / perItem) * 100)}%`;
    if (elapsed >= perItem) show(i + 1);
  }, 1000);
}
