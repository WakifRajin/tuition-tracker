// Entry point: boot, auth, routing and global actions.
import * as store from "./store.js";
import { LocalBackend, readLocalData, clearLocalData } from "./backends/local.js";
import { loadFirebase, createAuth, CloudBackend, authErrorMessage } from "./backends/firebase.js";
import { parseBackup, buildBackup } from "./lib/model.js";
import { html, initials, plural, toCsv, formatDuration } from "./lib/format.js";
import { formatDate, todayISO } from "./lib/dates.js";
import { reminderMessage } from "./lib/billing.js";
import { $, $$, setHTML, toast, toastError, confirmDialog, openDialog, download, copyText, icon } from "./ui/dom.js";
import { initForms, openStudentForm, openSessionForm, openPaymentForm, refreshCurrency } from "./ui/forms.js";
import { initSearch, openSearch } from "./ui/search.js";
import { initTheme } from "./ui/theme.js";
import { dashboardView } from "./views/dashboard.js";
import { studentsView, studentDetailView } from "./views/students.js";
import { analyticsView } from "./views/analytics.js";
import { settingsView } from "./views/settings.js";
import { money, sessionRow } from "./views/common.js";

const MODE_KEY = "tuitionpro.mode";
const DISMISS_UPLOAD_KEY = "tuitionpro.localUploadDismissed";

let fb = null;
let auth = null;
let authListening = false;
let started = false;

