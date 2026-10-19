'use strict';
// Calendar: Google Calendar (OAuth) and/or any iCal/ICS feed URL
// (Google "secret address in iCal format", iCloud, Outlook, Fastmail, ...).
const ical = require('node-ical');
const google = require('../../server/google');

exports.meta = {
  type: 'calendar',
  name: 'Calendar',
  description: 'Upcoming events from Google Calendar and/or ICS feeds. Agenda or month view.',
  refreshSec: 300,
  fields: [
    { key: 'view', label: 'View', type: 'select', options: [{ value: 'agenda', label: 'Agenda (list)' }, { value: 'month', label: 'Month grid' }] },
    { key: 'useGoogle', label: 'Use Google Calendar (connect it on the Google tab)', type: 'checkbox' },
    { key: 'calendarIds', label: 'Google calendar IDs (one per line)', type: 'textarea', placeholder: 'primary', help: 'Blank = your primary calendar. Find IDs on the Google tab.' },
    { key: 'icsUrls', label: 'ICS feed URLs (one per line)', type: 'textarea', secret: true, placeholder: 'https://calendar.google.com/calendar/ical/.../basic.ics', help: 'The easiest option - no API setup. These URLs are private, so they are hidden once saved.' },
    { key: 'daysAhead', label: 'Days ahead (agenda)', type: 'number', placeholder: '7' },
    { key: 'maxEvents', label: 'Max events (agenda)', type: 'number', placeholder: '12' },
  ],
};

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function rangeFor(options) {
  const now = new Date();
  if (options.view === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = new Date(first);
    from.setDate(first.getDate() - first.getDay()); // grid starts on Sunday
    const to = new Date(from);
    to.setDate(from.getDate() + 42);
    return { from, to };
  }
  const from = startOfDay(now);
  const to = new Date(from);
  to.setDate(from.getDate() + (Number(options.daysAhead) || 7));
  return { from, to };
}

function fromIcs(ev, from, to, calendar) {
  const allDay = ev.datetype === 'date';
  const dur = ev.end ? ev.end - ev.start : 0;
  const make = (start, src) => {
    const end = new Date(start.getTime() + ((src.end ? src.end - src.start : dur)));
    return {
      id: `${ev.uid}-${start.getTime()}`,
      title: String(src.summary && src.summary.val ? src.summary.val : src.summary || '(No title)'),
      location: String(src.location || ''),
      allDay,
      start: allDay ? localDate(start) : start.toISOString(),
      end: allDay ? localDate(end) : end.toISOString(),
      calendar,
      _s: start,
      _e: end,
    };
  };
  const out = [];
  if (ev.rrule) {
    let dates = [];
    try {
      dates = ev.rrule.between(new Date(from.getTime() - dur), to, true);
    } catch (e) {
      console.error(`[calendar] bad recurrence in "${ev.summary}": ${e.message}`);
    }
    for (const d of dates) {
      const key = d.toISOString().slice(0, 10);
      if (ev.exdate && ev.exdate[key]) continue;
      const override = ev.recurrences && ev.recurrences[key];
      out.push(override ? make(new Date(override.start), override) : make(d, ev));
    }
  } else if (ev.start) {
    out.push(make(new Date(ev.start), ev));
  }
  return out.filter((e) => e._e > from && e._s < to);
}

async function readIcs(url, from, to) {
  const res = await fetch(url, { headers: { 'user-agent': 'PiDash/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`ICS feed returned HTTP ${res.status}`);
  const parsed = ical.sync.parseICS(await res.text());
  const calName = (Object.values(parsed).find((v) => v.type === 'VCALENDAR') || {})['WR-CALNAME'] || '';
  return Object.values(parsed)
    .filter((v) => v.type === 'VEVENT')
    .flatMap((ev) => fromIcs(ev, from, to, calName));
}

exports.data = async (options) => {
  const { from, to } = rangeFor(options);
  const jobs = [];
  const warnings = [];

  const wantsGoogle = options.useGoogle || (!lines(options.icsUrls).length && google.status().connected);
  if (wantsGoogle) {
    const ids = lines(options.calendarIds);
    for (const id of ids.length ? ids : ['primary']) jobs.push(google.events(id, from, to).then((evs) => evs.map((e) => ({ ...e, calendar: id }))));
  }
  for (const url of lines(options.icsUrls)) jobs.push(readIcs(url, from, to));

  if (!jobs.length) throw new Error('No calendar source configured. Connect Google or add an ICS URL in the calendar widget settings.');

  const settled = await Promise.allSettled(jobs);
  const events = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') events.push(...r.value);
    else warnings.push(r.reason.message);
  }
  if (!events.length && warnings.length === settled.length) throw new Error(warnings[0]);

  events.sort((a, b) => (a.allDay === b.allDay ? String(a.start).localeCompare(String(b.start)) : a.allDay ? -1 : 1));
  const max = options.view === 'month' ? 300 : Number(options.maxEvents) || 12;
  return {
    view: options.view === 'month' ? 'month' : 'agenda',
    rangeStart: localDate(from),
    events: events.slice(0, max).map(({ _s, _e, ...e }) => e),
    warnings,
  };
};
