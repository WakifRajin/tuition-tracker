// Application state. Holds normalized records in memory, applies changes
// optimistically and hands them to the active backend (local or cloud).
import { KINDS, NORMALIZERS, DEFAULT_SETTINGS, normalizeSettings, newId } from "./lib/model.js";
import { summarizeStudent } from "./lib/billing.js";

const listeners = new Set();
let backend = null;
let version = 0;
let emitQueued = false;

export const state = {
  students: new Map(),
  sessions: new Map(),
  payments: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  /** "local" | "synced" | "syncing" | "offline" | "error" */
  syncStatus: "local",
  syncError: null,
  ready: false,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  version++;
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    for (const fn of listeners) fn(state);
  });
}

let errorHandler = (err) => console.error(err);
export const onWriteError = (fn) => (errorHandler = fn);

// ---------------------------------------------------------------- backend

export async function useBackend(next) {
  backend?.stop?.();
  backend = next;
  for (const k of KINDS) state[k] = new Map();
  state.settings = { ...DEFAULT_SETTINGS };
  state.ready = false;
  emit();
  await next.start({
    onRecords(kind, records) {
      state[kind] = new Map(records.map((r) => [r.id, r]));
      emit();
    },
    onSettings(settings) {
      state.settings = normalizeSettings({ ...state.settings, ...settings });
      emit();
    },
    onStatus(status, error = null) {
      state.syncStatus = status;
      state.syncError = error;
      emit();
    },
  });
  state.ready = true;
  emit();
}

export const getBackend = () => backend;

function write(ops) {
  for (const op of ops) {
    if (op.type === "put") state[op.kind].set(op.record.id, op.record);
    else state[op.kind].delete(op.id);
  }
  emit();
  return Promise.resolve()
    .then(() => backend.write(ops))
    .catch((err) => {
      errorHandler(err);
      throw err;
    });
}

// ---------------------------------------------------------------- selectors

const memo = new Map();
function cached(key, fn) {
  const hit = memo.get(key);
  if (hit && hit.v === version) return hit.value;
  const value = fn();
  memo.set(key, { v: version, value });
  return value;
}

const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;

export function listStudents({ archived = false } = {}) {
  return cached(`students:${archived}`, () =>
    [...state.students.values()]
      .filter((s) => (archived === "all" ? true : s.archived === archived))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
  );
}

export const getStudent = (id) => state.students.get(id) || null;

export function allSessions() {
  return cached("sessions", () => [...state.sessions.values()].sort(byDateDesc));
}

export function allPayments() {
  return cached("payments", () => [...state.payments.values()].sort(byDateDesc));
}

export function sessionsByStudent() {
  return cached("sessionsByStudent", () => {
    const m = new Map();
    for (const s of allSessions()) {
      if (!m.has(s.studentId)) m.set(s.studentId, []);
      m.get(s.studentId).push(s);
    }
    return m;
  });
}

function paymentsByStudent() {
  return cached("paymentsByStudent", () => {
    const m = new Map();
    for (const p of allPayments()) {
      if (!m.has(p.studentId)) m.set(p.studentId, []);
      m.get(p.studentId).push(p);
    }
    return m;
  });
}

export const sessionsFor = (studentId) => sessionsByStudent().get(studentId) || [];
export const paymentsFor = (studentId) => paymentsByStudent().get(studentId) || [];

export function summaryFor(student) {
  return cached(`summary:${student.id}`, () =>
    summarizeStudent(student, sessionsFor(student.id), paymentsFor(student.id), {
      weekStart: state.settings.weekStart,
    }),
  );
}

export function subjectSuggestions(studentId) {
  const set = new Set(getStudent(studentId)?.subjects || []);
  for (const s of sessionsFor(studentId)) if (s.subject) set.add(s.subject);
  return [...set];
}

// ---------------------------------------------------------------- mutations

function stamp(kind, data, existing) {
  const now = Date.now();
  return NORMALIZERS[kind]({ ...existing, ...data, id: existing?.id ?? data.id ?? newId(), createdAt: existing?.createdAt ?? now, updatedAt: now }, now);
}

export function saveStudent(data, id = null) {
  const existing = id ? state.students.get(id) : null;
  const record = stamp("students", data, existing);
  write([{ type: "put", kind: "students", record }]);
  return record;
}

export function setStudentArchived(id, archived) {
  const s = state.students.get(id);
  if (s) saveStudent({ archived }, id);
}

/** Logs a class. If `paid` and the student pays per class, records a matching payment. */
export function logSession(data, { paid = false } = {}) {
  const student = state.students.get(data.studentId);
  if (!student) throw new Error("Unknown student");
  const record = stamp("sessions", {
    ...data,
    fee: student.paymentCycle === "daily" ? student.rate : null,
  });
  const ops = [{ type: "put", kind: "sessions", record }];
  if (paid && student.paymentCycle === "daily" && student.rate > 0) {
    ops.push({
      type: "put",
      kind: "payments",
      record: stamp("payments", {
        studentId: student.id,
        amount: student.rate,
        date: record.date,
        method: "cash",
        note: "Paid at class",
        sessionId: record.id,
      }),
    });
  }
  write(ops);
  return record;
}

export function updateSession(id, data) {
  const existing = state.sessions.get(id);
  if (!existing) return null;
  const record = stamp("sessions", data, existing);
  write([{ type: "put", kind: "sessions", record }]);
  return record;
}

export function savePayment(data, id = null) {
  const existing = id ? state.payments.get(id) : null;
  const record = stamp("payments", data, existing);
  write([{ type: "put", kind: "payments", record }]);
  return record;
}

/**
 * Deletes records and returns them so the caller can offer Undo via restore().
 * Deleting a student cascades to their sessions and payments.
 */
export function removeRecords(items) {
  const removed = [];
  const seen = new Set();
  const add = (kind, id) => {
    const key = `${kind}/${id}`;
    const record = state[kind].get(id);
    if (!record || seen.has(key)) return;
    seen.add(key);
    removed.push({ kind, record });
  };
  for (const { kind, id } of items) {
    add(kind, id);
    if (kind === "students") {
      for (const s of sessionsFor(id)) add("sessions", s.id);
      for (const p of paymentsFor(id)) add("payments", p.id);
    }
    if (kind === "sessions") {
      // A payment auto-created for this class goes with it.
      for (const p of state.payments.values()) if (p.sessionId === id) add("payments", p.id);
    }
  }
  write(removed.map(({ kind, record }) => ({ type: "delete", kind, id: record.id })));
  return removed;
}

export function restore(removed) {
  const now = Date.now();
  return write(removed.map(({ kind, record }) => ({ type: "put", kind, record: { ...record, updatedAt: now } })));
}

export function importRecords({ students = [], sessions = [], payments = [] }) {
  const ops = [
    ...students.map((record) => ({ type: "put", kind: "students", record })),
    ...sessions.map((record) => ({ type: "put", kind: "sessions", record })),
    ...payments.map((record) => ({ type: "put", kind: "payments", record })),
  ];
  return write(ops);
}

export function clearAll() {
  const ops = [];
  for (const kind of KINDS) for (const id of state[kind].keys()) ops.push({ type: "delete", kind, id });
  return write(ops);
}

export function saveSettings(partial) {
  state.settings = normalizeSettings({ ...state.settings, ...partial });
  emit();
  return Promise.resolve()
    .then(() => backend.saveSettings(state.settings))
    .catch((err) => errorHandler(err));
}

export function snapshot() {
  return {
    students: [...state.students.values()],
    sessions: [...state.sessions.values()],
    payments: [...state.payments.values()],
  };
}
