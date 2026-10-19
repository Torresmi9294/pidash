(() => {
  const MEDAL = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

  // Team logo from ESPN's CDN. Falls back to a colored initials badge if it is missing or fails to load.
  function logo(h, t, size) {
    const initials = String(t.abbrev || t.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?';
    let hue = 0;
    for (const c of String(t.name)) hue = (hue * 31 + c.charCodeAt(0)) % 360;
    const badge = h('span', { class: `tlogo ${size} badge`, style: `background:hsl(${hue},55%,38%)` }, initials);
    if (!t.logo) return badge;
    const img = h('img', { class: `tlogo ${size}`, src: t.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(badge));
    return img;
  }

  Dash.register('espn-fantasy', {
    title: 'Fantasy',
    render(el, d, { h, options }) {
      const hi = options.highlight !== false; // "Highlight what matters"
      const logos = options.showLogos !== false;
      const callouts = options.callouts !== false;
      const mine = (id) => (d.myTeamId && id === d.myTeamId) || d.pinned.includes(id);
      const showM = d.show !== 'standings';
      const showS = d.show !== 'matchups';
      const L = (t, size) => (logos ? logo(h, t, size) : null);

      const side = (s, other) => {
        const lead = hi && other && s.score > other.score;
        const trail = hi && other && s.score < other.score;
        return h('div', { class: `ms ${mine(s.id) ? 'me' : ''} ${lead ? 'lead' : ''} ${trail ? 'trail' : ''}` },
          L(s, 'md'), h('span', { class: 'mn' }, s.name), h('span', { class: 'sc' }, s.score));
      };
      const matchups = d.matchups.map((m) =>
        m.away
          ? h('div', { class: `mu ${hi && m.close ? 'close' : ''}` }, side(m.home, m.away), side(m.away, m.home),
              hi && m.close ? h('span', { class: 'tag' }, '⚡ close') : null)
          : h('div', { class: 'mu' }, h('div', { class: `ms ${mine(m.home.id) ? 'me' : ''}` }, L(m.home, 'md'), h('span', { class: 'mn' }, m.home.name), h('span', { class: 'muted' }, 'BYE'))));

      const standings = d.standings.map((t) =>
        h('div', { class: `st ${mine(t.id) ? 'me' : ''} ${hi && t.rank <= 3 ? `top${t.rank}` : ''}` },
          h('span', { class: 'rk' }, hi && t.rank <= 3 ? MEDAL[t.rank - 1] : t.rank),
          h('span', { class: 'sn' }, L(t, 'sm'), h('span', {}, t.name),
            hi && t.streak ? h('span', { class: `streak ${t.streak[0] === 'W' ? 'w' : t.streak[0] === 'L' ? 'l' : ''}` }, t.streak) : null),
          h('span', { class: 'rc' }, `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`)));

      const chips = callouts && showM && d.callouts.length
        ? h('div', { class: 'callouts' }, d.callouts.map((c) =>
            h('div', { class: `callout ${mine(c.teamId) ? 'me' : ''}` }, h('span', { class: 'ci' }, c.icon), h('b', {}, `${c.label}: `), c.text)))
        : null;

      el.replaceChildren(h('div', { class: `espn ${showM && showS ? '' : 'single'}` },
        showM ? h('div', { class: 'ecol' }, h('h3', {}, `${d.leagueName} · Week ${d.period}`), matchups, chips) : null,
        showS ? h('div', { class: 'ecol' }, h('h3', {}, 'Standings'), standings) : null));
    },
  });
})();