const storage = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  remove(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

// ================================================================ routing

const routes = [
  { re: /^#?\/?$/, view: dashboardView, nav: "dashboard" },
  { re: /^#\/students\/?$/, view: studentsView, nav: "students" },
  { re: /^#\/students\/([^/]+)$/, view: studentDetailView, nav: "students", params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { re: /^#\/analytics\/?$/, view: analyticsView, nav: "analytics" },
  { re: /^#\/settings\/?$/, view: settingsView, nav: "settings" },
];

let current = null;
let firstRoute = true;

function route() {
  const hash = location.hash || "#/";
  const match = routes.map((r) => ({ r, m: r.re.exec(hash) })).find((x) => x.m);
  if (!match) {
    location.replace("#/");
    return;
  }
  const { r, m } = match;
  const root = document.createElement("div");
  $("#view").replaceChildren(root);
  current = { view: r.view, params: r.params ? r.params(m) : {} };
  r.view.mount(root, current.params);
  document.title = `${r.view.titleText || r.view.title} · TuitionPro`;
  $$(".nav a[data-nav]").forEach((a) => {
    if (a.dataset.nav === r.nav) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (!firstRoute) {
    window.scrollTo({ top: 0 });
    $("#main").focus({ preventScroll: true });
  }
  firstRoute = false;
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ================================================================ rendering

let frame = 0;
function onStoreChange() {
  if (!started) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    current?.view.update();
    renderChrome();
  });
}

const SYNC_LABELS = { local: "On this device", synced: "Synced", syncing: "Saving…", offline: "Offline", error: "Sync error" };

function renderChrome() {
  const { syncStatus, syncError, account } = store.state;
  const pill = $("#sync-pill");
  pill.dataset.status = syncStatus;
  pill.textContent = SYNC_LABELS[syncStatus] || "";
  pill.title =
    syncStatus === "local"
      ? "Data is stored only in this browser"
      : syncStatus === "offline"
        ? "Changes are saved and will sync when you're back online"
        : syncError || "";

  const banner = $("#banner-slot");
  if (syncStatus === "error") {
    setHTML(banner, html`<div class="banner error" role="alert">${icon("alert")}<span class="grow">${syncError || "Couldn't sync with the cloud."} Your changes are kept on this device.</span></div>`);
  } else banner.replaceChildren();

  const name = account?.name || account?.email || (account?.mode === "local" ? "Local" : "?");
  $("#avatar-btn").textContent = initials(name);
  $("#menu-name").textContent = account?.mode === "cloud" ? account.name || "Signed in" : "Not signed in";
  $("#menu-email").textContent = account?.mode === "cloud" ? account.email || "" : "Data saved on this device only";
  $("#menu-signin").hidden = account?.mode === "cloud";
  $("#menu-signout").hidden = account?.mode !== "cloud";
  refreshCurrency();
}

// ================================================================ screens

function hideSplash() {
  $("#splash").hidden = true;
}

function showApp() {
  hideSplash();
  $("#auth-screen").hidden = true;
  $("#app").hidden = false;
  if (!started) {
    started = true;
    route();
  } else current?.view.update();
  renderChrome();
}

function showAuth({ error = null, info = null } = {}) {
  hideSplash();
  $("#app").hidden = true;
  $("#auth-screen").hidden = false;
  setAuthMessage(error, info);
  requestAnimationFrame(() => $("#auth-email").focus());
}

function setAuthMessage(error, info) {
  const e = $("#auth-error");
  const i = $("#auth-info");
  e.hidden = !error;
  i.hidden = !info;
  if (error) setHTML(e, html`${icon("alert")}<span>${error}</span>`);
  if (info) setHTML(i, html`${icon("info")}<span>${info}</span>`);
}

// ================================================================ backends

async function startLocal() {
  storage.set(MODE_KEY, "local");
  store.state.account = { mode: "local", name: "", email: "" };
  store.state.userName = "";
  await store.useBackend(new LocalBackend());
  navigator.storage?.persist?.().catch(() => {});
  showApp();
}

async function startCloud(user) {
  storage.set(MODE_KEY, "cloud");
  store.state.account = { mode: "cloud", name: user.displayName || "", email: user.email || "", uid: user.uid };
  store.state.userName = user.displayName || "";
  const backend = new CloudBackend(fb, user);
  try {
    await store.useBackend(backend);
  } catch (err) {
    console.error(err);
    toastError("Couldn't load your data from the cloud.");
  }
  showApp();
  offerLocalUpload(backend, user).catch((err) => console.error(err));
}

/** After signing in, offer to move data that was saved without an account. */
async function offerLocalUpload(backend, user) {
  const local = readLocalData();
  if (!local.students.length) return;
  if (storage.get(DISMISS_UPLOAD_KEY) === user.uid) return;
  if (!(await backend.waitForServer())) return;
  // Only records the account doesn't have yet; never overwrite newer cloud copies.
  const missing = {
    students: local.students.filter((r) => !store.state.students.has(r.id)),
    sessions: local.sessions.filter((r) => !store.state.sessions.has(r.id)),
    payments: local.payments.filter((r) => !store.state.payments.has(r.id)),
  };
  const total = missing.students.length + missing.sessions.length + missing.payments.length;
  if (!total) {
    // Everything is already in the account (e.g. a cached copy from an earlier version).
    clearLocalData();
    return;
  }
  const ok = await confirmDialog({
    title: "Add this device's data to your account?",
    message: `This browser has ${plural(missing.students.length, "student")}, ${plural(missing.sessions.length, "class", "classes")} and ${plural(missing.payments.length, "payment")} that aren't in your account yet. Add them to ${user.email || "your account"} so they sync everywhere?`,
    confirmLabel: "Add to my account",
    tone: "info",
    iconName: "cloud",
  });
  if (ok) {
    await store.importRecords(missing);
    clearLocalData();
    toast(`Added ${plural(total, "record")} to your account`);
  } else {
    storage.set(DISMISS_UPLOAD_KEY, user.uid);
  }
}

async function ensureAuth() {
  if (auth) return auth;
  fb = await loadFirebase();
  auth = createAuth(fb);
  return auth;
}

function listenForAuth({ showAuthWhenSignedOut }) {
  if (authListening) return;
  authListening = true;
  auth.checkRedirect().catch((err) => {
    const msg = authErrorMessage(err);
    if (msg) showAuth({ error: msg });
  });
  auth.onChange((user) => {
    if (user) {
      if (store.state.account?.uid === user.uid) return;
      startCloud(user);
    } else if (showAuthWhenSignedOut()) {
      showAuth();
    }
  });
}

// ================================================================ auth form

let authMode = "signin";

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("#tab-signin").setAttribute("aria-selected", String(!signup));
  $("#tab-signup").setAttribute("aria-selected", String(signup));
  $$("[data-signup]").forEach((el) => (el.hidden = !signup));
  $$("[data-signin]").forEach((el) => (el.hidden = signup));
  const pw = $("#auth-password");
  pw.autocomplete = signup ? "new-password" : "current-password";
  pw.minLength = signup ? 8 : 6;
  $("#auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("#auth-lede").textContent = signup
    ? "Create a free account to back up your data and use it on all your devices."
    : "Sign in to keep your classes and payments in sync across devices.";
  setAuthMessage(null, null);
}

function setAuthBusy(busy) {
  $$("#auth-screen button, #auth-screen input").forEach((el) => (el.disabled = busy));
  if (busy) setHTML($("#auth-submit"), html`<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>Please wait…`);
  else $("#auth-submit").textContent = authMode === "signup" ? "Create account" : "Sign in";
}

async function withAuth(fn) {
  setAuthMessage(null, null);
  setAuthBusy(true);
  try {
    const a = await ensureAuth();
    listenForAuth({ showAuthWhenSignedOut: () => false });
    await fn(a);
  } catch (err) {
    const msg = err?.message === "Timed out loading sign-in" || err instanceof TypeError ? "Couldn't reach the sign-in service. Check your connection." : authErrorMessage(err);
    if (msg) setAuthMessage(msg, null);
  } finally {
    setAuthBusy(false);
  }
}

function initAuthForm() {
  $("#auth-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const email = form.email.value.trim();
    const password = form.password.value;
    const name = form.name.value.trim();
    withAuth(async (a) => {
      if (authMode !== "signup") return a.signIn(email, password);
      await a.signUp(email, password, name);
      // The auth listener fires before the display name is saved; fill it in now.
      if (name && store.state.account?.mode === "cloud") {
        store.state.account.name = name;
        store.state.userName = name;
        renderChrome();
        current?.view.update();
      }
    });
  });
}

// ================================================================ actions

function removeWithUndo(items, message) {
  const removed = store.removeRecords(items);
  if (!removed.length) return;
  toast(message, { action: { label: "Undo", onClick: () => store.restore(removed).then(() => toast("Restored")) } });
}

function openDay(date) {
  const sessions = store.allSessions().filter((s) => s.date === date);
  $("#day-dialog-title").textContent = formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const minutes = sessions.reduce((t, s) => t + s.duration, 0);
  setHTML(
    $("#day-dialog-body"),
    sessions.length
      ? html`<p class="small muted" style="margin-bottom:6px">${plural(sessions.length, "class", "classes")} · ${formatDuration(minutes)}</p>
          <ul class="list">${sessions.map((s) => sessionRow(s, { showStudent: true, actions: true }))}</ul>`
      : html`<p class="muted" style="padding:8px 0 16px">No classes on this day.</p>`,
  );
  $("#day-dialog-log").onclick = () => {
    $("#day-dialog").close();
    openSessionForm({ date });
  };
  openDialog($("#day-dialog"));
}

function stamp() {
  return todayISO();
}

function exportJSON() {
  const backup = buildBackup(store.snapshot(), store.state.settings);
  download(`tuitionpro-backup-${stamp()}.json`, JSON.stringify(backup, null, 2), "application/json");
  toast("Backup downloaded");
}

function exportCSV(kind) {
  const name = (id) => store.getStudent(id)?.name || "";
  let rows;
  if (kind === "sessions") {
    const statusOf = new Map();
    for (const st of store.listStudents({ archived: "all" })) for (const [id, s] of store.summaryFor(st).sessionStatus) statusOf.set(id, s);
    rows = [["Date", "Student", "Minutes", "Topic", "Notes", "Fee", "Status"]];
    for (const s of store.allSessions()) rows.push([s.date, name(s.studentId), s.duration, s.subject, s.notes, s.fee ?? "", statusOf.get(s.id) || ""]);
  } else {
    rows = [["Date", "Student", "Amount", "Method", "Note"]];
    for (const p of store.allPayments()) rows.push([p.date, name(p.studentId), p.amount, p.method, p.note]);
  }
  // BOM so Excel opens UTF-8 (e.g. Bangla names) correctly.
  download(`tuitionpro-${kind === "sessions" ? "classes" : "payments"}-${stamp()}.csv`, "﻿" + toCsv(rows), "text/csv;charset=utf-8");
  toast(`Exported ${plural(rows.length - 1, kind === "sessions" ? "class" : "payment", kind === "sessions" ? "classes" : "payments")}`);
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    toastError("That file is too large to be a TuitionPro backup.");
    return;
  }
  let data;
  try {
    data = parseBackup(await file.text());
  } catch (err) {
    toastError(err.message);
    return;
  }
  const ok = await confirmDialog({
    title: "Restore this backup?",
    message: `Adds ${plural(data.students.length, "student")}, ${plural(data.sessions.length, "class", "classes")} and ${plural(data.payments.length, "payment")}. Records that already exist are updated to the backup's version; nothing else is removed.`,
    confirmLabel: "Restore",
    tone: "info",
    iconName: "upload",
  });
  if (!ok) return;
  await store.importRecords(data);
  toast("Backup restored");
}

async function signOut() {
  const unsynced = store.state.syncStatus === "syncing" || store.state.syncStatus === "offline";
  const ok = await confirmDialog({
    title: "Sign out?",
    message: unsynced
      ? "Some changes haven't reached the cloud yet and will be lost if you sign out now. Reconnect and wait for “Synced” first."
      : "Your data stays safe in your account. It will be removed from this browser.",
    confirmLabel: "Sign out",
    iconName: "logout",
  });
  if (!ok) return;
  try {
    await auth?.signOut();
  } finally {
    storage.remove(MODE_KEY);
    location.reload();
  }
}

async function startSignIn() {
  $("#account-menu").hidePopover?.();
  storage.remove(MODE_KEY);
  showAuth({ info: "Sign in or create an account. Data saved on this device can be added to your account afterwards." });
  setAuthMode("signin");
}

const actions = {
  "log-class": (el) => {
    const studentId = el.dataset.student || (current?.view === studentDetailView ? current.params.id : null);
    openSessionForm({ studentId: store.getStudent(studentId) ? studentId : null });
  },
  "add-student": () => openStudentForm(),
  "edit-student": (el) => openStudentForm(el.dataset.id),
  "record-payment": (el) => openPaymentForm(el.dataset.student),
  "edit-session": (el) => {
    $("#day-dialog").close();
    openSessionForm({ sessionId: el.dataset.id });
  },
  "delete-session": (el) => {
    $("#day-dialog").close();
    removeWithUndo([{ kind: "sessions", id: el.dataset.id }], "Class deleted");
  },
  "edit-payment": (el) => {
    const p = store.state.payments.get(el.dataset.id);
    if (p) openPaymentForm(p.studentId, p.id);
  },
  "delete-payment": (el) => removeWithUndo([{ kind: "payments", id: el.dataset.id }], "Payment deleted"),
  "delete-student": async (el) => {
    const s = store.getStudent(el.dataset.id);
    if (!s) return;
    const ok = await confirmDialog({
      title: `Delete ${s.name}?`,
      message: `This deletes ${s.name} along with ${plural(store.sessionsFor(s.id).length, "class", "classes")} and ${plural(store.paymentsFor(s.id).length, "payment")}. If you just stopped teaching them, archive instead to keep their history.`,
      confirmLabel: "Delete student",
      iconName: "trash",
    });
    if (!ok) return;
    navigate("#/students");
    removeWithUndo([{ kind: "students", id: s.id }], `${s.name} deleted`);
  },
  "toggle-archive": (el) => {
    const s = store.getStudent(el.dataset.id);
    if (!s) return;
    store.setStudentArchived(s.id, !s.archived);
    toast(s.archived ? `${s.name} is active again` : `${s.name} archived`, {
      action: { label: "Undo", onClick: () => store.setStudentArchived(s.id, s.archived) },
    });
  },
  "copy-reminder": async (el) => {
    const s = store.getStudent(el.dataset.id);
    if (!s) return;
    const text = reminderMessage({ student: s, summary: store.summaryFor(s), formatMoney: money, tutorName: store.state.userName });
    if (await copyText(text)) toast("Reminder copied — paste it into SMS or WhatsApp");
    else toastError("Couldn't copy to the clipboard");
  },
  "open-day": (el) => openDay(el.dataset.date),
  "open-search": () => openSearch(),
  "export-json": () => {
    $("#account-menu").hidePopover?.();
    exportJSON();
  },
  "export-csv": (el) => exportCSV(el.dataset.kind),
  "import-json": () => $("#import-file").click(),
  "clear-all": async () => {
    const ok = await confirmDialog({
      title: "Delete all data?",
      message: `This permanently deletes ${plural(store.state.students.size, "student")}, ${plural(store.state.sessions.size, "class", "classes")} and ${plural(store.state.payments.size, "payment")}. This can't be undone.`,
      confirmLabel: "Delete everything",
      typeToConfirm: "DELETE",
      iconName: "trash",
    });
    if (!ok) return;
    await store.clearAll();
    toast("All data deleted");
    navigate("#/");
  },
  "sign-in": () => startSignIn(),
  "sign-out": () => {
    $("#account-menu").hidePopover?.();
    signOut();
  },
  "close-menu": () => $("#account-menu").hidePopover?.(),
  "use-local": () => startLocal(),
  "auth-mode": (el) => setAuthMode(el.dataset.mode),
  "toggle-password": (el) => {
    const pw = $("#auth-password");
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    el.setAttribute("aria-pressed", String(show));
    el.setAttribute("aria-label", show ? "Hide password" : "Show password");
  },
  "google-signin": () => withAuth((a) => a.signInWithGoogle()),
  "reset-password": () => {
    const email = $("#auth-email").value.trim();
    if (!email || !$("#auth-email").checkValidity()) {
      setAuthMessage("Enter your email above, then choose “Forgot password?”.", null);
      $("#auth-email").focus();
      return;
    }
    withAuth(async (a) => {
      await a.resetPassword(email);
      setAuthMessage(null, `If an account exists for ${email}, a reset link is on its way. Check your inbox and spam folder.`);
    });
  },
};

function initActions() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === "A" && el.dataset.action !== "close-menu") e.preventDefault();
    fn(el, e);
  });
  $("#import-file").addEventListener("change", (e) => {
    importFile(e.target.files[0]);
    e.target.value = "";
  });

  document.addEventListener("keydown", (e) => {
    if ($("#app").hidden || document.querySelector("dialog[open]")) return;
    const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
    if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
      e.preventDefault();
      openSearch();
    } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      actions["log-class"]({ dataset: {} });
    }
  });
}

