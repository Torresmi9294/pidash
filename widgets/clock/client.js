Dash.register('clock', {
  chrome: false,
  fitMax: 2.5, // the clock is happy to grow big
  render(el, _data, ctx) {
    const { h, fmt, options } = ctx;
    const time = h('div', { class: 'clock-time' });
    const date = h('div', { class: 'clock-date' });
    el.replaceChildren(time, date);
    const tz = options.timezone || undefined;
    let timer = null;
    const tick = () => {
      if (!el.isConnected) return clearInterval(timer);
      const now = new Date();
      const parts = new Intl.DateTimeFormat(ctx.display.locale || undefined, {
        hour: 'numeric', minute: '2-digit', second: options.showSeconds ? '2-digit' : undefined, hour12: fmt.hour12, timeZone: tz,
      }).formatToParts(now);
      const dp = parts.find((p) => p.type === 'dayPeriod');
      time.replaceChildren(parts.filter((p) => p !== dp).map((p) => p.value).join('').trim(), dp ? h('small', {}, dp.value) : null);
      date.textContent = fmt.dateLong(now, tz);
    };
    tick();
    timer = setInterval(tick, options.showSeconds ? 1000 : 5000);
  },
});
