Dash.register('sports-highlights', {
  title: 'Sports Highlights',
  fit: false, // photo/video fills its cell by itself
  render(el, d, { h, options, slot }) {
    clearInterval(el._hlTick);
    if (!d.items.length) return el.replaceChildren(h('div', { class: 'msg' }, 'No highlights right now.'));

    const play = !!options.playVideo && slot !== 'sidebar';
    const perItem = Math.max(5, Number(options.itemSeconds) || 12);
    const ago = (iso) => {
      const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
      return !Number.isFinite(m) ? '' : m < 60 ? `${Math.max(m, 1)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
    };

    // Order: as the feed gives it, or shuffled. A shuffle plays every item once, then reshuffles (never starting the next
    // round with the item that just played). The shuffled order survives the periodic data refresh.
    const random = options.order === 'random' && d.items.length > 1;
    const shuffle = (list, avoidFirst) => {
      const a = list.slice();
      for (let k = a.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [a[k], a[j]] = [a[j], a[k]];
      }
      if (avoidFirst != null && a.length > 1 && a[0].id === avoidFirst) {
        const j = 1 + Math.floor(Math.random() * (a.length - 1));
        [a[0], a[j]] = [a[j], a[0]];
      }
      return a;
    };
    let items = d.items;
    if (random) {
      const byId = new Map(d.items.map((x) => [x.id, x]));
      const kept = (el._hlOrder || []).filter((id) => byId.has(id)).map((id) => byId.get(id));
      items = kept.concat(shuffle(d.items.filter((x) => !kept.includes(x))));
      el._hlOrder = items.map((x) => x.id);
    } else {
      el._hlOrder = null;
    }

    let i = Math.min(el._hlIndex || 0, items.length - 1);
    let elapsed = 0;
    let video = null;
    const stage = h('div', { class: `sh ${slot}` });
    const bar = h('div', { class: 'sh-progress' }, h('i'));
    const dots = h('div', { class: 'sh-dots' }, items.map(() => h('i')));
    el.replaceChildren(stage, bar, dots);
    // Optional: hide the timer (progress bar) and/or the dots. The slides still rotate; the picture grows into the space.
    if (options.showTimer === false) bar.style.display = 'none';
    if (options.showDots === false) dots.style.display = 'none';

    function show(n) {
      if (random && n >= items.length) { // the round is over: shuffle again
        items = shuffle(items, items[items.length - 1].id);
        el._hlOrder = items.map((x) => x.id);
      }
      i = (n + items.length) % items.length;
      el._hlIndex = i;
      elapsed = 0;
      video = null;
      const it = items[i];
      const media = [];
      if (it.image) media.push(h('img', { class: 'sh-img', src: it.image, alt: '', referrerpolicy: 'no-referrer' }));
      if (play && it.video) {
        video = h('video', { class: 'sh-video', src: it.video, poster: it.image || null, muted: true, playsinline: true, preload: 'auto' });
        video.muted = true;
        video.addEventListener('ended', () => show(i + 1));
        video.addEventListener('error', () => { video = null; }); // fall back to the thumbnail for the normal duration
        media.push(video);
      }
      stage.replaceChildren(
        h('div', { class: 'sh-media' }, media),
        h('div', { class: 'sh-text' },
          h('div', { class: 'sh-meta' }, h('span', { class: 'sh-league' }, it.league), it.type === 'video' ? h('span', { class: 'sh-tag' }, '▶ VIDEO') : null, h('span', { class: 'muted' }, ago(it.published))),
          h('div', { class: 'sh-head' }, it.headline),
          slot === 'sidebar' || !it.description ? null : h('div', { class: 'sh-desc' }, it.description)));
      [...dots.children].forEach((x, k) => x.classList.toggle('on', k === i));
    }

    show(i);
    // 1-second ticker: only advances (and plays video) while this card is actually on screen.
    el._hlTick = setInterval(() => {
      if (!el.isConnected) return clearInterval(el._hlTick);
      const card = el.closest('.card');
      const visible = !card || !card.classList.contains('rotate') || card.classList.contains('active');
      if (video) {
        if (visible && video.paused && !video.ended) video.play().catch(() => { video = null; });
        if (!visible && !video.paused) video.pause();
      }
      if (!visible) return;
      elapsed += 1;
      const limit = video ? 90 : perItem; // a playing clip advances itself when it ends
      bar.firstChild.style.width = `${Math.min(100, (elapsed / limit) * 100)}%`;
      if (elapsed >= limit) show(i + 1);
    }, 1000);
  },
});
