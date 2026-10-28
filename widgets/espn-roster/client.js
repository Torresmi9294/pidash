(() => {
  // Team logo (served from this server's cache); falls back to a colored initials badge.
  function logo(h, t) {
    const initials = String(t.abbrev || t.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?';
    let hue = 0;
    for (const c of String(t.name)) hue = (hue * 31 + c.charCodeAt(0)) % 360;
    const badge = h('span', { class: 'tlogo md badge', style: `background:hsl(${hue},55%,38%)` }, initials);
    if (!t.logo) return badge;
    const img = h('img', { class: 'tlogo md', src: t.logo, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(badge));
    return img;
  }

  // "-" until a player has scored (an unplayed game shows 0 with a projection).
  const points = (p) => (p.pts == null || (p.pts === 0 && p.proj > 0) ? '–' : p.pts);

  Dash.register('espn-roster', {
    title: 'Roster',
    fitFloor: 0.7,
    render(el, d, { h, options, slot }) {
      clearInterval(el._frTick);
      const showBench = options.showBench !== false && slot !== 'sidebar';
      const showProj = options.showProjected !== false;
      const showInj = options.showInjuries !== false;
      const showPhoto = options.showHeadshots !== false;
      const showLogo = options.showLogos !== false;
      const weeks = d.daily && d.teams.some((t) => [...t.starters, ...t.bench, ...t.reserve].some((p) => p.week != null)); // matchup-to-date column
      const perTeam = Math.max(5, Number(options.itemSeconds) || 12);
      let i = Math.min(el._frIndex || 0, d.teams.length - 1);
      let elapsed = 0;

      const row = (p, extra) => h('div', { class: `fr-row ${extra || ''} ${showInj && p.injuryLevel ? `inj-${p.injuryLevel}` : ''}`, 'data-fit-item': true, 'data-fit-silent': extra ? true : null },
        h('span', { class: 'fr-slot' }, p.slot),
        showPhoto ? h('span', { class: 'fr-photo' }, p.headshot ? (() => { const im = h('img', { src: p.headshot, alt: '', loading: 'lazy' }); im.addEventListener('error', () => im.remove()); return im; })() : null) : null,
        h('span', { class: 'fr-name' }, p.short, p.team ? h('small', {}, ` ${p.team}`) : null,
          showInj && p.injury ? h('span', { class: `fr-inj ${p.injuryLevel}` }, p.injury) : null),
        showProj && p.proj != null ? h('span', { class: 'fr-proj' }, p.proj) : null,
        h('span', { class: 'fr-pts' }, points(p)),
        weeks ? h('span', { class: 'fr-wk' }, p.week == null ? '–' : p.week) : null);

      const section = (label, rows, extra) => (rows.length
        ? h('div', { class: 'fr-group', 'data-fit-group': true }, h('div', { class: 'fr-label' }, label), rows.map((p) => row(p, extra)))
        : null);

      function show(n) {
        i = (n + d.teams.length) % d.teams.length;
        el._frIndex = i;
        elapsed = 0;
        const t = d.teams[i];
        el.replaceChildren(h('div', { class: 'fr' },
          h('div', { class: 'fr-head' },
            showLogo ? logo(h, t) : null,
            h('div', { class: 'fr-title' }, h('b', {}, t.name),
              h('small', {}, `#${t.rank} · ${t.record}${t.streak ? ` · ${t.streak}` : ''}${d.single ? '' : ` · ${i + 1}/${d.teams.length}`}`)),
            h('div', { class: 'fr-total' }, h('b', {}, t.points),
              d.daily ? h('small', {}, 'today') : null,
              t.week != null ? h('small', {}, `week ${t.week}`) : null,
              showProj && t.proj ? h('small', {}, `proj ${t.proj}`) : null)),
          weeks ? h('div', { class: 'fr-legend' }, showProj ? h('span', {}, 'proj') : null, h('span', {}, 'today'), h('span', {}, 'week')) : null,
          h('div', { class: 'fr-list' },
            t.starters.map((p) => row(p)),
            showBench ? section('Bench', t.bench, 'bench') : null,
            showBench ? section('Injured reserve', t.reserve, 'bench') : null)));
      }

      if (!d.teams.length) return el.replaceChildren(h('div', { class: 'msg' }, 'No roster to show.'));
      show(i);
      if (d.teams.length > 1) {
        // Only advances while this card is actually on screen.
        el._frTick = setInterval(() => {
          if (!el.isConnected) return clearInterval(el._frTick);
          const card = el.closest('.card');
          if (card && card.classList.contains('rotate') && !card.classList.contains('active')) return;
          elapsed += 1;
          if (elapsed >= perTeam) show(i + 1);
        }, 1000);
      }
    },
  });
})();
