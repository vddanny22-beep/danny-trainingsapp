# Trainingsschema (app)

A phone-installable workout tracker that replaces the "Trainingsschema" Google Sheet
for day-to-day use. Shows today's workout with a suggested weight per exercise
(same auto-progression logic as the Sheet), lets you log sets/reps, and lets you
edit your own schema — no hardcoded plan.

Phase 1 build: plain HTML/CSS/JS, no framework, no build step. Data lives on the
phone (IndexedDB), so it works with no signal at the gym.

## Running it locally

Service workers and ES modules require the page to be served over `http://` or
`https://` — opening `index.html` directly (`file://`) will not work correctly.

From this folder, any static file server works, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Deploying (for installing on your phone)

To install it as an app on Android, it needs a stable HTTPS URL. The simplest
option is GitHub Pages, using the GitHub account already set up for this workspace:

1. In the repo settings on GitHub, enable Pages for this repository, serving from
   the `main` branch, folder `/apps/trainingsapp` (or move/copy this folder to a
   dedicated `gh-pages` branch/root if GitHub Pages doesn't support a subfolder
   for your setup — check current GitHub Pages settings, this has changed over time).
2. Once published, open the resulting URL on your Android phone in Chrome.
3. Tap the browser menu, then **"Add to Home screen"** (or Chrome may prompt this
   automatically). This installs it with its own icon, launching full-screen like
   a real app.

## What's in here

- `index.html` — app shell, two views (Today / Schema) toggled by JS
- `manifest.json` — PWA manifest (name, icons, standalone display)
- `service-worker.js` — caches the app for offline use
- `css/style.css` — mobile-first styling
- `js/storage.js` — IndexedDB wrapper (schema + session log)
- `js/progression.js` — the weight auto-progression rule, ported from the Sheet
- `js/seed.js` — the default schema loaded on first run only (fully editable after)
- `js/schema-editor.js` — the Schema tab: add/edit/delete days and exercises
- `js/today-view.js` — the Today tab: shows the next workout, logs a session
- `js/app.js` — wires everything together on page load

## What's next (not built yet)

- **Phase 2:** history/log view, two-way sync with the Google Sheet
- **Phase 3:** wrap with [Capacitor](https://capacitorjs.com/) to produce a real
  installable/publishable Android `.apk`, then Play Store prep

See `plans/explore-2026-08-28-trainingsapp.md` in the workspace root for the full
roadmap and reasoning behind these choices.
