'use strict';
// Tiny JSON-file store for widget data that isn't configuration (e.g. reminders).
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const REMINDERS_FILE = path.join(config.DATA_DIR, 'reminders.json');

function listReminders() {
  return config.readJson(REMINDERS_FILE, []);
}

function addReminder({ text, due }) {
  const t = String(text || '').trim().slice(0, 200);
  if (!t) throw new Error('Reminder text is required.');
  const list = listReminders();
  const item = { id: crypto.randomBytes(4).toString('hex'), text: t, due: due || null, done: false, created: Date.now() };
  list.push(item);
  config.writeJson(REMINDERS_FILE, list);
  return item;
}

function updateReminder(id, patch) {
  const list = listReminders();
  const item = list.find((r) => r.id === id);
  if (!item) return null;
  if ('done' in patch) item.done = !!patch.done;
  if ('text' in patch) item.text = String(patch.text).slice(0, 200);
  if ('due' in patch) item.due = patch.due || null;
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
