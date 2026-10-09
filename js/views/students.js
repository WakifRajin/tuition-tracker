import * as store from "../store.js";
import { html, plural, formatNumber } from "../lib/format.js";
import { monthKey, relativeDay, todayISO, monthLabel, weekStartOf, addDays, formatDate } from "../lib/dates.js";
import { CYCLE_LABELS, currentStreak } from "../lib/billing.js";
import { barChart, rankedBars } from "../ui/charts.js";
import { icon, setHTML, $ } from "../ui/dom.js";
import { money, avatar, emptyState, sessionRow, paymentRow, studentHref, balanceBadge } from "./common.js";

// ================================================================ list

const listState = { q: "", archived: false, sort: "name" };

function studentCard(s) {
  const sum = store.summaryFor(s);
  const sessions = store.sessionsFor(s.id);
  const thisMonth = monthKey(new Date());
  const done = sessions.filter((x) => monthKey(x.date) === thisMonth).length;
  const pct = s.monthlyTarget ? Math.min(100, (done / s.monthlyTarget) * 100) : 0;
  const last = sessions[0];
  return html`<a class="student-card" href="${studentHref(s.id)}" style="--c:${s.color}">
    <div class="top">
      ${avatar(s)}
      <div class="row-main">
        <div class="row-title"><span class="truncate">${s.name}</span></div>
        <div class="row-sub truncate">${[s.grade, s.subjects.slice(0, 3).join(", ")].filter(Boolean).join(" · ") || CYCLE_LABELS[s.paymentCycle].name}</div>
      </div>
      ${balanceBadge(sum)}
    </div>
    ${s.monthlyTarget
      ? html`<div>
          <div class="meta" style="margin-bottom:6px"><span>This month</span><span class="num">${done} / ${s.monthlyTarget}</span></div>
          <div class="progress" role="progressbar" aria-label="Classes this month" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${s.monthlyTarget}">
            <span style="width:${pct}%"></span>
          </div>
        </div>`
      : ""}
    <div class="meta">
      <span>${last ? `Last class ${relativeDay(last.date).toLowerCase()}` : "No classes yet"}</span>
      <span>${plural(sessions.length, "class", "classes")}</span>
    </div>
  </a>`;
}

export const studentsView = {
  title: "Students",
  mount(root) {
    this.root = root;
    setHTML(
      root,
      html`<div class="page-head">
          <div><h1>Students</h1><div class="sub" id="students-sub"></div></div>
          <button type="button" class="btn primary" data-action="add-student">${icon("plus")}Add student</button>
        </div>
        <div class="toolbar">
          <label class="search-field">
            <span class="visually-hidden">Filter students</span>
            ${icon("search")}
            <input type="search" id="student-filter" placeholder="Filter by name, class or subject" value="${listState.q}" autocomplete="off" />
          </label>
          <div class="seg" role="group" aria-label="Show">
            <button type="button" data-archived="false" aria-pressed="${!listState.archived}">Active</button>
            <button type="button" data-archived="true" aria-pressed="${listState.archived}">Archived</button>
          </div>
          <select class="input" id="student-sort" aria-label="Sort by" style="width:auto">
            <option value="name">Name</option>
            <option value="owed">Amount due</option>
            <option value="recent">Recently taught</option>
            <option value="month">Classes this month</option>
          </select>
        </div>
        <div id="students-list"></div>`,
    );
    $("#student-sort", root).value = listState.sort;
    $("#student-filter", root).addEventListener("input", (e) => {
      listState.q = e.target.value;
      this.update();
    });
    $("#student-sort", root).addEventListener("change", (e) => {
      listState.sort = e.target.value;
      this.update();
    });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-archived]");
      if (!b) return;
      listState.archived = b.dataset.archived === "true";
      root.querySelectorAll("[data-archived]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      this.update();
    });
    this.update();
  },
  update() {
    const all = store.listStudents({ archived: listState.archived });
    const q = listState.q.trim().toLowerCase();
    const thisMonth = monthKey(new Date());
    let list = q
      ? all.filter((s) => [s.name, s.grade, s.phone, s.guardian, ...s.subjects].some((v) => v && v.toLowerCase().includes(q)))
      : all.slice();
    const lastDate = (s) => store.sessionsFor(s.id)[0]?.date || "";
    const monthCount = (s) => store.sessionsFor(s.id).filter((x) => monthKey(x.date) === thisMonth).length;
    if (listState.sort === "owed") list.sort((a, b) => store.summaryFor(b).owed - store.summaryFor(a).owed);
    if (listState.sort === "recent") list.sort((a, b) => lastDate(b).localeCompare(lastDate(a)));
    if (listState.sort === "month") list.sort((a, b) => monthCount(b) - monthCount(a));

    const activeCount = store.listStudents().length;
    const archivedCount = store.listStudents({ archived: true }).length;
    $("#students-sub", this.root).textContent = `${plural(activeCount, "active student")}${archivedCount ? ` · ${archivedCount} archived` : ""}`;

    const target = $("#students-list", this.root);
    if (!list.length) {
      setHTML(
        target,
        q
          ? emptyState({ iconName: "search", title: "No matches", body: `No ${listState.archived ? "archived " : ""}students match "${listState.q}".` })
          : listState.archived
            ? emptyState({ iconName: "archive", title: "No archived students", body: "Archive students you no longer teach to keep this list tidy. Their history is kept." })
            : emptyState({
                iconName: "users",
                title: "No students yet",
                body: "Add the students you teach to start logging classes.",
                actions: html`<button type="button" class="btn primary" data-action="add-student">${icon("plus")}Add student</button>`,
              }),
      );
      return;
    }
    setHTML(target, html`<div class="student-grid">${list.map(studentCard)}</div>`);
  },
};

