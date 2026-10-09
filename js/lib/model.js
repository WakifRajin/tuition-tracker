// Record shapes, validation and migration from the legacy (v2/v3) format.
import { isValidISODate, toISODate, todayISO } from "./dates.js";
import { normalizeCurrency } from "./format.js";

export const SCHEMA_VERSION = 4;
export const KINDS = ["students", "sessions", "payments"];
export const CYCLES = ["daily", "weekly", "monthly"];
export const PAYMENT_METHODS = ["cash", "bkash", "nagad", "bank", "card", "other"];
export const COLORS = ["#5b5ef4", "#f97316", "#16a34a", "#e11d48", "#ca8a04", "#9333ea", "#0891b2", "#db2777"];

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Record ids become Firestore document ids, which can't contain "/", be "." or
 * "..", or look like "__name__". Map anything unsafe to a stable safe form so
 * references (studentId, sessionId) still line up.
 */
export function safeId(v) {
  let id = String(v ?? "").trim().replace(/\//g, "_").slice(0, 200);
  if (!id || id === "." || id === ".." || /^__.*__$/.test(id)) id = `id-${id.replace(/\./g, "_")}`;
  return id;
}

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const nonNeg = (v, fallback = 0) => Math.max(0, num(v, fallback));
const ts = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  return 0;
};

/** Best-effort date for legacy rows whose id was Date.now(). */
function dateFromLegacyId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n > 1e12 && n < 1e13 ? toISODate(new Date(n)) : todayISO();
}

export function normalizeStudent(s, now = Date.now()) {
  const paymentCycle = CYCLES.includes(s?.paymentCycle) ? s.paymentCycle : "daily";
  const rate = nonNeg(s?.rate);
  const target = s?.monthlyTarget ?? s?.monthlyRequiredClasses;
  return {
    id: s?.id != null ? safeId(s.id) : newId(),
    name: str(s?.name, 120) || "Unnamed student",
    grade: str(s?.grade, 60),
    phone: str(s?.phone, 40),
    guardian: str(s?.guardian, 120),
    notes: str(s?.notes, 2000),
    subjects: Array.isArray(s?.subjects)
      ? [...new Set(s.subjects.map((x) => str(x, 60)).filter(Boolean))].slice(0, 20)
      : [],
    color: /^#[0-9a-f]{6}$/i.test(s?.color) ? s.color : COLORS[0],
    rate,
    paymentCycle,
    billingAmount: paymentCycle === "daily" ? rate : nonNeg(s?.billingAmount, rate),
    monthlyTarget: Math.round(nonNeg(target, 8)),
    archived: Boolean(s?.archived),
    createdAt: ts(s?.createdAt) || now,
    updatedAt: ts(s?.updatedAt) || now,
  };
}

export function normalizeSession(x, now = Date.now()) {
  const fee = x?.fee;
  return {
    id: x?.id != null ? safeId(x.id) : newId(),
    studentId: safeId(x?.studentId),
    date: isValidISODate(x?.date) ? x.date : dateFromLegacyId(x?.id),
    duration: Math.round(nonNeg(x?.duration, 60)) || 60,
    subject: str(x?.subject, 80),
    notes: str(x?.notes, 2000),
    // Fee is snapshotted when a per-class session is logged so later rate
    // changes never rewrite history. null = not billed per class.
    fee: fee === null || fee === undefined || fee === "" ? null : nonNeg(fee),
    createdAt: ts(x?.createdAt) || now,
    updatedAt: ts(x?.updatedAt) || now,
  };
}

export function normalizePayment(p, now = Date.now()) {
  return {
    id: p?.id != null ? safeId(p.id) : newId(),
    studentId: safeId(p?.studentId),
    amount: nonNeg(p?.amount),
    date: isValidISODate(p?.date) ? p.date : dateFromLegacyId(p?.id),
    method: PAYMENT_METHODS.includes(p?.method) ? p.method : "cash",
    note: str(p?.note, 300),
    sessionId: p?.sessionId ? safeId(p.sessionId) : null,
    createdAt: ts(p?.createdAt) || now,
    updatedAt: ts(p?.updatedAt) || now,
  };
}

export const NORMALIZERS = { students: normalizeStudent, sessions: normalizeSession, payments: normalizePayment };

export const DEFAULT_SETTINGS = Object.freeze({
  currency: "BDT",
  defaultDuration: 60,
  weekStart: 0,
});

export function normalizeSettings(s) {
  const dur = Math.round(num(s?.defaultDuration, 60));
  const ws = Math.round(num(s?.weekStart, 0));
  return {
    currency: normalizeCurrency(s?.currency),
    defaultDuration: dur >= 5 && dur <= 600 ? dur : 60,
    weekStart: ws >= 0 && ws <= 6 ? ws : 0,
  };
}

/**
 * Convert any supported data shape (legacy appData, a v4 export, or partial
 * input) into normalized arrays. Orphaned sessions/payments are dropped.
 * Legacy per-class sessions get the student's current rate as their fee, which
 * is exactly what the old version billed them at.
 */
export function migrateData(input, now = Date.now()) {
  const src = input && typeof input === "object" ? input : {};
  const students = (Array.isArray(src.students) ? src.students : []).map((s) => normalizeStudent(s, now));
  const byId = new Map(students.map((s) => [s.id, s]));

  const sessions = (Array.isArray(src.sessions) ? src.sessions : [])
    .map((raw) => {
      const s = normalizeSession(raw, now);
      const st = byId.get(s.studentId);
      if (!st) return null;
      if (s.fee === null && st.paymentCycle === "daily" && raw?.fee === undefined) s.fee = st.rate;
      return s;
    })
    .filter(Boolean);

  const payments = (Array.isArray(src.payments) ? src.payments : [])
    .map((p) => normalizePayment(p, now))
    .filter((p) => byId.has(p.studentId) && p.amount > 0);

  return { students, sessions, payments };
}

/** Validate an imported backup file. Returns migrated data or throws. */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
  if (!data || !Array.isArray(data.students)) throw new Error("That file doesn't look like a TuitionPro backup.");
  return {
    ...migrateData(data),
    settings: parsed.settings ? normalizeSettings(parsed.settings) : null,
  };
}

export function buildBackup({ students, sessions, payments }, settings) {
  return {
    app: "TuitionPro",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    data: { students, sessions, payments },
  };
}