// ================================================================ PWA

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      const prompt = (worker) =>
        toast("A new version of TuitionPro is ready", {
          duration: 24 * 3600 * 1000,
          action: { label: "Update", onClick: () => worker.postMessage({ type: "SKIP_WAITING" }) },
        });
      if (reg.waiting && hadController) prompt(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) prompt(w);
        });
      });
      // Check for updates when the app comes back to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn("Service worker registration failed", err));
}

// ================================================================ boot

async function boot() {
  initTheme();
  initForms({ navigate });
  initSearch({ navigate });
  initActions();
  initAuthForm();
  setAuthMode("signin");
  store.onWriteError((err) => toastError(err?.message || "Couldn't save your change."));
  store.subscribe(onStoreChange);
  window.addEventListener("hashchange", () => started && route());
  registerServiceWorker();

  if (storage.get(MODE_KEY) === "local") {
    await startLocal();
    return;
  }

  try {
    await ensureAuth();
  } catch (err) {
    console.warn(err);
    showAuth({ error: "Couldn't reach the sign-in service. Check your connection, or use TuitionPro without an account." });
    return;
  }
  listenForAuth({ showAuthWhenSignedOut: () => !started });
}

boot().catch((err) => {
  console.error(err);
  hideSplash();
  toastError("Something went wrong while starting. Please reload.");
});
