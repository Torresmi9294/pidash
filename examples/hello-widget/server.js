'use strict';
// Example widget. Copy this folder to <data dir>/widgets/hello/ (on a Pi: /var/lib/pidash/data/widgets/hello/)
// and restart PiDash. It then shows up in Admin > Widgets > Add a widget.
exports.meta = {
  type: 'hello',            // unique id
  name: 'Hello',            // shown in the admin
  description: 'Example widget that says hello.',
  refreshSec: 60,           // how often the display asks for fresh data
  fields: [                 // generates the settings form; "secret" fields are masked in the admin
    { key: 'name', label: 'Name', type: 'text', placeholder: 'World' },
    { key: 'apiKey', label: 'API key (example secret)', type: 'text', secret: true },
  ],
};

// Runs on the Pi. `options` = this widget's saved settings (secrets included). Return JSON.
exports.data = async (options, ctx) => ({
  greeting: `Hello, ${options.name || 'World'}!`,
  time: new Date().toISOString(),
  units: ctx.display.units,
});
