Dash.register('health', {
  title: 'Health',
  render(el, d, { h, fmt, slot }) {
    const m = d.m;
    const num = (v) => Math.round(v).toLocaleString();
    const pct = (v, goal) => Math.max(0, Math.min(100, ((v || 0) / goal) * 100));

    const ring = (value, goal, label, color, text) =>
      h('div', { class: 'ring', style: `--p:${pct(value, goal)};--c:${color}` },
        h('div', { class: 'ring-in' }, h('b', {}, text), h('small', {}, label)));

    const rings = [];
    if (m.steps != null) rings.push(ring(m.steps, d.goals.steps, 'steps', 'var(--accent)', num(m.steps)));
    if (m.activeCalories != null) rings.push(ring(m.activeCalories, d.goals.calories, 'move kcal', '#ff5c7a', num(m.activeCalories)));
    if (m.exerciseMinutes != null) rings.push(ring(m.exerciseMinutes, d.goals.exercise, 'exercise min', 'var(--good)', num(m.exerciseMinutes)));

    const stat = (icon, value, label) => (value == null ? null : h('div', { class: 'hstat' }, h('div', { class: 'hv' }, `${icon} ${value}`), h('div', { class: 'hl' }, label)));
    const sleep = m.sleepHours == null ? null : `${Math.floor(m.sleepHours)}h ${String(Math.round((m.sleepHours % 1) * 60)).padStart(2, '0')}m`;
    const stats = [
      stat('❤️', m.heartRate != null ? `${Math.round(m.heartRate)} bpm` : null, 'heart rate'),
      stat('💤', m.restingHeartRate != null ? `${Math.round(m.restingHeartRate)} bpm` : null, 'resting'),
      stat('🌙', sleep, `sleep · goal ${d.goals.sleep}h`),
      stat('👣', m.distance != null ? `${m.distance} ${d.units.distance}` : null, 'distance'),
      stat('⚖️', m.weight != null ? `${m.weight} ${d.units.weight}` : null, 'weight'),
      stat('🫁', m.bloodOxygen != null ? `${Math.round(m.bloodOxygen)}%` : null, 'blood oxygen'),
      stat('🧍', m.standHours != null ? `${Math.round(m.standHours)} h` : null, 'stand hours'),
    ].filter(Boolean);

    const max = Math.max(d.goals.steps, ...d.week.map((x) => x.steps));
    const bars = d.week.map((x) =>
      h('div', { class: 'bar' },
        h('div', { class: 'bar-fill', style: `height:${Math.max(3, (x.steps / max) * 100)}%;${x.steps >= d.goals.steps ? 'background:var(--good)' : ''}`, title: `${num(x.steps)} steps` }),
        h('small', {}, fmt.weekday(x.date, 'narrow'))));

    const age = Math.round((Date.now() - d.updated) / 60000);
    const when = age < 1 ? 'just now' : age < 60 ? `${age} min ago` : age < 1440 ? `${Math.round(age / 60)} h ago` : `${Math.round(age / 1440)} d ago`;
    const note = `${d.isToday ? 'Today' : fmt.dateShort(d.date)} · updated ${when}${d.person !== 'me' ? ` · ${d.person}` : ''}`;

    el.replaceChildren(
      h('div', { class: `health ${slot}` },
        h('div', { class: 'rings' }, rings),
        slot === 'sidebar' ? null : h('div', { class: 'hstats' }, stats),
        slot === 'sidebar' ? null : h('div', { class: 'bars' }, bars),
        h('div', { class: 'hnote muted' }, note)));
  },
});
