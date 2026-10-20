(() => {
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

  const shown = (p) => (p.pts == null || (p.pts === 0 && p.proj > 0) ? '–' : p.pts);

  Dash.register('espn-matchup', {
    title: 'Matchup',
    fitFloor: 0.7,
    render(el, d, { h, options, slot }) {
      clearInterval(el._fmTick);
      const showBench = options.showBench === true && slot !== 'sidebar';
      const showProj = options.showProjected !== false;
      const showInj = options.showInjuries !== false;
      const showPhoto = options.showHeadshots === true;
      const showLogo = options.showLogos !== false;
      const hi = options.highlight !== false;
      const perMatchup = Math.max(5, Number(options.itemSeconds) || 12);
      let i = Math.min(el._fmIndex || 0, d.matchups.length - 1);
      let elapsed = 0;

      // One player cell. The left side reads photo-name-proj-points toward the middle, the right side mirrors it.
      const cell = (p, side, win, lose) => {
        const cls = `fm-cell ${side} ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${showInj && p && p.injuryLevel ? `inj-${p.injuryLevel}` : ''}`;
        if (!p) return h('div', { class: cls });
        const photo = showPhoto ? h('span', { class: 'fr-photo' }, p.headshot ? (() => { const im = h('img', { src: p.headshot, alt: '', loading: 'lazy' }); im.addEventListener('error', () => im.remove()); return im; })() : null) : null;
        const name = h('span', { class: 'fm-name' }, p.short, p.team ? h('small', {}, ` ${p.team}`) : null, showInj && p.injury ? h('span', { class: `fr-inj ${p.injuryLevel}` }, p.injury) : null);
        const proj = showProj && p.proj != null ? h('span', { class: 'fm-proj' }, p.proj) : null;
        const pts = h('span', { class: 'fm-pts' }, shown(p));
        return h('div', { class: cls }, ...(side === 'l' ? [photo, name, proj, pts] : [pts, proj, name, photo]));
      };

      const line = (r, extra) => {
        const a = r.home && r.home.pts;
        const b = r.away && r.away.pts;
        const both = hi && r.home && r.away && a != null && b != null && (a > 0 || b > 0) && a !== b;
        return h('div', { class: `fm-row ${extra || ''}`, 'data-fit-item': true, 'data-fit-silent': extra ? true : null },
          cell(r.home, 'l', both && a > b, both && a < b), h('span', { class: 'fm-slot' }, r.slot), cell(r.away, 'r', both && b > a, both && b < a));
      };

      const head = (t, side, leading) => h('div', { class: `fm-team ${side} ${d.myTeamId && t.id === d.myTeamId ? 'me' : ''}` },
        showLogo ? logo(h, t) : null,
        h('div', { class: 'fm-tn' }, h('b', {}, t.name), h('small', {}, `#${t.rank} · ${t.record}`)),
        h('div', { class: `fm-score ${leading ? 'lead' : ''}` }, h('b', {}, t.score), showProj && t.proj ? h('small', {}, `proj ${t.proj}`) : null));

      function show(n) {
        i = (n + d.matchups.length) % d.matchups.length;
        el._fmIndex = i;
        elapsed = 0;
        const m = d.matchups[i];
        const started = m.home.score > 0 || m.away.score > 0;
        const benchRows = [];
        if (showBench) {
          const n2 = Math.max(m.home.bench.length, m.away.bench.length);
          for (let k = 0; k < n2; k++) benchRows.push({ slot: 'BN', home: m.home.bench[k] || null, away: m.away.bench[k] || null });
        }
        el.replaceChildren(h('div', { class: 'fm' },
          h('div', { class: 'fm-head' }, head(m.home, 'l', hi && started && m.home.score > m.away.score), head(m.away, 'r', hi && started && m.away.score > m.home.score)),
          h('div', { class: 'fm-sub muted' }, `${d.leagueName} · Week ${d.period}${d.single ? '' : ` · ${i + 1}/${d.matchups.length}`}`),
          h('div', { class: 'fm-list' }, m.rows.map((r) => line(r)),
            benchRows.length ? h('div', { class: 'fr-group', 'data-fit-group': true }, h('div', { class: 'fr-label' }, 'Bench'), benchRows.map((r) => line(r, 'bench'))) : null)));
      }

      show(i);
      if (d.matchups.length > 1) {
        el._fmTick = setInterval(() => {
          if (!el.isConnected) return clearInterval(el._fmTick);
          const card = el.closest('.card');
          if (card && card.classList.contains('rotate') && !card.classList.contains('active')) return;
          elapsed += 1;
          if (elapsed >= perMatchup) show(i + 1);
        }, 1000);
      }
    },
  });
})();
