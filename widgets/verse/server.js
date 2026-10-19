'use strict';
// Verse of the Day. Three sources:
//   biblegateway - Bible Gateway's official Verse of the Day in the version you choose (NIV, ESV, ...)
//   curated      - a built-in list of well-known verses, one per day, in a public-domain translation
//   custom       - your own list of references, one per day (cycles through them)
const refs = require('./refs');

exports.meta = {
  type: 'verse',
  name: 'Verse of the Day',
  description: 'A Bible verse that changes daily. Choose the version, or supply your own list.',
  refreshSec: 1800,
  fields: [
    {
      key: 'source', label: 'Source', type: 'select',
      options: [
        { value: 'biblegateway', label: 'Bible Gateway Verse of the Day (NIV, ESV, ...)' },
        { value: 'curated', label: 'Curated daily verses (public-domain translations)' },
        { value: 'custom', label: 'My own list of verses' },
      ],
    },
    {
      key: 'version', label: 'Version (Bible Gateway source)', type: 'select',
      options: ['NIV', 'ESV', 'NKJV', 'NLT', 'NASB', 'NASB1995', 'CSB', 'KJV', 'AMP', 'MSG', 'NIRV', 'RSV', 'WEB'].map((v) => ({ value: v, label: v })),
    },
    {
      key: 'translation', label: 'Translation (curated / my list)', type: 'select',
      options: [
        { value: 'web', label: 'World English Bible' }, { value: 'kjv', label: 'King James Version' },
        { value: 'asv', label: 'American Standard Version' }, { value: 'bbe', label: 'Bible in Basic English' },
        { value: 'darby', label: 'Darby Bible' }, { value: 'oeb-us', label: 'Open English Bible (US)' },
      ],
    },
    { key: 'verses', label: 'My list (one reference per line)', type: 'textarea', placeholder: 'John 3:16\nPsalm 23:1-4\nRomans 8:38-39', help: 'Only used with "My own list". Lines starting with # are ignored. Shows the next one each day.' },
  ],
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', hellip: '…' };

function decode(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Bible Gateway wraps the verse in curly quotes; the widget adds its own.
const unquote = (s) => s.replace(/^[“"]\s*/, '').replace(/\s*[”"]$/, '');

function dayOfYear(d = new Date()) {
  return Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'PiDash/1.0' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${res.status}`);
  return res.json();
}

async function fromBibleGateway(version) {
  const j = await getJson(`https://www.biblegateway.com/votd/get/?format=json&version=${encodeURIComponent(version)}`);
  const v = j.votd;
  if (!v || !v.text) throw new Error(`Bible Gateway has no verse of the day for ${version}.`);
  return {
    reference: decode(v.display_ref || v.reference),
    text: unquote(decode(v.text)),
    version,
    copyright: decode(v.copyright),
  };
}

const textCache = new Map(); // "translation|reference" -> result (a given reference never changes)
async function fromBibleApi(reference, translation) {
  const key = `${translation}|${reference}`;
  if (textCache.has(key)) return textCache.get(key);
  let j;
  try {
    j = await getJson(`https://bible-api.com/${encodeURIComponent(reference)}?translation=${encodeURIComponent(translation)}`);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) throw new Error(`Could not find "${reference}" in ${translation.toUpperCase()}. Check the spelling (e.g. "1 John 4:19").`);
    throw e;
  }
  const text = decode(j.text);
  if (!text) throw new Error(`Could not find "${reference}" in ${translation.toUpperCase()}.`);
  const out = { reference: j.reference || reference, text, version: String(j.translation_id || translation).toUpperCase(), copyright: '' };
  textCache.set(key, out);
  return out;
}

function pickFromList(list, date) {
  return list[dayOfYear(date) % list.length];
}

exports.data = async (options) => {
  const source = options.source || 'biblegateway';
  const translation = options.translation || 'web';
  let verse;
  if (source === 'curated') {
    verse = await fromBibleApi(pickFromList(refs, new Date()), translation);
  } else if (source === 'custom') {
    const list = String(options.verses || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    if (!list.length) throw new Error('Add at least one verse reference (e.g. John 3:16) in the widget settings.');
    verse = await fromBibleApi(pickFromList(list, new Date()), translation);
  } else {
    verse = await fromBibleGateway(options.version || 'NIV');
  }
  return verse;
};

exports._internals = { decode, unquote, dayOfYear, pickFromList };
