import { test } from "node:test";
import assert from "node:assert/strict";

import * as dates from "../js/lib/dates.js";
import { html, raw, escapeHtml, formatDuration, csvCell, normalizeCurrency, initials } from "../js/lib/format.js";
import { migrateData, parseBackup, normalizeSettings, normalizeStudent } from "../js/lib/model.js";
import { summarizeStudent, billedByMonth, receivedByMonth, currentStreak, billingPeriods } from "../js/lib/billing.js";

const student = (over = {}) => normalizeStudent({ id: "s1", name: "Ayan", rate: 500, ...over });
const session = (id, date, over = {}) => ({ id, studentId: "s1", date, duration: 60, fee: null, createdAt: 0, ...over });
const payment = (id, amount, date = "2026-01-31") => ({ id, studentId: "s1", amount, date });

test("dates: local parsing and formatting never shifts the day", () => {
  assert.equal(dates.toISODate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(dates.toISODate(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
  assert.equal(dates.parseISODate("2026-02-30"), null);
  assert.equal(dates.parseISODate("nope"), null);
  assert.equal(dates.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dates.monthKey("2026-11-09"), "2026-11");
  assert.deepEqual(dates.recentMonthKeys(3, new Date(2026, 0, 15)), ["2025-11", "2025-12", "2026-01"]);
});

test("dates: week start respects the configured first weekday", () => {
  // 2026-10-09 is a Friday.
  assert.equal(dates.weekStartOf("2026-10-09", 0), "2026-10-04"); // Sunday
  assert.equal(dates.weekStartOf("2026-10-09", 1), "2026-10-05"); // Monday
  assert.equal(dates.weekStartOf("2026-10-09", 6), "2026-10-03"); // Saturday
  assert.equal(dates.weekStartOf("2026-10-10", 6), "2026-10-10");
});

test("format: html escapes interpolations but not raw/nested html", () => {
  const name = `<img src=x onerror="alert(1)">`;
  const out = String(html`<b>${name}</b>${raw("<i>ok</i>")}${html`<u>${"&"}</u>`}${null}${false}`);
  assert.equal(out, `<b>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</b><i>ok</i><u>&amp;</u>`);
  assert.equal(escapeHtml("'"), "&#39;");
  assert.equal(String(html`${["<a>", "b"]}`), "&lt;a&gt;b");
});

test("format: misc helpers", () => {
  assert.equal(formatDuration(90), "1h 30m");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(45), "45m");
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell('a "b", c'), '"a ""b"", c"');
  assert.equal(csvCell(-50), "-50");
  assert.equal(normalizeCurrency("৳"), "BDT");
  assert.equal(normalizeCurrency("XYZ"), "BDT");
  assert.equal(initials("Md. Ayan Rahman"), "MR");
});

test("migration: legacy data gets string ids, fee snapshots and drops orphans", () => {
  const legacy = {
    students: [
      { id: 1712000000000, name: "A", rate: 400, paymentCycle: "daily", monthlyRequiredClasses: 12 },
      { id: 1712000000001, name: "B", rate: 0, paymentCycle: "monthly", billingAmount: 6000 },
    ],
    sessions: [
      { id: 1, studentId: 1712000000000, date: "2026-01-02", payment: "paid" },
      { id: 2, studentId: 1712000000001, date: "2026-01-03" },
      { id: 3, studentId: 999, date: "2026-01-03" },
      { id: 1712000000500, studentId: 1712000000000, date: "" },
    ],
    payments: [
      { id: 10, studentId: 1712000000000, amount: 400, date: "2026-01-02" },
      { id: 11, studentId: 1712000000000, amount: 0, date: "2026-01-02" },
    ],
  };
  const out = migrateData(legacy, 5);
  assert.equal(out.students[0].id, "1712000000000");
  assert.equal(out.students[0].monthlyTarget, 12);
  assert.equal(out.sessions.length, 3);
  assert.equal(out.sessions[0].studentId, "1712000000000");
  assert.equal(out.sessions[0].fee, 400);
  assert.equal(out.sessions[1].fee, null);
  assert.match(out.sessions[2].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(out.payments.length, 1);
  assert.equal(out.students[1].billingAmount, 6000);
});

test("migration: ids unsafe for Firestore are mapped consistently", () => {
  const out = migrateData({
    students: [{ id: "a/b", name: "A" }, { id: "__x__", name: "B" }],
    sessions: [{ id: "..", studentId: "a/b", date: "2026-01-01" }],
    payments: [{ id: "p", studentId: "__x__", amount: 5, date: "2026-01-01", sessionId: ".." }],
  });
  assert.deepEqual(out.students.map((s) => s.id), ["a_b", "id-__x__"]);
  assert.equal(out.sessions[0].id, "id-__");
  assert.equal(out.sessions[0].studentId, "a_b");
  assert.equal(out.payments[0].studentId, "id-__x__");
  assert.equal(out.payments[0].sessionId, "id-__");
});

test("backup: parses v4 and legacy files, rejects junk", () => {
  assert.throws(() => parseBackup("{"), /valid JSON/);
  assert.throws(() => parseBackup('{"foo":1}'), /backup/);
  const legacy = parseBackup(JSON.stringify({ version: "3.0", students: [{ id: 1, name: "A" }], sessions: [] }));
  assert.equal(legacy.students.length, 1);
  const v4 = parseBackup(JSON.stringify({ schemaVersion: 4, settings: { currency: "USD" }, data: { students: [{ id: "x", name: "B" }] } }));
  assert.equal(v4.students[0].id, "x");
  assert.equal(v4.settings.currency, "USD");
  assert.deepEqual(normalizeSettings({ defaultDuration: "abc", weekStart: 9 }), { currency: "BDT", defaultDuration: 60, weekStart: 0 });
});

test("billing: per-class uses snapshotted fees, payments allocate oldest first", () => {
  const st = student({ rate: 600 });
  const ss = [session("a", "2026-01-01", { fee: 500 }), session("b", "2026-01-02", { fee: 500 }), session("c", "2026-01-03")];
  const sum = summarizeStudent(st, ss, [payment("p", 700)]);
  assert.equal(sum.billed, 1600);
  assert.equal(sum.owed, 900);
  assert.equal(sum.sessionStatus.get("a"), "paid");
  assert.equal(sum.sessionStatus.get("b"), "partial");
  assert.equal(sum.sessionStatus.get("c"), "unpaid");
  assert.equal(sum.unpaidCount, 2);
});

test("billing: a payment linked to a class settles that class first", () => {
  const ss = [session("a", "2026-01-01", { fee: 500 }), session("b", "2026-01-02", { fee: 500 }), session("c", "2026-01-03", { fee: 500 })];
  const sum = summarizeStudent(student(), ss, [{ ...payment("p", 500), sessionId: "c" }, payment("q", 200)]);
  assert.equal(sum.sessionStatus.get("c"), "paid");
  assert.equal(sum.sessionStatus.get("a"), "partial");
  assert.equal(sum.sessionStatus.get("b"), "unpaid");
  assert.equal(sum.owed, 800);
});

test("billing: overpayment shows as credit, not negative owed", () => {
  const sum = summarizeStudent(student(), [session("a", "2026-01-01", { fee: 500 })], [payment("p", 800)]);
  assert.equal(sum.owed, 0);
  assert.equal(sum.credit, 300);
});

test("billing: weekly and monthly bill once per active period", () => {
  const weekly = student({ paymentCycle: "weekly", billingAmount: 2000 });
  // 2026-10-04 is a Sunday. With Sunday weeks these are 2 weeks; with Saturday weeks, also 2 (Sat 10-03, Sat 10-10).
  const ss = [session("a", "2026-10-04"), session("b", "2026-10-09"), session("c", "2026-10-11")];
  assert.equal(summarizeStudent(weekly, ss, [], { weekStart: 0 }).billed, 4000);
  assert.equal(summarizeStudent(weekly, ss, [], { weekStart: 1 }).billed, 4000);

  const monthly = student({ paymentCycle: "monthly", billingAmount: 8000 });
  const ms = [session("a", "2026-09-30"), session("b", "2026-10-01"), session("c", "2026-10-20")];
  const sum = summarizeStudent(monthly, ms, [payment("p", 8000)]);
  assert.equal(sum.billed, 16000);
  assert.equal(sum.owed, 8000);
  assert.equal(sum.sessionStatus.get("a"), "paid");
  assert.equal(sum.sessionStatus.get("c"), "unpaid");
});

test("billing: monthly reporting attributes periods to the month they started", () => {
  const st = student({ paymentCycle: "weekly", billingAmount: 1000 });
  // Week of Sun 2026-09-27 spans into October; first class is in September.
  const ss = [session("a", "2026-09-29"), session("b", "2026-10-01"), session("c", "2026-10-05")];
  assert.equal(billingPeriods(st, ss).length, 2);
  const by = billedByMonth([st], new Map([["s1", ss]]), ["2026-09", "2026-10"]);
  assert.deepEqual([...by.values()], [1000, 1000]);
  const rec = receivedByMonth([payment("p", 300, "2026-10-02"), payment("q", 50, "2026-08-02")], ["2026-09", "2026-10"]);
  assert.deepEqual([...rec.values()], [0, 300]);
});

test("streak counts consecutive days up to today or yesterday", () => {
  assert.equal(currentStreak(["2026-10-07", "2026-10-08", "2026-10-09"], "2026-10-09"), 3);
  assert.equal(currentStreak(["2026-10-07", "2026-10-08"], "2026-10-09"), 2);
  assert.equal(currentStreak(["2026-10-06"], "2026-10-09"), 0);
  assert.equal(currentStreak([], "2026-10-09"), 0);
});
