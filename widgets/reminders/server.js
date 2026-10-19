'use strict';
const store = require('../../server/store');

exports.meta = {
  type: 'reminders',
  name: 'Reminders',
  description: 'Your to-do list. Add and complete reminders from the admin page.',
  refreshSec: 30,
  fields: [
    { key: 'showDone', label: 'Show completed items', type: 'checkbox' },
    { key: 'maxItems', label: 'Max items', type: 'number', placeholder: '8' },
  ],
};

exports.data = async (options) => {
  const max = Number(options.maxItems) || 8;
  const items = store
    .listReminders()
    .filter((r) => options.showDone || !r.done)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created)
    .slice(0, max);
  return { items };
};
