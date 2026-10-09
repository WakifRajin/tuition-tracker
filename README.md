# TuitionPro — tuition tracker for tutors

Track the classes you teach, what each student owes, and what you've been paid. Works offline, installs like an app, and syncs across devices when you sign in.

**Live:** https://wakifrajin.github.io/tuition-tracker/

## Features

- **Students** with class/level, subjects, guardian, phone, notes, colour tag, monthly class target, and archive (keeps history).
- **Three billing models** per student: per class, weekly (billed once per week with a class) or monthly (once per month with a class).
- **Class log** with date, duration presets, topic suggestions and notes. A per-class fee is snapshotted when you log, so changing a rate never rewrites past bills.
- **Payments** with method (cash, bKash, Nagad, bank, card), smart amount presets, and automatic allocation to the oldest unpaid classes. "Paid at this class" records a payment tied to that class.
- **Dues at a glance:** outstanding balance, advance credit, per-class paid/part-paid/unpaid status, and a one-tap payment reminder you can paste into SMS/WhatsApp.
- **Dashboard:** this month's classes, billed, received and outstanding; quick-log chips; "needs attention" (dues and students behind their monthly target); calendar with per-student dots and day details.
- **Insights:** billed vs received, classes per month, busiest weekdays, per-student breakdown and top topics over 3/6/12 months.
- **Search** everything with <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> (or <kbd>/</kbd>); press <kbd>N</kbd> to log a class.
- **Undo** for deleted classes, payments and students.
- **Backups:** full JSON backup/restore (restore merges, never deletes) and CSV export of classes and payments for Excel/Sheets.
- **Offline-first PWA:** installable, works without a connection; signed-in data syncs automatically when you're back online.
- Light/dark/system theme, 16 currencies, configurable week start (Saturday/Sunday/Monday) and default class length.
- Accessible: semantic HTML, native `<dialog>`s, keyboard navigation, screen-reader friendly charts (each has a data table), respects reduced motion.

## Project layout

No build step — plain ES modules served as static files.

```
index.html              App shell, auth screen and dialogs
css/app.css             Design tokens (light + dark), layout, components
js/app.js               Boot, auth flow, routing, global actions, PWA updates
js/store.js             In-memory state, selectors, mutations, undo
js/backends/local.js    localStorage backend (+ migration from v2/v3)
js/backends/firebase.js Firebase auth + Firestore backend (+ cloud migration)
js/lib/                 Pure logic: dates, money/HTML formatting, billing, data model
js/ui/                  DOM helpers, dialogs/forms, charts, search, theme
js/views/               Dashboard, students, student detail, insights, settings
sw.js                   Service worker (offline shell, cached Firebase SDK)
firestore.rules         Security rules for the cloud data
tests/                  Unit tests for the pure logic (node:test)
```

## Develop

Requires Node 20+ (only for the dev server and tests).

```bash
npm start      # serves the app at http://localhost:5173
npm test       # runs unit tests
```

Service workers cache aggressively; during development use DevTools → Application → "Update on reload", or a private window.

## Data model and sync

| Where          | Path                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| Signed in      | Firestore `users/{uid}` (settings) and `users/{uid}/{students,sessions,payments}/{id}` |
| No account     | `localStorage["tuitionpro.v4.local"]`                                       |
| Theme (device) | `localStorage["tuitionpro.theme"]`                                          |

Each record is its own Firestore document, so edits from different devices merge cleanly, and Firestore's offline cache queues changes made without a connection.

**Migration from v3** happens automatically:

- Cloud: on first sign-in, the old `users/{uid}.appData` blob is copied into the subcollections. The original blob is left untouched as a backup.
- Device: data under `tuitionData_v2` / `tuitionPrefs` is converted the first time you open the app without an account.
- Data saved without an account can be added to your account after you sign in (you'll be asked).

## Deploying

The app is hosted on GitHub Pages straight from the repository root.

> **Deploy the Firestore rules before (or together with) the new app.** The data now lives in subcollections, which older rules written for a single `users/{uid}` document usually don't allow. Without the updated rules, signed-in users will see "Sync error" (their changes are still kept on the device).

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

Or paste `firestore.rules` into Firebase Console → Firestore Database → Rules → Publish.

For Google sign-in, make sure your Pages domain (e.g. `wakifrajin.github.io`) is listed under Firebase Console → Authentication → Settings → Authorized domains.

When you change the list of files in `js/` or `css/`, update the `SHELL` list and bump `VERSION` in `sw.js` so installed apps pick up the new version.
