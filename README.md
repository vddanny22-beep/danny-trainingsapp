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

**Live at: https://vddanny22-beep.github.io/danny-trainingsapp/**

GitHub Pages doesn't support private repos on the free plan, so this app is
deployed from a separate **public** repo — code only, no personal data —
rather than from this (private) workspace repo:
[github.com/vddanny22-beep/danny-trainingsapp](https://github.com/vddanny22-beep/danny-trainingsapp).

To redeploy after changing files here in `apps/trainingsapp/`: copy the changed
files into a checkout of that repo's `main` branch, commit, and push — GitHub
Pages picks up the update automatically within a minute or two.

To install on Android: open the live URL above in Chrome, tap the menu, then
**"Add to Home screen"** (or Chrome may prompt this automatically). This installs
it with its own icon, launching full-screen like a real app.

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
