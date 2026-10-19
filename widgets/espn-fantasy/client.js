Dash.register('espn-fantasy', {
  title: 'Fantasy',
  render(el, d, { h }) {
    const mine = (id) => d.myTeamId && id === d.myTeamId;
    const showM = d.show !== 'standings';
    const showS = d.show !== 'matchups';

    const side = (s, other) => h('div', { class: mine(s.id) ? 'me' : '' },
      h('span', { class: s.score > other.score ? 'w' : '' }, s.name),
      h('span', { class: s.score > other.score ? 'w' : '' }, s.score));
    const matchups = d.matchups.map((m) =>
      m.away ? h('div', { class: 'mu' }, side(m.home, m.away), side(m.away, m.home))
             : h('div', { class: 'mu' }, h('div', {}, h('span', {}, m.home.name), h('span', { class: 'muted' }, 'BYE'))));
    const standings = d.standings.map((t) =>
      h('div', { class: `st ${mine(t.id) ? 'me' : ''}` },
        h('span', { class: 'rk' }, t.rank), h('span', {}, t.name),
        h('span', { class: 'rc' }, `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`)));

    el.replaceChildren(h('div', { class: `espn ${showM && showS ? '' : 'single'}` },
      showM ? h('div', {}, h('h3', {}, `${d.leagueName} · Week ${d.period}`), matchups) : null,
      showS ? h('div', {}, h('h3', {}, 'Standings'), standings) : null));
  },
});
