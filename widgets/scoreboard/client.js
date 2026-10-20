(() => {
  // Team logo (served from this server's cache); falls back to a colored initials badge.
  function logo(h, t) {
    const initials = String(t.abbr || t.short || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?';
    let hue = 0;
    for (const c of String(t.name)) hue = (hue * 31 + c.charCodeAt(0)) % 360;
    const badge = h('span', { class: 'sb-logo badge', style: `background:${t.color || `hsl(${hue},55%,38%)`}` }, initials);
    if (!t.logo) return badge;
    const img = h('img', { class: 'sb-logo', src: t.logo, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(badge));
    return img;
  }

  Dash.register('scoreboard', {
    title: 'Scoreboard',
    fitFloor: 0.75,
    render(el, d, { h, fmt, options, slot }) {
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

      const row = (s, other, g) => {
        const lose = g.state === 'post' && other.score != null && s.score != null && s.score < other.score;
        const lead = g.state === 'in' && other.score != null && s.score != null && s.score > other.score;
        return h('div', { class: `sb-team ${s.winner ? 'win' : ''} ${lose ? 'lose' : ''} ${lead ? 'lead' : ''} ${s.fav ? 'fav' : ''}` },
          showLogos ? logo(h, s) : null,
          h('span', { class: 'sb-name' }, s.rank ? h('small', { class: 'sb-rank' }, s.rank) : null,
            s.fav ? h('span', { class: 'sb-star', title: 'My team' }, '★') : null,
            `${s.fav ? ' ' : ''}${compact ? s.abbr || s.short : s.short}`, // no-break space keeps the star glued to the name
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

      el.replaceChildren(h('div', { class: `sb-grid ${compact ? 'compact' : ''}` }, d.games.map(card)));
    },
  });
})();
