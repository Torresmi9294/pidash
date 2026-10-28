'use strict';
// Tiny JSON-file store for widget data that isn't configuration (e.g. reminders).
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const REMINDERS_FILE = path.join(config.DATA_DIR, 'reminders.json');

function listReminders() {
  return config.readJson(REMINDERS_FILE, []);
}

function addReminder({ text, due, starred }) {
  const t = String(text || '').trim().slice(0, 200);
  if (!t) throw new Error('Reminder text is required.');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(String(due))) throw new Error('The date should look like 2026-10-31.');
  const list = listReminders();
  const item = { id: crypto.randomBytes(4).toString('hex'), text: t, due: due || null, done: false, starred: !!starred, created: Date.now() };
  list.push(item);
  config.writeJson(REMINDERS_FILE, list);
  return item;
}

function updateReminder(id, patch) {
  const list = listReminders();
  const item = list.find((r) => r.id === id);
  if (!item) return null;
  if ('done' in patch) item.done = !!patch.done;
  if ('text' in patch) {
    const text = String(patch.text == null ? '' : patch.text).trim().slice(0, 200);
    if (!text) throw new Error('Reminder text is required.');
    item.text = text;
  }
  if ('due' in patch) {
    if (patch.due && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.due))) throw new Error('The date should look like 2026-10-31.');
    item.due = patch.due || null;
  }
  if ('starred' in patch) item.starred = !!patch.starred;
  config.writeJson(REMINDERS_FILE, list);
  return item;
}

function deleteReminder(id) {
  const list = listReminders();
  const next = list.filter((r) => r.id !== id);
  config.writeJson(REMINDERS_FILE, next);
  return next.length !== list.length;
}

module.exports = { listReminders, addReminder, updateReminder, deleteReminder };
