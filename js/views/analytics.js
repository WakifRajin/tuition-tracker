import * as store from "../store.js";
import { html, formatNumber, plural, formatDuration } from "../lib/format.js";
import { recentMonthKeys, monthKey, monthLabel, parseISODate, WEEKDAYS_SHORT } from "../lib/dates.js";
import { billedByMonth, receivedByMonth } from "../lib/billing.js";
import { barChart, rankedBars } from "../ui/charts.js";
import { icon, setHTML } from "../ui/dom.js";
import { money, avatar, emptyState, studentHref } from "./common.js";

const RANGES = [3, 6, 12];
let range = 6;

const compact = (n) => (n >= 1e6 ? `${formatNumber(n / 1e6)}M` : n >= 1000 ? `${formatNumber(n / 1000)}k` : formatNumber(n));

export const analyticsView = {
  title: "Insights",
  mount(root) {
    this.root = root;
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]");
      if (!b) return;
      range = Number(b.dataset.range);
      this.update();
    });
    this.update();
  },
  update() {
    const all = store.listStudents({ archived: "all" });
    const head = html`<div class="page-head">
      <div><h1>Insights</h1><div class="sub">How your teaching and income are trending</div></div>
      <div class="seg" role="group" aria-label="Period">
        ${RANGES.map((r) => html`<button type="button" data-range="${r}" aria-pressed="${r === range}">${r} months</button>`)}
      </div>
    </div>`;
    if (!store.state.sessions.size) {
      setHTML(
        this.root,
        html`${head}<section class="card">${emptyState({
          iconName: "chart",
          title: "Nothing to show yet",
          body: "Insights appear once you've logged a few classes.",
          actions: html`<button type="button" class="btn primary" data-action="log-class">${icon("plus")}Log a class</button>`,
        })}</section>`,
      );
      return;
    }

    const now = new Date();
    const keys = recentMonthKeys(range, now);
    const keySet = new Set(keys);
    const opts = { weekStart: store.state.settings.weekStart };
    const inRange = store.allSessions().filter((s) => keySet.has(monthKey(s.date)));
    const paymentsInRange = store.allPayments().filter((p) => keySet.has(monthKey(p.date)));
    const billed = billedByMonth(all, store.sessionsByStudent(), keys, opts);
    const received = receivedByMonth(store.allPayments(), keys);
    const totalBilled = [...billed.values()].reduce((a, b) => a + b, 0);
    const totalReceived = [...received.values()].reduce((a, b) => a + b, 0);
    const minutes = inRange.reduce((t, s) => t + s.duration, 0);

    const perMonth = new Map(keys.map((k) => [k, 0]));
    for (const s of inRange) perMonth.set(monthKey(s.date), perMonth.get(monthKey(s.date)) + 1);

    const weekday = Array(7).fill(0);
    for (const s of inRange) weekday[parseISODate(s.date).getDay()]++;
    const ws = store.state.settings.weekStart;
    const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);

    const subjects = new Map();
    for (const s of inRange) if (s.subject) subjects.set(s.subject, (subjects.get(s.subject) || 0) + 1);
    const topSubjects = [...subjects].sort((a, b) => b[1] - a[1]).slice(0, 6);

    const rows = all
      .map((st) => {
        const ss = inRange.filter((s) => s.studentId === st.id);
        const recv = paymentsInRange.filter((p) => p.studentId === st.id).reduce((t, p) => t + p.amount, 0);
        return { st, classes: ss.length, minutes: ss.reduce((t, s) => t + s.duration, 0), received: recv, owed: store.summaryFor(st).owed };
      })
      .filter((r) => r.classes || r.received || r.owed)
      .sort((a, b) => b.classes - a.classes);

    const monthLabels = keys.map((k) => monthLabel(k));
    const fullLabels = keys.map((k) => monthLabel(k, { month: "long", year: "numeric" }));
    const collectionRate = totalBilled ? Math.round((totalReceived / totalBilled) * 100) : null;

    setHTML(
      this.root,
      html`${head}
        <div class="stats four" style="margin-bottom:14px">
          <div class="stat"><div class="label">${icon("book")}Classes</div><div class="value">${formatNumber(inRange.length, 0)}</div><div class="foot">${formatNumber(inRange.length / range)} per month</div></div>
          <div class="stat"><div class="label">${icon("clock")}Hours taught</div><div class="value">${formatNumber(minutes / 60)}</div><div class="foot">avg ${formatDuration(inRange.length ? minutes / inRange.length : 0)} per class</div></div>
          <div class="stat"><div class="label">${icon("file")}Billed</div><div class="value">${money(totalBilled)}</div><div class="foot">${money(totalBilled / range)} per month</div></div>
          <div class="stat success"><div class="label">${icon("wallet")}Received</div><div class="value">${money(totalReceived)}</div><div class="foot">${collectionRate === null ? "—" : `${collectionRate}% of billed`}</div></div>
        </div>
        <div class="grid-2">
          <section class="card span-2">
            <div class="card-head"><h2>${icon("wallet")}Billed vs received</h2></div>
            ${barChart({
              labels: monthLabels,
              fullLabels,
              series: [
                { name: "Billed", values: keys.map((k) => billed.get(k)) },
                { name: "Received", values: keys.map((k) => received.get(k)) },
              ],
              format: money,
              axisFormat: compact,
              current: keys.length - 1,
              caption: "Amount billed and received per month",
              height: 180,
            })}
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon("book")}Classes per month</h2></div>
            ${barChart({
              labels: monthLabels,
              fullLabels,
              series: [{ name: "Classes", values: keys.map((k) => perMonth.get(k)) }],
              format: (n) => plural(n, "class", "classes"),
              axisFormat: (n) => formatNumber(n, 1),
              current: keys.length - 1,
              caption: "Classes per month",
            })}
          </section>
          <section class="card">
            <div class="card-head"><h2>${icon("calendar")}Busiest days</h2></div>
            ${barChart({
              labels: order.map((d) => WEEKDAYS_SHORT[d]),
              series: [{ name: "Classes", values: order.map((d) => weekday[d]) }],
              format: (n) => plural(n, "class", "classes"),
              axisFormat: (n) => formatNumber(n, 1),
              caption: "Classes by day of the week",
            })}
          </section>
          <section class="card flush span-2" aria-labelledby="by-student">
            <div class="card-head"><h2 id="by-student">${icon("users")}By student</h2><span class="small muted">last ${range} months</span></div>
            ${rows.length
              ? html`<ul class="list">
                  ${rows.map(
                    (r) => html`<li>
                      <a class="row" href="${studentHref(r.st.id)}">
                        ${avatar(r.st, "sm")}
                        <div class="row-main">
                          <div class="row-title"><span class="truncate">${r.st.name}</span>${r.st.archived ? html`<span class="badge">Archived</span>` : ""}</div>
                          <div class="row-sub">${plural(r.classes, "class", "classes")} · ${formatNumber(r.minutes / 60)} h · ${money(r.received)} received</div>
                        </div>
                        <div class="row-end">${r.owed > 0 ? html`<span class="badge danger">${money(r.owed)} due</span>` : html`<span class="badge success">Settled</span>`}</div>
                      </a>
                    </li>`,
                  )}
                </ul>`
              : emptyState({ iconName: "users", title: "No activity in this period", compact: true })}
          </section>
          ${topSubjects.length
            ? html`<section class="card span-2">
                <div class="card-head"><h2>${icon("note")}Top topics</h2></div>
                ${rankedBars(topSubjects.map(([label, value]) => ({ label, value })), { format: (n) => plural(n, "class", "classes") })}
              </section>`
            : ""}
        </div>`,
    );
  },
};