// ================================================================ detail

const PAGE = 25;

export const studentDetailView = {
  title: "Student",
  mount(root, { id }) {
    this.root = root;
    this.id = id;
    this.tab = "classes";
    this.limit = PAGE;
    root.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) {
        this.tab = tab.dataset.tab;
        this.limit = PAGE;
        this.update();
        $(`[data-tab="${this.tab}"]`, this.root)?.focus();
        return;
      }
      if (e.target.closest('[data-action="more-sessions"]')) {
        this.limit += PAGE;
        this.update();
      }
    });
    root.addEventListener("keydown", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (!tab || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const tabs = [...this.root.querySelectorAll("[data-tab]")];
      const i = tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1);
      tabs[(i + tabs.length) % tabs.length].click();
    });
    this.update();
  },
  get titleText() {
    return store.getStudent(this.id)?.name || "Student";
  },
  update() {
    const s = store.getStudent(this.id);
    if (!s) {
      setHTML(
        this.root,
        html`<a class="back-link" href="#/students">${icon("chevron-left")}Students</a>
          ${store.state.ready
            ? emptyState({ iconName: "user", title: "Student not found", body: "They may have been deleted.", actions: html`<a class="btn" href="#/students">Back to students</a>` })
            : ""}`,
      );
      return;
    }
    document.title = `${s.name} · TuitionPro`;
    const sum = store.summaryFor(s);
    const sessions = store.sessionsFor(s.id);
    const payments = store.paymentsFor(s.id);
    const now = new Date();
    const thisMonth = monthKey(now);
    const done = sessions.filter((x) => monthKey(x.date) === thisMonth).length;
    const minutes = sessions.reduce((t, x) => t + x.duration, 0);
    const streak = currentStreak(sessions.map((x) => x.date), todayISO(now));
    const cycle = CYCLE_LABELS[s.paymentCycle];
    const phoneHref = s.phone.replace(/[^\d+]/g, "");

    const header = html`<a class="back-link" href="#/students">${icon("chevron-left")}Students</a>
      <section class="card" style="border-top:4px solid ${s.color}">
        <div class="profile">
          ${avatar(s, "lg")}
          <div class="row-main">
            <h1>${s.name}</h1>
            <div class="facts">
              ${s.grade ? html`<span>${icon("cap")}${s.grade}</span>` : ""}
              <span>${icon("wallet")}${money(sum.chargePerUnit)} ${cycle.per}</span>
              ${s.phone ? html`<a href="tel:${phoneHref}">${icon("phone")}${s.phone}</a>` : ""}
              ${s.guardian ? html`<span>${icon("user")}${s.guardian}</span>` : ""}
              ${s.archived ? html`<span class="badge">${icon("archive")}Archived</span>` : ""}
            </div>
            ${s.subjects.length ? html`<div class="tags" style="margin-top:10px">${s.subjects.map((x) => html`<span class="tag" style="padding-right:10px">${x}</span>`)}</div>` : ""}
          </div>
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button type="button" class="btn primary grow" data-action="log-class" data-student="${s.id}">${icon("plus")}Log class</button>
          <button type="button" class="btn success grow" data-action="record-payment" data-student="${s.id}">${icon("wallet")}Record payment</button>
          <button type="button" class="btn" data-action="edit-student" data-id="${s.id}">${icon("edit")}<span>Edit</span></button>
        </div>
      </section>`;

    const stats = html`<div class="stats four" style="margin:14px 0">
      <div class="stat">
        <div class="label">${icon("target")}This month</div>
        <div class="value">${done}${s.monthlyTarget ? html`<span class="muted" style="font-size:1rem"> / ${s.monthlyTarget}</span>` : ""}</div>
        ${s.monthlyTarget
          ? html`<div class="progress" style="margin-top:8px;--c:${s.color}" role="progressbar" aria-label="Monthly target" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${s.monthlyTarget}"><span style="width:${Math.min(100, (done / s.monthlyTarget) * 100)}%"></span></div>`
          : html`<div class="foot">classes</div>`}
      </div>
      <div class="stat">
        <div class="label">${icon("book")}All time</div>
        <div class="value">${sessions.length}</div>
        <div class="foot">${formatNumber(minutes / 60)} hours${streak > 1 ? ` · ${streak}-day streak` : ""}</div>
      </div>
      <div class="stat">
        <div class="label">${icon("file")}Billed</div>
        <div class="value">${money(sum.billed)}</div>
        <div class="foot">${money(sum.paid)} received</div>
      </div>
      <div class="stat ${sum.owed > 0 ? "danger" : "success"}">
        <div class="label">${icon("wallet")}${sum.credit > 0 ? "Credit" : "Due"}</div>
        <div class="value">${money(sum.credit > 0 ? sum.credit : sum.owed)}</div>
        <div class="foot">${sum.owed > 0 ? html`<button type="button" class="btn ghost sm" style="padding:0;min-height:0;color:inherit" data-action="copy-reminder" data-id="${s.id}">${icon("message")}Copy reminder</button>` : sum.credit > 0 ? "paid in advance" : "all settled"}</div>
      </div>
    </div>`;

    const tabs = [
      ["classes", `Classes (${sessions.length})`],
      ["payments", `Payments (${payments.length})`],
      ["overview", "Overview"],
    ];
    const tabBar = html`<div class="tabs" role="tablist" aria-label="Student sections">
      ${tabs.map(
        ([key, label]) =>
          html`<button type="button" role="tab" id="tab-${key}" data-tab="${key}" aria-selected="${this.tab === key}" aria-controls="tabpanel" tabindex="${this.tab === key ? 0 : -1}">${label}</button>`,
      )}
    </div>`;

    let panel;
    if (this.tab === "classes") {
      if (!sessions.length) {
        panel = emptyState({
          iconName: "book",
          title: "No classes yet",
          body: `Log each class you teach ${s.name}.`,
          actions: html`<button type="button" class="btn primary" data-action="log-class" data-student="${s.id}">${icon("plus")}Log class</button>`,
        });
      } else {
        const shown = sessions.slice(0, this.limit);
        const groups = [];
        for (const x of shown) {
          const k = monthKey(x.date);
          if (groups.at(-1)?.key !== k) groups.push({ key: k, items: [] });
          groups.at(-1).items.push(x);
        }
        const perMonth = new Map();
        for (const x of sessions) perMonth.set(monthKey(x.date), (perMonth.get(monthKey(x.date)) || 0) + 1);
        panel = html`<div class="card flush">
          ${groups.map(
            (g) => html`<div class="group-label"><span>${monthLabel(g.key, { month: "long", year: "numeric" })}</span><span>${plural(perMonth.get(g.key), "class", "classes")}</span></div>
              <ul class="list">${g.items.map((x) => sessionRow(x, { actions: true, status: sum.sessionStatus.get(x.id) }))}</ul>`,
          )}
          ${sessions.length > this.limit
            ? html`<div class="load-more"><button type="button" class="btn sm" data-action="more-sessions">Show more (${sessions.length - this.limit} older)</button></div>`
            : ""}
        </div>`;
      }
    } else if (this.tab === "payments") {
      panel = payments.length
        ? html`<div class="card flush"><ul class="list">${payments.map((p) => paymentRow(p, { actions: true }))}</ul></div>`
        : emptyState({
            iconName: "wallet",
            title: "No payments yet",
            body: "Record payments as you receive them; dues update automatically.",
            actions: html`<button type="button" class="btn success" data-action="record-payment" data-student="${s.id}">${icon("wallet")}Record payment</button>`,
          });
    } else {
      // 12-week activity
      const weekStart = store.state.settings.weekStart;
      const thisWeek = weekStartOf(todayISO(now), weekStart);
      const weeks = Array.from({ length: 12 }, (_, i) => addDays(thisWeek, (i - 11) * 7));
      const perWeek = new Map(weeks.map((w) => [w, 0]));
      for (const x of sessions) {
        const w = weekStartOf(x.date, weekStart);
        if (perWeek.has(w)) perWeek.set(w, perWeek.get(w) + 1);
      }
      const subj = new Map();
      for (const x of sessions) if (x.subject) subj.set(x.subject, (subj.get(x.subject) || 0) + 1);
      const topSubjects = [...subj].sort((a, b) => b[1] - a[1]).slice(0, 6);
      panel = html`<div class="grid-2">
        <section class="card">
          <div class="card-head"><h2>${icon("chart")}Classes per week</h2></div>
          ${barChart({
            labels: weeks.map((w, i) => (i % 2 === 1 ? "" : formatDate(w, { day: "numeric", month: "short" }))),
            fullLabels: weeks.map((w) => `Week of ${formatDate(w, { day: "numeric", month: "short" })}`),
            series: [{ name: "Classes", values: weeks.map((w) => perWeek.get(w)) }],
            format: (n) => plural(n, "class", "classes"),
            axisFormat: (n) => formatNumber(n, 1),
            current: 11,
            caption: `Classes per week for ${s.name}, last 12 weeks`,
            height: 130,
          })}
        </section>
        <section class="card">
          <div class="card-head"><h2>${icon("note")}Notes</h2></div>
          ${s.notes ? html`<p class="row-note" style="margin:0">${s.notes}</p>` : html`<p class="muted small">No notes. Use Edit to add address, schedule or goals.</p>`}
          ${topSubjects.length
            ? html`<div class="section-title">Topics covered</div>${rankedBars(
                topSubjects.map(([label, value]) => ({ label, value, color: s.color })),
                { format: (n) => plural(n, "class", "classes") },
              )}`
            : ""}
          <div class="section-title">Details</div>
          <p class="small muted">
            Billing: ${cycle.name}, ${money(sum.chargePerUnit)} ${cycle.per}.<br />
            ${sessions.length ? `First class ${formatDate(sessions.at(-1).date)}. ` : ""}Added ${new Date(s.createdAt).toLocaleDateString()}.
          </p>
        </section>
        <section class="card span-2">
          <div class="card-head"><h2>${icon("settings")}Manage</h2></div>
          <div class="btn-row">
            <button type="button" class="btn" data-action="copy-reminder" data-id="${s.id}">${icon("message")}Copy payment reminder</button>
            <button type="button" class="btn" data-action="toggle-archive" data-id="${s.id}">${icon("archive")}${s.archived ? "Restore to active" : "Archive student"}</button>
            <button type="button" class="btn outline-danger" data-action="delete-student" data-id="${s.id}">${icon("trash")}Delete student</button>
          </div>
        </section>
      </div>`;
    }

    setHTML(this.root, html`${header}${stats}${tabBar}<div id="tabpanel" role="tabpanel" aria-labelledby="tab-${this.tab}">${panel}</div>`);
  },
};
