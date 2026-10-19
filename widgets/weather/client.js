(() => {
  const ICON = {
    clear: ['☀️', '🌙'], partly: ['⛅', '☁️'], cloudy: ['☁️', '☁️'], fog: ['🌫️', '🌫️'],
    drizzle: ['🌦️', '🌧️'], rain: ['🌧️', '🌧️'], snow: ['🌨️', '🌨️'], thunder: ['⛈️', '⛈️'],
  };
  const icon = (c, day = true) => (ICON[c] || ICON.cloudy)[day ? 0 : 1];

  Dash.register('weather', {
    title: 'Weather',
    render(el, d, { h, fmt, slot }) {
      const u = d.units;
      const cur = d.current;
      const days = (slot === 'sidebar' ? d.daily.slice(0, 3) : d.daily).map((x) =>
        h('div', { class: 'wx-day' },
          h('div', { class: 'd' }, fmt.weekday(x.date, 'short')),
          h('div', { class: 'i' }, icon(x.condition)),
          h('div', { class: 't' }, `${x.high}°`, ' ', h('span', {}, `${x.low}°`)),
          h('div', { class: 'r' }, x.rain >= 20 ? `💧${x.rain}%` : ''),
        ));
      el.replaceChildren(
        h('div', { class: 'wx-now' },
          h('div', { class: 'wx-icon' }, icon(cur.condition, cur.isDay)),
          h('div', {},
            h('div', { class: 'wx-temp' }, `${cur.temp}°${u.temp}`),
            h('div', { class: 'wx-meta' },
              d.location,
              d.today ? ` · H ${d.today.high}° L ${d.today.low}°` : '',
              h('br'),
              `Feels ${cur.feelsLike}° · ${cur.humidity}% · ${cur.wind} ${u.wind}`),
          )),
        h('div', { class: 'wx-days' }, days),
      );
    },
  });
})();
