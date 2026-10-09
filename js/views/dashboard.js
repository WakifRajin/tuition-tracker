import * as store from "../store.js";
import { html, formatNumber, plural } from "../lib/format.js";
import { todayISO, monthKey, recentMonthKeys, monthLabel, toISODate, addMonths, WEEKDAYS_SHORT, formatDate } from "../lib/dates.js";
import { billedByMonth, receivedByMonth } from "../lib/billing.js";
import { barChart } from "../ui/charts.js";
import { icon, setHTML } from "../ui/dom.js";
import { money, avatar, emptyState, sessionRow, studentHref, balanceBadge } from "./common.js";

let calMonth = null;

function greeting(now) {
  const h = now.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function monthPace(student, done, now) {
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expected = (student.monthlyTarget * now.getDate()) / dim;
  return { behind: student.monthlyTarget > 0 && done < Math.floor(expected) - 1, expected };
}

function calendar(now) {
  calMonth ??= new Date(now.getFullYear(), now.getMonth(), 1);
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const weekStart = store.state.settings.weekStart;
  const first = new Date(y, m, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(y, m, 1 - lead);
  const total = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7) * 7;
  const today = todayISO(now);

  const byDate = new Map();
  for (const s of store.allSessions()) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  const days = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISODate(d);
    const list = byDate.get(iso) || [];
    const colors = [...new Set(list.map((s) => store.getStudent(s.studentId)?.color || "var(--primary)"))].slice(0, 3);
    const label = `${formatDate(iso, { weekday: "long", day: "numeric", month: "long" })}${list.length ? `, ${plural(list.length, "class", "classes")}` : ""}`;
    days.push(html`<button type="button" class="cal-day ${d.getMonth() !== m ? "out" : ""} ${list.length ? "has" : ""} ${iso === today ? "today" : ""}"
      data-action="open-day" data-date="${iso}" aria-label="${label}" ${iso === today ? html`aria-current="date"` : ""}>
      <span>${d.getDate()}</span>
      <span class="cal-dots">${colors.map((c) => html`<i style="--c:${c}"></i>`)}</span>
    </button>`);
  }
  const dows = Array.from({ length: 7 }, (_, i) => WEEKDAYS_SHORT[(weekStart + i) % 7]);
  const monthClasses = store.allSessions().filter((s) => monthKey(s.date) === monthKey(calMonth)).length;

  return html`<section class="card" aria-labelledby="cal-title">
    <div class="card-head">
      <h2 id="cal-title">${icon("calendar")}Calendar</h2>
      <div class="cal-head">
        <button type="button" class="btn icon sm" data-action="cal-nav" data-dir="-1" aria-label="Previous month">${icon("chevron-left")}</button>
        <strong aria-live="polite">${calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
        <button type="button" class="btn icon sm" data-action="cal-nav" data-dir="1" aria-label="Next month">${icon("chevron-right")}</button>
      </div>
    </div>
    <div class="cal" role="group" aria-label="Days">
      ${dows.map((d) => html`<div class="cal-dow" aria-hidden="true">${d.slice(0, 2)}</div>`)}
      ${days}
    </div>
    <p class="small muted" style="margin-top:10px">${plural(monthClasses, "class", "classes")} this month · tap a day for details</p>
  </section>`;
}

