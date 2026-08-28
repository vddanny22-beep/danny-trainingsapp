# Trainingsschema (app)

A phone-installable workout tracker that replaces the "Trainingsschema" Google Sheet
for day-to-day use. Shows today's workout with a suggested weight per exercise
(same auto-progression logic as the Sheet), lets you log sets/reps, lets you see
your history and progress per exercise, lets you edit your own schema — no
hardcoded plan — and includes an AI Coach chat scoped to sports/krachttraining,
fitness and voeding.

Plain HTML/CSS/JS, no framework, no build step. Data lives on the phone
(IndexedDB), so it works with no signal at the gym. Optionally backs up newly
logged sessions to your Google Sheet with a manual "Sync nu" button.

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

- `index.html` — app shell, three views (Vandaag / Geschiedenis / Schema) toggled by JS
- `manifest.json` — PWA manifest (name, icons, standalone display)
- `service-worker.js` — caches the app for offline use
- `css/style.css` — mobile-first styling
- `js/storage.js` — IndexedDB wrapper (schema + session log)
- `js/progression.js` — the weight auto-progression rule, ported from the Sheet
- `js/seed.js` — the default schema loaded on first run only (fully editable after)
- `js/schema-editor.js` — the Schema tab: add/edit/delete days and exercises, plus the Sync-instellingen section
- `js/today-view.js` — the Vandaag tab: shows the next workout, logs a session
- `js/history-view.js` — the Geschiedenis tab: past sessions + per-exercise progress (SVG sparklines)
- `js/sheet-sync.js` — one-way sync (app → Sheet), calls the Apps Script Web App bridge
- `js/ai-chat.js` — AI Coach: API key storage + the call to the Anthropic API
- `js/chat-view.js` — the AI Coach tab: chat UI, persists history to IndexedDB
- `js/app.js` — wires everything together on page load
- `sheet-sync/AppsScript.gs` — reference code Danny pastes into his Sheet's Apps Script editor to receive synced rows (one-time setup, instructions in the file's header comment)

## Setting up Sheet sync (optional, one-time)

1. Open the "Trainingsschema" Google Sheet → Extensions → Apps Script.
2. Paste in the contents of `sheet-sync/AppsScript.gs`.
3. Deploy → New deployment → type "Web app" → Execute as "Me", access "Anyone with the link".
4. Copy the deployment URL into the app's Schema tab → Sync-instellingen → paste → Opslaan.
5. Press "Sync nu" any time to push newly logged sessions to a new "App Log" tab in the Sheet — your existing Trainingslog tab and its formulas are never touched.

## Setting up the AI Coach (optional)

The AI Coach tab answers questions about krachttraining, sporten, voeding en
herstel, grounded in your own schema. It calls the Anthropic API directly from
the browser — there's no backend, so this only works because it's a personal,
single-user app:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com/) (this uses paid API credits, not a Claude.ai subscription).
2. Open the AI Coach tab → paste the key under "AI Coach-instellingen" → Opslaan.
3. The key is stored only in this browser's `localStorage` and is sent only to
   `api.anthropic.com`. Chat history is stored only in this device's
   IndexedDB. Neither is synced to the Sheet or anywhere else.

The coach stays on-topic (fitness/training/voeding) and refuses medical
diagnoses, deferring injury questions to a doctor or physio instead.

## What's next (not built yet)

- **Phase 3:** wrap with [Capacitor](https://capacitorjs.com/) to produce a real
  installable/publishable Android `.apk`, then Play Store prep

See `plans/explore-2026-08-28-trainingsapp.md` in the workspace root for the full
roadmap and reasoning behind these choices.
