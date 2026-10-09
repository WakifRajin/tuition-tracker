// Device-only storage in localStorage. Also migrates data from v2/v3, which
// kept everything under "tuitionData_v2" / "tuitionPrefs".
import { KINDS, migrateData, normalizeSettings, NORMALIZERS, SCHEMA_VERSION } from "../lib/model.js";

export const LOCAL_KEY = "tuitionpro.v4.local";
const LEGACY_DATA_KEY = "tuitionData_v2";
const LEGACY_PREFS_KEY = "tuitionPrefs";

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Read the local bucket (migrating legacy data if needed) without starting a backend. */
export function readLocalData() {
  const stored = readJSON(LOCAL_KEY);
  if (stored?.schemaVersion >= SCHEMA_VERSION) {
    return {
      students: (stored.students || []).map((r) => NORMALIZERS.students(r)),
      sessions: (stored.sessions || []).map((r) => NORMALIZERS.sessions(r)),
      payments: (stored.payments || []).map((r) => NORMALIZERS.payments(r)),
      settings: normalizeSettings(stored.settings),
      migrated: false,
    };
  }
  const legacy = readJSON(LEGACY_DATA_KEY);
  const legacyPrefs = readJSON(LEGACY_PREFS_KEY);
  return { ...migrateData(legacy || {}), settings: normalizeSettings(legacyPrefs || {}), migrated: Boolean(legacy) };
}

export function hasLocalData() {
  return readLocalData().students.length > 0;
}

export function clearLocalData() {
  try {
    localStorage.removeItem(LOCAL_KEY);
    localStorage.removeItem(LEGACY_DATA_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export class LocalBackend {
  constructor() {
    this.data = null;
    this.onStorage = null;
  }

  async start(handlers) {
    this.handlers = handlers;
    this.load();
    if (this.data.migrated) this.persist();
    this.onStorage = (e) => {
      if (e.key === LOCAL_KEY) this.load();
    };
    window.addEventListener("storage", this.onStorage);
    handlers.onStatus("local");
  }

  load() {
    const d = readLocalData();
    this.data = {
      students: new Map(d.students.map((r) => [r.id, r])),
      sessions: new Map(d.sessions.map((r) => [r.id, r])),
      payments: new Map(d.payments.map((r) => [r.id, r])),
      settings: d.settings,
      migrated: d.migrated,
    };
    for (const k of KINDS) this.handlers.onRecords(k, [...this.data[k].values()]);
    this.handlers.onSettings(this.data.settings);
  }

  persist() {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: Date.now(),
      settings: this.data.settings,
      students: [...this.data.students.values()],
      sessions: [...this.data.sessions.values()],
      payments: [...this.data.payments.values()],
    };
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
    } catch (err) {
      const e = new Error(
        err?.name === "QuotaExceededError"
          ? "This device is out of storage space. Export a backup and free some space."
          : "Couldn't save to this device's storage.",
      );
      e.cause = err;
      throw e;
    }
  }

  async write(ops) {
    for (const op of ops) {
      if (op.type === "put") this.data[op.kind].set(op.record.id, op.record);
      else this.data[op.kind].delete(op.id);
    }
    this.persist();
  }

  async saveSettings(settings) {
    this.data.settings = settings;
    this.persist();
  }

  stop() {
    if (this.onStorage) window.removeEventListener("storage", this.onStorage);
  }
}
