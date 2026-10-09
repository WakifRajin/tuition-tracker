import * as store from "../store.js";
import { html, CURRENCIES, formatMoney, plural } from "../lib/format.js";
import { icon, setHTML, $ } from "../ui/dom.js";
import { getTheme, setTheme } from "../ui/theme.js";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const APP_VERSION = "4.0.0";

export const settingsView = {
  title: "Settings",
  mount(root) {
    this.root = root;
    const theme = getTheme();
    setHTML(
      root,
      html`<div class="page-head"><div><h1>Settings</h1><div class="sub">Preferences, account and your data</div></div></div>
        <div class="grid-2">
          <section class="card" aria-labelledby="pref-title">
            <div class="card-head"><h2 id="pref-title">${icon("settings")}Preferences</h2></div>
            <div class="setting">
              <div><div class="label" id="theme-label">Appearance</div><div class="desc">Follow your device or pick one</div></div>
              <div class="seg" role="radiogroup" aria-labelledby="theme-label">
                ${[
                  ["system", "System"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ].map(([v, l]) => html`<label><input type="radio" name="theme" value="${v}" ${theme === v ? "checked" : ""} />${l}</label>`)}
              </div>
            </div>
            <div class="setting">
              <div><label class="label" for="pref-currency">Currency</label><div class="desc" id="currency-example"></div></div>
              <select class="input" id="pref-currency">
                ${CURRENCIES.map((c) => html`<option value="${c.code}">${c.code} — ${c.label}</option>`)}
              </select>
            </div>
            <div class="setting">
              <div><label class="label" for="pref-duration">Default class length</label><div class="desc">Pre-filled when logging a class</div></div>
              <select class="input" id="pref-duration">
                ${[30, 45, 60, 75, 90, 120, 150, 180].map((m) => html`<option value="${m}">${m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`}</option>`)}
              </select>
            </div>
            <div class="setting">
              <div><label class="label" for="pref-weekstart">Week starts on</label><div class="desc">Calendar layout and weekly billing</div></div>
              <select class="input" id="pref-weekstart">
                ${[6, 0, 1].map((d) => html`<option value="${d}">${WEEKDAY_NAMES[d]}</option>`)}
              </select>
            </div>
          </section>

          <section class="card" aria-labelledby="acct-title">
            <div class="card-head"><h2 id="acct-title">${icon("cloud")}Account &amp; sync</h2></div>
            <div id="account-info"></div>
          </section>

          <section class="card" aria-labelledby="data-title">
            <div class="card-head"><h2 id="data-title">${icon("download")}Your data</h2></div>
            <p class="small muted" style="margin-bottom:12px" id="data-summary"></p>
            <div class="grid" style="gap:8px">
              <button type="button" class="btn" data-action="export-json">${icon("download")}Download full backup (JSON)</button>
              <button type="button" class="btn" data-action="export-csv" data-kind="sessions">${icon("file")}Export classes (CSV)</button>
              <button type="button" class="btn" data-action="export-csv" data-kind="payments">${icon("file")}Export payments (CSV)</button>
              <button type="button" class="btn" data-action="import-json">${icon("upload")}Restore from backup…</button>
            </div>
            <p class="small muted" style="margin-top:10px">Restoring merges the backup into your current data; nothing is deleted.</p>
          </section>

          <section class="card" aria-labelledby="danger-title">
            <div class="card-head"><h2 id="danger-title" style="color:var(--danger)">${icon("alert")}Danger zone</h2></div>
            <p class="small muted" style="margin-bottom:12px">Permanently delete every student, class and payment${store.state.account?.mode === "cloud" ? " from all your devices" : " on this device"}. Download a backup first.</p>
            <button type="button" class="btn outline-danger" data-action="clear-all">${icon("trash")}Delete all data</button>
          </section>

          <section class="card span-2" aria-labelledby="about-title">
            <div class="card-head"><h2 id="about-title">${icon("info")}About</h2></div>
            <p class="small" style="color:var(--text-2)">
              <strong>TuitionPro</strong> v${APP_VERSION} · for private tutors and teachers.<br />
              Works offline and installs like an app: use your browser's “Install” or “Add to Home Screen”.<br />
              Shortcuts: <kbd>Ctrl</kbd> <kbd>K</kbd> search · <kbd>N</kbd> log a class.<br />
              Made with ${icon("heart")} by <a href="https://github.com/WakifRajin" target="_blank" rel="noopener noreferrer">Wakif Rajin</a>.
            </p>
          </section>
        </div>`,
    );

    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.name === "theme") setTheme(t.value);
      else if (t.id === "pref-currency") store.saveSettings({ currency: t.value });
      else if (t.id === "pref-duration") store.saveSettings({ defaultDuration: Number(t.value) });
      else if (t.id === "pref-weekstart") store.saveSettings({ weekStart: Number(t.value) });
    });
    this.update();
  },
  update() {
    const { settings, account } = store.state;
    const r = this.root;
    $("#pref-currency", r).value = settings.currency;
    const dur = $("#pref-duration", r);
    if (![...dur.options].some((o) => Number(o.value) === settings.defaultDuration)) {
      dur.append(new Option(`${settings.defaultDuration} minutes`, settings.defaultDuration));
    }
    dur.value = String(settings.defaultDuration);
    const wsSel = $("#pref-weekstart", r);
    if (![...wsSel.options].some((o) => Number(o.value) === settings.weekStart)) {
      wsSel.append(new Option(WEEKDAY_NAMES[settings.weekStart], settings.weekStart));
    }
    wsSel.value = String(settings.weekStart);
    $("#currency-example", r).textContent = `e.g. ${formatMoney(1250.5, settings.currency)}`;

    const s = store.state;
    $("#data-summary", r).textContent = `${plural(s.students.size, "student")}, ${plural(s.sessions.size, "class", "classes")} and ${plural(s.payments.size, "payment")}.`;

    const status = {
      synced: "All changes are saved to the cloud.",
      syncing: "Saving changes to the cloud…",
      offline: "You're offline. Changes are saved on this device and will sync when you reconnect.",
      error: s.syncError || "Sync problem.",
      local: "",
    }[s.syncStatus];

    setHTML(
      $("#account-info", r),
      account?.mode === "cloud"
        ? html`<p style="margin-bottom:4px">Signed in as <strong>${account.email || account.name}</strong></p>
            <p class="small muted" style="margin-bottom:14px">${status}</p>
            <button type="button" class="btn" data-action="sign-out">${icon("logout")}Sign out</button>`
        : html`<p style="margin-bottom:4px"><strong>Using TuitionPro without an account</strong></p>
            <p class="small muted" style="margin-bottom:14px">Your data is stored only in this browser. Sign in to back it up and use it on other devices — you'll be offered to move this data into your account.</p>
            <button type="button" class="btn primary" data-action="sign-in">${icon("login")}Sign in or create account</button>`,
    );
  },
};

