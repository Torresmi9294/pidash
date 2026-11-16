'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pidash-calc-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/config');
const google = require('../server/google');
const cal = require('../widgets/calendar/server');

const realFetch = global.fetch;
let calls;
let handler;
test.beforeEach(() => {
  calls = [];
  google._resetColors();
  config.get().google.tokens = { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600e3 };
  global.fetch = async (url, init) => {
    calls.push(String(url));
    const r = await handler(String(url), init);
    return r instanceof Response ? r : new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200 });
  };
});
test.afterEach(() => { global.fetch = realFetch; });

const at = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const ev = (id, summary, extra = {}) => ({ id, summary, status: 'confirmed', start: { dateTime: at(2) }, end: { dateTime: at(3) }, ...extra });
const CALENDARS = { items: [
  { id: 'me@gmail.com', primary: true, backgroundColor: '#039be5' },
  { id: 'family@group.calendar.google.com', backgroundColor: '#8e24aa' },
  { id: 'nocolor@group.calendar.google.com' },
] };
const googleApi = (events) => (url) => (url.includes('/calendarList') ? CALENDARS : url.includes('/events') ? { items: events } : {});

test('google: events take their calendar\'s color (including "primary"), and an event\'s own colorId wins', async () => {
  handler = googleApi([ev('a', 'Plain'), ev('b', 'Tomato', { colorId: '11' }), ev('c', 'Banana', { colorId: '5' }), ev('d', 'Unknown id', { colorId: '99' })]);
  const out = await google.events('primary', new Date(), new Date(Date.now() + 864e5));
  assert.deepEqual(out.map((e) => e.color), ['#039be5', '#d50000', '#f6bf26', '#039be5']);
  handler = googleApi([ev('x', 'Family')]);
  assert.equal((await google.events('family@group.calendar.google.com', new Date(), new Date(Date.now() + 864e5)))[0].color, '#8e24aa');
  assert.equal((await google.events('nocolor@group.calendar.google.com', new Date(), new Date(Date.now() + 864e5)))[0].color, null, 'no color known: left for the display to default');
});

test('google: the colorId palette is the one the Google Calendar app shows (not the API\'s old pastel one)', () => {
  assert.equal(Object.keys(google.EVENT_COLORS).length, 11);
  assert.equal(google.EVENT_COLORS[11], '#d50000'); // Tomato
  assert.equal(google.EVENT_COLORS[7], '#039be5');  // Peacock
  assert.equal(google.EVENT_COLORS[10], '#0b8043'); // Basil
  assert.ok(Object.values(google.EVENT_COLORS).every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

test('google: calendar colors are fetched once and reused; a failure to fetch them never loses the events', async () => {
  handler = googleApi([ev('a', 'One')]);
  await google.events('primary', new Date(), new Date(Date.now() + 864e5));
  await google.events('family@group.calendar.google.com', new Date(), new Date(Date.now() + 864e5));
  assert.equal(calls.filter((u) => u.includes('/calendarList')).length, 1, 'one calendarList request for both');

  google._resetColors();
  handler = (url) => (url.includes('/calendarList') ? new Response('{}', { status: 403 }) : { items: [ev('a', 'Still here', { colorId: '4' })] });
  const out = await google.events('primary', new Date(), new Date(Date.now() + 864e5));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Still here');
  assert.equal(out[0].color, '#e67c73', 'event colors still work without the calendar list');
});

const ICS = (head, body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nX-WR-CALNAME:Test\r\n${head}${body}END:VCALENDAR\r\n`;
const stamp = (h) => new Date(Date.now() + h * 3600e3).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const vevent = (uid, summary, extra = '') => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${stamp(0)}\r\nDTSTART:${stamp(2)}\r\nDTEND:${stamp(3)}\r\nSUMMARY:${summary}\r\n${extra}END:VEVENT\r\n`;

test('ics: a color after the URL is used; a color the feed declares is picked up; an event COLOR beats both', async () => {
  const feeds = {
    'https://x.test/mine.ics': ICS('', vevent('1', 'Mine')),
    'https://x.test/apple.ics': ICS('X-APPLE-CALENDAR-COLOR:#0088FF\r\n', vevent('2', 'Apple')),
    'https://x.test/rfc.ics': ICS('COLOR:#aabbcc\r\n', vevent('3', 'Rfc') + vevent('4', 'Own', 'COLOR:#112233\r\n')),
    'https://x.test/plain.ics': ICS('', vevent('5', 'Plain')),
    'https://x.test/declared-but-overridden.ics': ICS('X-APPLE-CALENDAR-COLOR:#0088FF\r\n', vevent('6', 'Overridden')),
  };
  handler = (url) => feeds[url] || new Response('nope', { status: 404 });
  const d = await cal.data({ icsUrls: [
    'https://x.test/mine.ics #0B8043', 'https://x.test/apple.ics', 'https://x.test/rfc.ics', 'https://x.test/plain.ics', 'https://x.test/declared-but-overridden.ics #fa0',
  ].join('\n'), daysAhead: 3 });
  const by = Object.fromEntries(d.events.map((e) => [e.title, e.color]));
  assert.equal(by.Mine, '#0b8043', 'your color for the feed');
  assert.equal(by.Apple, '#0088ff', 'declared by the feed (normalised to lower case)');
  assert.equal(by.Rfc, '#aabbcc');
  assert.equal(by.Own, '#112233', 'an event\'s own COLOR wins');
  assert.equal(by.Plain, null, 'no color anywhere: the display falls back to its accent');
  assert.equal(by.Overridden, '#ffaa00', 'your color beats the feed\'s, and #rgb is expanded');
  assert.ok(calls.every((u) => !u.includes(' #')), 'the color is not sent as part of the URL');
});

test('google calendar IDs may carry a color override, and IDs containing # are left alone', async () => {
  handler = googleApi([ev('a', 'Family event')]);
  const d = await cal.data({ useGoogle: true, daysAhead: 3, calendarIds: 'family@group.calendar.google.com #0b8043\nen.usa#holiday@group.v.calendar.google.com' });
  assert.deepEqual(d.events.map((e) => e.color), ['#0b8043', null]);
  assert.ok(calls.some((u) => u.includes(encodeURIComponent('en.usa#holiday@group.v.calendar.google.com'))), 'the holiday calendar id was requested intact');
  const { cleanColor, splitColor } = cal._internals;
  assert.equal(cleanColor('0B8043'), '#0b8043');
  assert.equal(cleanColor('red'), null);
  assert.equal(cleanColor('#12'), null);
  assert.deepEqual(splitColor('https://a.b/c.ics#frag'), { value: 'https://a.b/c.ics#frag', color: null });
});

test('calendar: a setting turns color-coding off; the display draws dots and bars, with readable text', () => {
  const f = cal.meta.fields.find((x) => x.key === 'useColors');
  assert.equal(f.type, 'checkbox');
  assert.equal(f.default, true, 'on unless you turn it off');
  const client = fs.readFileSync(path.join(__dirname, '..', 'widgets', 'calendar', 'client.js'), 'utf8');
  assert.match(client, /options\.useColors !== false/);
  assert.match(client, /class: 'cal-dot'/);
  assert.match(client, /e\.allDay/);
  assert.match(client, /#202124/, 'dark text on light colors');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'dash.css'), 'utf8');
  assert.match(css, /\.cal-dot \{/);
  assert.ok(!/(^|[^\w-])[\d.]+rem\b/.test(css.slice(css.indexOf('.cal-dot {'), css.indexOf('.cal-dot {') + 600)), 'sizes use the fit scale');
});
