(() => {
  // Team logo (served from this server's cache); falls back to a colored initials badge.
  function logo(h, t, size) {
    const initials = String(t.abbr || t.short || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?';
    let hue = 0;
    for (const c of String(t.name)) hue = (hue * 31 + c.charCodeAt(0)) % 360;
    const badge = h('span', { class: `sb-logo badge ${size || ''}`, style: `background:${t.color || `hsl(${hue},55%,38%)`}` }, initials);
    if (!t.logo) return badge;
    const img = h('img', { class: `sb-logo ${size || ''}`, src: t.logo, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(badge));
    return img;
  }

  const VIEWS = ['cards', 'list', 'slideshow', 'ticker'];
  const TICKER_PPS = { slow: 30, medium: 60, fast: 110 }; // pixels per second

  Dash.register('scoreboard', {
    title: 'Scoreboard',
    fitFloor: 0.75,
    render(el, d, { h, fmt, options, slot }) {
      clearInterval(el._sbTick);
      const view = VIEWS.includes(options.view) ? options.view : 'cards';
      const showLogos = options.showLogos !== false;
      const showRecords = options.showRecords !== false;
      const compact = slot === 'sidebar';

      const when = (g) => {
        if (!g.start) return '';
        const sameDay = fmt.dayKey(g.start) === fmt.dayKey(new Date());
        return sameDay ? fmt.time(g.start) : `${fmt.weekday(g.start, 'short')} ${fmt.time(g.start)}`;
      };

      if (!d.games.length) {
        const next = d.next ? ` Next: ${d.next.label}, ${when(d.next)}.` : '';
        return el.replaceChildren(h('div', { class: 'msg' }, d.show === 'live' ? `No live games right now.${next}` : 'No games to show.'));
      }

      // One line of status text for a game: "LIVE 5:21 - 3rd", "Final", or the start time.
      const statusNodes = (g) => (g.state === 'in'
        ? [h('span', { class: 'sb-live' }, 'LIVE'), h('span', {}, g.status)]
        : g.state === 'post' ? [h('span', {}, g.status || 'Final')] : [h('span', {}, when(g))]);

      const nameNodes = (s, short) => [
        s.rank ? h('small', { class: 'sb-rank' }, s.rank) : null,
        s.fav ? h('span', { class: 'sb-star', title: 'My team' }, '★') : null,
        `${s.fav ? ' ' : ''}${short ? s.abbr || s.short : s.short}`, // no-break space keeps the star glued to the name
      ];

      // ---- cards: a grid of game cards (the original view) ------------------------------------------------
      const row = (s, other, g) => {
        const lose = g.state === 'post' && other.score != null && s.score != null && s.score < other.score;
        const lead = g.state === 'in' && other.score != null && s.score != null && s.score > other.score;
        return h('div', { class: `sb-team ${s.winner ? 'win' : ''} ${lose ? 'lose' : ''} ${lead ? 'lead' : ''} ${s.fav ? 'fav' : ''}` },
          showLogos ? logo(h, s) : null,
          h('span', { class: 'sb-name' }, nameNodes(s, compact),
            showRecords && s.record && !compact ? h('small', { class: 'sb-rec' }, s.record) : null),
          s.hasBall ? h('span', { class: 'sb-ball', title: 'Has the ball' }, '◆') : null,
          h('span', { class: 'sb-score' }, s.score == null ? '' : s.score));
      };

      const card = (g) => {
        const foot = g.state === 'in'
          ? [h('span', { class: 'sb-live' }, 'LIVE'), h('span', {}, g.status), g.situation ? h('span', { class: 'muted' }, g.situation) : null]
          : g.state === 'post'
            ? [h('span', {}, g.status || 'Final')]
            : [h('span', {}, when(g)), g.broadcast && !compact ? h('span', { class: 'muted' }, g.broadcast) : null];
        return h('div', { class: `sb-game ${g.state} ${g.fav ? 'fav' : ''}`, 'data-fit-item': true },
          d.multi ? h('div', { class: 'sb-league' }, g.league) : null,
          row(g.away, g.home, g),
          row(g.home, g.away, g),
          h('div', { class: 'sb-foot' }, foot));
      };

      // ---- list: one dense line per game ------------------------------------------------------------------
      const listSide = (s, other, g, side) => {
        const lead = g.state !== 'pre' && other.score != null && s.score != null && s.score > other.score;
        return h('span', { class: `sb-ls ${side} ${s.winner || lead ? 'lead' : ''} ${g.state === 'post' && !s.winner ? 'lose' : ''}` },
          ...(side === 'a'
            ? [showLogos ? logo(h, s, 'sm') : null, h('span', { class: 'sb-name' }, nameNodes(s, true)), h('span', { class: 'sb-score' }, s.score == null ? '' : s.score)]
            : [h('span', { class: 'sb-score' }, s.score == null ? '' : s.score), h('span', { class: 'sb-name' }, nameNodes(s, true)), showLogos ? logo(h, s, 'sm') : null]));
      };
      const listRow = (g) => h('div', { class: `sb-lrow ${g.state} ${g.fav ? 'fav' : ''}`, 'data-fit-item': true },
        h('span', { class: 'sb-lstatus' }, statusNodes(g)),
        listSide(g.away, g.home, g, 'a'),
        h('span', { class: 'sb-lat' }, g.state === 'pre' ? '@' : '–'),
        listSide(g.home, g.away, g, 'h'));

      // ---- slideshow: one big game at a time; only live games while any game is live ---------------------
      const slideTeam = (s, other, g) => {
        const lead = g.state !== 'pre' && other.score != null && s.score != null && s.score > other.score;
        return h('div', { class: `sb-st ${s.winner || lead ? 'lead' : ''} ${g.state === 'post' && !s.winner ? 'lose' : ''}` },
          showLogos ? logo(h, s, 'xl') : null,
          h('div', { class: 'sb-stn' }, nameNodes(s, false)),
          showRecords && s.record ? h('small', { class: 'sb-rec' }, s.record) : null);
      };
      const slide = (g) => h('div', { class: `sb-slide ${g.state} ${g.fav ? 'fav' : ''}` },
        d.multi ? h('div', { class: 'sb-league' }, g.league) : null,
        h('div', { class: 'sb-sgrid' },
          slideTeam(g.away, g.home, g),
          h('div', { class: 'sb-mid' },
            h('div', { class: 'sb-sscore' }, h('span', {}, g.away.score == null ? '' : g.away.score), h('i', {}, g.state === 'pre' ? '@' : '–'), h('span', {}, g.home.score == null ? '' : g.home.score)),
            h('div', { class: 'sb-sstat' }, statusNodes(g))),
          slideTeam(g.home, g.away, g)),
        h('div', { class: 'sb-sfoot' },
          g.situation ? h('span', {}, g.situation) : null,
          g.broadcast && !compact ? h('span', { class: 'muted' }, g.broadcast) : null,
          g.venue && !compact ? h('span', { class: 'muted' }, g.venue) : null));

      // ---- ticker: a scrolling strip --------------------------------------------------------------------
      const chip = (g, dup) => h('span', { class: `sb-chip ${g.state} ${g.fav ? 'fav' : ''} ${dup ? 'dup' : ''}` },
        g.state === 'in' ? h('span', { class: 'sb-live' }) : null,
        showLogos ? logo(h, g.away, 'sm') : null,
        h('b', {}, g.away.abbr || g.away.short), h('span', { class: 'sb-cs' }, g.away.score == null ? '' : g.away.score),
        h('i', {}, g.state === 'pre' ? '@' : '–'),
        h('span', { class: 'sb-cs' }, g.home.score == null ? '' : g.home.score), h('b', {}, g.home.abbr || g.home.short),
        showLogos ? logo(h, g.home, 'sm') : null,
        h('small', { class: 'muted' }, g.state === 'in' ? g.status : g.state === 'post' ? g.status || 'Final' : when(g)));

      if (view === 'list') {
        return el.replaceChildren(h('div', { class: `sb-list ${compact ? 'compact' : ''}` }, d.games.map(listRow)));
      }

      if (view === 'ticker') {
        const track = h('div', { class: 'sb-track' }, d.games.map((g) => chip(g)), d.games.map((g) => chip(g, true)));
        const wrap = h('div', { class: 'sb-ticker', 'data-fit-ignore': true }, track); // it is meant to run wider than its box
        el.replaceChildren(wrap);
        const pps = TICKER_PPS[options.tickerSpeed] || TICKER_PPS.medium;
        const apply = () => {
          // The games are listed twice so the loop has no gap; the first repeat starts exactly one loop-length in.
          track.classList.remove('still');
          const half = track.children[d.games.length].offsetLeft;
          const still = half <= wrap.clientWidth; // it all fits: no need to scroll (and no repeat)
          track.classList.toggle('still', still);
          if (!still) track.style.animationDuration = `${Math.max(8, half / pps)}s`;
        };
        requestAnimationFrame(apply);
        if (window.ResizeObserver) new ResizeObserver(apply).observe(track); // the fit scale changes the width a moment later
        return null;
      }

      if (view === 'slideshow') {
        const anyLive = d.games.some((g) => g.state === 'in');
        const games = options.slideLive !== false && anyLive ? d.games.filter((g) => g.state === 'in') : d.games;
        const per = Math.max(3, Number(options.slideSeconds) || 8);
        let i = Math.min(el._sbIndex || 0, games.length - 1);
        let elapsed = el._sbElapsed || 0;
        const slides = games.map(slide);
        const dots = h('div', { class: 'sb-dots' }, games.map(() => h('i')));
        if (options.showDots === false || games.length < 2) dots.style.display = 'none';
        // Every game sits in the same box and only the current one is visible, so the content fit measures them all
        // once and does not resize each time the slide changes.
        el.replaceChildren(h('div', { class: 'sb-show' }, slides, dots));
        const show = (n) => {
          i = (n + games.length) % games.length;
          el._sbIndex = i;
          elapsed = 0;
          slides.forEach((s, k) => s.classList.toggle('on', k === i));
          [...dots.children].forEach((x, k) => x.classList.toggle('on', k === i));
        };
        show(i);
        elapsed = el._sbElapsed || 0; // a data refresh redraws the widget: carry on from where this slide was
        if (games.length > 1) {
          el._sbTick = setInterval(() => {
            if (!el.isConnected) return clearInterval(el._sbTick);
            const c = el.closest('.card');
            if (c && c.classList.contains('rotate') && !c.classList.contains('active')) return; // only runs while on screen
            elapsed += 1;
            el._sbElapsed = elapsed;
            if (elapsed >= per) { el._sbElapsed = 0; show(i + 1); }
          }, 1000);
        }
        return null;
      }

      el.replaceChildren(h('div', { class: `sb-grid ${compact ? 'compact' : ''}` }, d.games.map(card)));
      return null;
    },
  });
})();