export const dashboardView = {
  title: "Home",
  mount(root) {
    this.root = root;
    root.addEventListener("click", (e) => {
      const nav = e.target.closest('[data-action="cal-nav"]');
      if (!nav) return;
      calMonth = addMonths(calMonth, Number(nav.dataset.dir));
      this.update();
    });
    this.update();
  },
  update() {
    const now = new Date();
    const thisMonth = monthKey(now);
    const students = store.listStudents();
    const user = store.state.userName;
    const monthSessions = store.allSessions().filter((s) => monthKey(s.date) === thisMonth);
    const monthMinutes = monthSessions.reduce((t, s) => t + s.duration, 0);
    const target = students.reduce((t, s) => t + (s.monthlyTarget || 0), 0);

    const all = store.listStudents({ archived: "all" });
    const keys = recentMonthKeys(6, now);
    const billed = billedByMonth(all, store.sessionsByStudent(), keys, { weekStart: store.state.settings.weekStart });
    const received = receivedByMonth(store.allPayments(), keys);
    const outstanding = all.reduce((t, s) => t + store.summaryFor(s).owed, 0);

    const hero = html`<section class="card hero">
      <div class="hero-row">
        <div>
          <div class="eyebrow">${greeting(now)}${user ? `, ${firstName(user)}` : ""}</div>
          <h1>${now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h1>
        </div>
        ${students.length ? html`<button type="button" class="btn" data-action="log-class">${icon("plus")}Log a class</button>` : ""}
      </div>
    </section>`;

    if (!all.length) {
      setHTML(
        this.root,
        html`${hero}
          <section class="card" style="margin-top:14px">
            ${emptyState({
              iconName: "users",
              title: "Welcome to TuitionPro",
              body: "Add your first student, then log each class you teach. Billing, dues and insights are worked out for you.",
              actions: html`<button type="button" class="btn primary" data-action="add-student">${icon("plus")}Add your first student</button>
                <button type="button" class="btn" data-action="import-json">${icon("upload")}Restore a backup</button>`,
            })}
          </section>`,
      );
      return;
    }

    const counts = new Map();
    for (const s of monthSessions) counts.set(s.studentId, (counts.get(s.studentId) || 0) + 1);

    const attention = all
      .map((s) => {
        const sum = store.summaryFor(s);
        const done = counts.get(s.id) || 0;
        const pace = s.archived ? { behind: false } : monthPace(s, done, now);
        return { s, sum, done, pace };
      })
      .filter((x) => x.sum.owed > 0 || x.pace.behind)
      .sort((a, b) => b.sum.owed - a.sum.owed)
      .slice(0, 6);

    const recent = store.allSessions().slice(0, 6);

    setHTML(
      this.root,
      html`${hero}
        <div class="stats four" style="margin:14px 0">
          <div class="stat">
            <div class="label">${icon("book")}Classes</div>
            <div class="value">${monthSessions.length}</div>
            <div class="foot">this month${target ? ` · ${target} planned` : ""}</div>
          </div>
          <div class="stat">
            <div class="label">${icon("file")}Billed</div>
            <div class="value">${money(billed.get(thisMonth))}</div>
            <div class="foot">this month · ${formatNumber(monthMinutes / 60)} h taught</div>
          </div>
          <div class="stat success">
            <div class="label">${icon("wallet")}Received</div>
            <div class="value">${money(received.get(thisMonth))}</div>
            <div class="foot">this month · ${plural(store.allPayments().filter((p) => monthKey(p.date) === thisMonth).length, "payment")}</div>
          </div>
          <div class="stat ${outstanding > 0 ? "danger" : ""}">
            <div class="label">${icon("alert")}Outstanding</div>
            <div class="value">${money(outstanding)}</div>
            <div class="foot">${outstanding > 0 ? plural(all.filter((s) => store.summaryFor(s).owed > 0).length, "student") : "All settled"}</div>
          </div>
        </div>

        ${students.length
          ? html`<div class="section-title" style="margin-top:0"><span>Quick log</span></div>
              <div class="chips" style="margin-bottom:18px">
                ${students.map(
                  (s) => html`<button type="button" class="chip" style="--c:${s.color}" data-action="log-class" data-student="${s.id}" aria-label="Log a class with ${s.name}">
                    ${avatar(s, "sm")}${s.name}<span class="plus">${icon("plus")}</span>
                  </button>`,
                )}
              </div>`
          : ""}

        <div class="grid-2">
          <section class="card flush" aria-labelledby="att-title">
            <div class="card-head"><h2 id="att-title">${icon("alert")}Needs attention</h2></div>
            ${attention.length
              ? html`<ul class="list">
                  ${attention.map(
                    ({ s, sum, done, pace }) => html`<li>
                      <a class="row" href="${studentHref(s.id)}">
                        ${avatar(s)}
                        <div class="row-main">
                          <div class="row-title"><span class="truncate">${s.name}</span></div>
                          <div class="row-sub">${pace.behind ? `${done} of ${s.monthlyTarget} classes · behind pace` : `${done} classes this month`}</div>
                        </div>
                        <div class="row-end">${sum.owed > 0 ? balanceBadge(sum) : html`<span class="badge warning">Behind</span>`}</div>
                      </a>
                    </li>`,
                  )}
                </ul>`
              : emptyState({ iconName: "check", title: "All caught up", body: "No dues and everyone is on pace this month.", compact: true })}
          </section>

          <section class="card" aria-labelledby="trend-title">
            <div class="card-head">
              <h2 id="trend-title">${icon("chart")}Last 6 months</h2>
              <a class="btn ghost sm" href="#/analytics">Insights ${icon("chevron-right")}</a>
            </div>
            ${barChart({
              labels: keys.map((k) => monthLabel(k)),
              fullLabels: keys.map((k) => monthLabel(k, { month: "long", year: "numeric" })),
              series: [
                { name: "Billed", values: keys.map((k) => billed.get(k)) },
                { name: "Received", values: keys.map((k) => received.get(k)) },
              ],
              format: money,
              axisFormat: (n) => formatNumber(n >= 1000 ? n / 1000 : n, 1) + (n >= 1000 ? "k" : ""),
              current: keys.length - 1,
              caption: "Billed and received per month",
              height: 150,
            })}
          </section>

          ${calendar(now)}

          <section class="card flush" aria-labelledby="recent-title">
            <div class="card-head"><h2 id="recent-title">${icon("clock")}Recent classes</h2></div>
            ${recent.length
              ? html`<ul class="list">${recent.map((s) => sessionRow(s, { showStudent: true }))}</ul>`
              : emptyState({
                  iconName: "book",
                  title: "No classes yet",
                  body: "Log your first class to start tracking.",
                  compact: true,
                  actions: html`<button type="button" class="btn primary sm" data-action="log-class">${icon("plus")}Log a class</button>`,
                })}
          </section>
        </div>`,
    );
  },
};
