# Trainingsschema (app)

A phone-installable workout tracker that replaces the "Trainingsschema" Google Sheet
for day-to-day use. Shows today's workout with a suggested weight per exercise
(same auto-progression logic as the Sheet), lets you log sets/reps with a rest
timer between them, lets you see your history and progress per exercise, lets
you edit your own schema — no hardcoded plan — and includes an AI Coach chat
scoped to sports/krachttraining, fitness and voeding.

Plain HTML/CSS/JS, no framework, no build step. Data lives on the phone
(IndexedDB), so it works with no signal at the gym. Optionally backs up newly
logged sessions to your Google Sheet with a manual "Sync nu" button.

## Backing up your data

Everything lives only on the phone, so Schema → Back-up is what protects it.
"Back-up downloaden" writes one JSON file containing the schema, every logged
session, body metrics and photos (photos travel as data URLs); "Back-up
terugzetten" replaces all of that from such a file — which is also how you move
to a new phone. The Sheet sync is not a substitute: it is one-way and covers
sessions only. Restoring is destructive and asks for confirmation first, and a
file that isn't one of this app's backups is refused rather than applied.

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

- `index.html` — app shell, PWA/iOS meta tags, and the bottom tab bar; views are toggled by JS
- `manifest.json` — PWA manifest (name, icons, standalone display)
- `icons/` — `icon.svg` (rounded, for browsers) and `icon-maskable.svg` (full-bleed, for launcher masks) are the sources; the `.png` files are rendered from them. iOS ignores SVG for the home-screen icon, so `icon-180.png` is what it actually uses. To regenerate after editing a source SVG, render each SVG at 192/512/180px — any SVG-to-PNG tool works, as long as `icon.svg` keeps its transparent corners and the maskable/apple PNGs stay fully opaque.
- `service-worker.js` — caches the app for offline use
- `css/style.css` — mobile-first styling
- `js/storage.js` — IndexedDB wrapper (schema + session log)
- `js/progression.js` — the weight auto-progression rule, ported from the Sheet
- `js/volume-stats.js` — pure aggregation helpers: weekly training volume, split per movement type, and Epley 1RM estimates
- `js/seed.js` — the default schema loaded on first run only (fully editable after)
- `js/schema-editor.js` — the Schema tab: add/edit/delete days and exercises via inline forms, plus the Trainings-, Back-up- and Sync-instellingen sections
- `js/today-view.js` — the Vandaag tab: shows the next workout with last time's sets per exercise, logs a session (with an optional note)
- `js/app-update.js` — offers a reload when the service worker has a new version waiting
- `js/workout-draft.js` — keeps an in-progress workout in localStorage so leaving the tab (or the phone locking) doesn't lose what you typed
- `js/rest-timer.js` — rest timer between sets (starts when a set's reps are filled in; duration set in the Schema tab). Holds a screen wake lock while resting and fires a notification at zero, so locking the phone mid-set doesn't swallow the alert
- `js/history-view.js` — the Geschiedenis tab: past sessions (editable/deletable) + per-exercise progress (SVG sparklines)
- `js/backup.js` — full JSON backup/restore of schema, sessions, body metrics and photos
- `js/sheet-sync.js` — one-way sync (app → Sheet), calls the Apps Script Web App bridge
- `js/ai-chat.js` — AI Coach: API key storage + the streaming call to the Gemini API (parses the SSE response itself)
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
herstel, grounded in your own schema, your last 5 logged sessions and your
last 5 body-metric entries (so it can spot stagnation, judge progression, or
tune nutrition advice to your training volume). It calls the Gemini API
directly from the browser — there's no backend, so this only works because
it's a personal, single-user app:

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com/app/apikey) — no credit card needed, subject to the free tier's daily/rate limits (Flash-tier models only; see [ai.google.dev/gemini-api/docs](https://ai.google.dev/gemini-api/docs) for current limits).
2. Open the AI Coach tab → paste the key under "AI Coach-instellingen" → Opslaan.
3. The key is stored only in this browser's `localStorage` and is sent only to
   `generativelanguage.googleapis.com`. Chat history is stored only in this
   device's IndexedDB. Neither is synced to the Sheet or anywhere else.

The coach stays on-topic (fitness/training/voeding) and refuses medical
diagnoses, deferring injury questions to a doctor or physio instead.

## Why there's no Android APK (Phase 3, deliberately not done)

Earlier plans had wrapping this in [Capacitor](https://capacitorjs.com/) to ship
a real `.apk`. That is on hold on purpose, not forgotten.

For a single user who already installs the PWA to the home screen, an APK adds
almost nothing: the icon, the full-screen launch and the offline cache are
already there. What it *does* add is a build step, `node_modules` and an
`android/` tree in a repo whose whole premise is "no framework, no build step" —
and which doubles as the GitHub Pages deploy source. Building it would also mean
installing Android Studio and the SDK locally.

The one thing a native wrapper would genuinely do better was the rest timer:
lock the phone mid-set and the browser suspends the page, so the chime at zero
never fires. That is now handled directly — a screen wake lock for the duration
of the rest, plus a notification through the service worker — which is most of
the benefit for none of the machinery.

Revisit Capacitor if one of these becomes true: you want it in the Play Store,
you want it usable by people other than yourself, or you need a native API the
web platform can't reach (true background scheduling, health-app integration).

See `plans/explore-2026-08-28-trainingsapp.md` in the workspace root for the full
roadmap and reasoning behind these choices.
