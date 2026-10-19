# Writing a widget

A widget is a folder with two files. There is no build step.

```
my-widget/
  server.js   runs on the Pi: declares settings, fetches data (API calls go here, keys stay private)
  client.js   runs in the browser: draws the data
  assets/     optional static files, served at /widget-assets/<type>/<file>
```

Put the folder in one of:

- `widgets/` inside the repo (built-in), or
- `<data dir>/widgets/` (`/var/lib/pidash/data/widgets/` on a Pi, `./data/widgets/` in Docker). This survives upgrades and is the right place for your own widgets.

Restart (`sudo systemctl restart pidash`) and it appears under **Admin → Widgets → Add a widget**. A complete working example is in [`examples/hello-widget`](../examples/hello-widget).

## server.js

```js
exports.meta = {
  type: 'stocks',            // unique id, also the folder's public name
  name: 'Stocks',
  description: 'Watchlist prices.',
  refreshSec: 120,           // how often the display refreshes (results are cached for this long)
  fields: [                  // auto-generates the settings form in the admin
    { key: 'symbols', label: 'Symbols', type: 'text', placeholder: 'AAPL, MSFT' },
    { key: 'apiKey',  label: 'API key', type: 'text', secret: true },
  ],
};

exports.data = async (options, ctx) => {
  // options = this widget instance's saved settings (secrets included, never sent to the browser)
  // ctx.display = global display settings (units, timeFormat, ...)
  const res = await fetch(`https://api.example.com/q?s=${options.symbols}&key=${options.apiKey}`);
  if (!res.ok) throw new Error(`API returned ${res.status}`);   // the message is shown on screen
  return { quotes: await res.json() };                          // any JSON
};
```

**Field types:** `text`, `number`, `textarea`, `checkbox`, `select` (with `options: [{value,label}]`). Add `secret: true` to hide a value after it is saved (API keys, tokens). Optional `placeholder` and `help`.

Omit `exports.data` for a client-only widget (like the clock).

If `data()` throws, the display keeps showing the last good data marked "offline data" and retries shortly. Return a quick result or throw. Keep outbound requests under ~20s (use `AbortSignal.timeout`).

Node 18+ has global `fetch`. You can `require` anything already in `package.json`; for extra npm packages, add them to the repo's `package.json`.

## client.js

```js
Dash.register('stocks', {
  title: 'Markets',          // card header (set chrome:false to hide it)
  render(el, data, ctx) {
    const { h, fmt, options, slot, display } = ctx;
    el.replaceChildren(...data.quotes.map(q => h('div', { class: 'rem' }, q.symbol, ' ', q.price)));
  },
});
```

- `render` is called on every refresh with a fresh `el`; replace its contents each time.
- Build DOM with `h(tag, attrs, ...children)`. It never uses `innerHTML`, so text from the internet can't inject markup. Do the same in your own code.
- `ctx.slot` is `'sidebar'` (small, always visible) or `'rotate'` (the large main panel). Adapt your layout.
- `ctx.fmt` has locale-aware helpers: `time`, `weekday`, `dateLong`, `dateShort`, `dayKey`, `toDate`.
- `ctx.options` has only the non-secret settings.
- Styles: reuse the classes in [`public/dash.css`](../public/dash.css) (`.msg`, `.muted`, `.rem`, `.rss`, ...) or inject your own `<style>` from `client.js`. Colors come from CSS variables (`--text`, `--muted`, `--accent`, `--good`, `--warn`, `--bad`) so your widget follows the light/dark theme.
- A widget that keeps its own timers (like the clock) should stop them when `!el.isConnected`.

## Content fit (sizing)

PiDash scales each widget's contents to its cell so nothing is cut off: down when the cell is small, and up to use spare room (Admin > Display > *Widget content fit*). To take part:

- **Use `calc(N * var(--u))` instead of `rem`** for sizes in CSS (`--u` is 1rem normally; the fitter changes it per widget). A test fails if `dash.css` contains plain `rem`. Percentages, `em`, `px` borders and `vw/vh` are fine.
- Build lists from repeated items and mark each with `'data-fit-item': true` (and the wrapper of a group of items with `'data-fit-group': true`). If the widget still doesn't fit at a readable size, PiDash hides whole trailing items and shows "+N more" instead of cutting a line in half.
- Opt out or tune in `Dash.register`: `fit: false` for widgets that fill their cell themselves (photos/video), or `fit: (options) => ...` to decide per widget instance; `fitMax: 2.5` to let a widget grow larger than the default 1.6x; `fitFloor: 0.8` for list widgets so text stays that large and whole items are hidden instead of shrinking further.
- `replaceChildren()` is patched to ignore `null`/`false` and to accept arrays, so conditional children are safe.
- Anything with `overflow: hidden` that clips content counts as "doesn't fit", so avoid hiding overflow on purpose.

## Tips

- Test your `data()` quickly: `curl localhost:8080/api/widgets/<widget-id>/data`.
- Widget IDs (`stocks-1a2b3c`) are shown in the admin next to each widget.
