// Billing maths. Pure functions over normalized records.
//
// Payments are the single source of truth for what has been paid. Whether an
// individual per-class session is "paid" is derived by allocating the
// student's total payments to their sessions oldest-first.
import { monthKey, weekStartOf } from "./dates.js";

const round2 = (n) => Math.round(n * 100) / 100;

export const sessionFee = (session, student) => session.fee ?? student.rate ?? 0;

export const CYCLE_LABELS = {
  daily: { unit: "class", per: "per class", name: "Per class" },
  weekly: { unit: "week", per: "per week", name: "Weekly" },
  monthly: { unit: "month", per: "per month", name: "Monthly" },
};

/**
 * Billing periods for a student: one entry per class (daily), per week with at
 * least one class (weekly), or per month with at least one class (monthly).
 * Each period is attributed to the month of its first class.
 */
export function billingPeriods(student, sessions, { weekStart = 0 } = {}) {
  const sorted = sessions.slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  if (student.paymentCycle === "daily") {
    return sorted.map((s) => ({
      key: s.id,
      month: monthKey(s.date),
      firstDate: s.date,
      amount: sessionFee(s, student),
      sessionIds: [s.id],
    }));
  }
  const keyOf = student.paymentCycle === "weekly" ? (d) => weekStartOf(d, weekStart) : (d) => monthKey(d);
  const map = new Map();
  for (const s of sorted) {
    const k = keyOf(s.date);
    if (!k) continue;
    let p = map.get(k);
    if (!p) {
      p = { key: k, month: monthKey(s.date), firstDate: s.date, amount: student.billingAmount || 0, sessionIds: [] };
      map.set(k, p);
    }
    p.sessionIds.push(s.id);
  }
  return [...map.values()];
}

/**
 * @returns {{
 *   cycle, chargePerUnit, units, billed, paid, balance, owed, credit,
 *   sessionStatus: Map<string, "paid"|"partial"|"unpaid">,
 *   unpaidCount: number
 * }}
 */
export function summarizeStudent(student, sessions, payments, opts = {}) {
  const periods = billingPeriods(student, sessions, opts);
  const billed = round2(periods.reduce((t, p) => t + p.amount, 0));
  const paid = round2(payments.reduce((t, p) => t + (Number(p.amount) || 0), 0));
  const balance = round2(billed - paid);

  // Payments recorded against a specific class settle that class first; the
  // rest is allocated oldest-period-first.
  const covered = new Map(periods.map((p) => [p.key, 0]));
  const periodOfSession = new Map();
  for (const p of periods) for (const id of p.sessionIds) periodOfSession.set(id, p);
  let remaining = 0;
  for (const pay of payments) {
    let amount = Number(pay.amount) || 0;
    const target = pay.sessionId ? periodOfSession.get(pay.sessionId) : null;
    if (target) {
      const take = Math.min(amount, Math.max(0, target.amount - covered.get(target.key)));
      covered.set(target.key, covered.get(target.key) + take);
      amount -= take;
    }
    remaining += amount;
  }

  const sessionStatus = new Map();
  let unpaidCount = 0;
  for (const p of periods) {
    const need = Math.max(0, p.amount - covered.get(p.key));
    const take = Math.min(need, remaining);
    remaining -= take;
    const got = covered.get(p.key) + take;
    const status = p.amount <= 0 || got >= p.amount - 0.005 ? "paid" : got > 0 ? "partial" : "unpaid";
    if (status !== "paid") unpaidCount++;
    for (const id of p.sessionIds) sessionStatus.set(id, status);
  }

  return {
    cycle: student.paymentCycle,
    chargePerUnit: student.paymentCycle === "daily" ? student.rate : student.billingAmount,
    units: periods.length,
    billed,
    paid,
    balance,
    owed: Math.max(balance, 0),
    credit: Math.max(-balance, 0),
    sessionStatus,
    unpaidCount,
  };
}

/** Amount billed per month (by month of each period's first class). */
export function billedByMonth(students, sessionsByStudent, monthKeys, opts = {}) {
  const out = new Map(monthKeys.map((k) => [k, 0]));
  for (const st of students) {
    for (const p of billingPeriods(st, sessionsByStudent.get(st.id) || [], opts)) {
      if (out.has(p.month)) out.set(p.month, round2(out.get(p.month) + p.amount));
    }
  }
  return out;
}

export function receivedByMonth(payments, monthKeys) {
  const out = new Map(monthKeys.map((k) => [k, 0]));
  for (const p of payments) {
    const k = monthKey(p.date);
    if (out.has(k)) out.set(k, round2(out.get(k) + p.amount));
  }
  return out;
}

/** Consecutive-day streak ending today (or yesterday, so it survives until you teach today). */
export function currentStreak(dates, today) {
  const set = new Set(dates);
  const d = new Date(`${today}T00:00:00`);
  if (!set.has(today)) d.setDate(d.getDate() - 1);
  let n = 0;
  for (;;) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!set.has(iso)) break;
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Plain-text payment reminder a tutor can paste into SMS/WhatsApp. */
export function reminderMessage({ student, summary, formatMoney, tutorName }) {
  const unit = CYCLE_LABELS[student.paymentCycle]?.unit || "class";
  const lines = [
    `Hello${student.guardian ? ` ${student.guardian}` : ""},`,
    "",
    `This is a friendly reminder that ${formatMoney(summary.owed)} is outstanding for ${student.name}'s tuition` +
      (summary.unpaidCount ? ` (${summary.unpaidCount} unpaid ${unit}${summary.unpaidCount === 1 ? "" : "s"}).` : "."),
    "",
    "Thank you!",
  ];
  if (tutorName) lines.push(tutorName);
  return lines.join("\n");
}
