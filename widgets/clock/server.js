'use strict';
exports.meta = {
  type: 'clock',
  name: 'Clock',
  description: 'Large clock and date. Runs entirely in the browser.',
  fields: [
    { key: 'showSeconds', label: 'Show seconds', type: 'checkbox' },
    { key: 'timezone', label: 'Time zone (optional)', type: 'text', placeholder: 'America/Chicago', help: 'IANA name. Leave blank to use the Pi\'s time zone.' },
  ],
};
