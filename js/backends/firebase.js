// Firebase loading, authentication and the Firestore backend.
//
// Data layout (schema v4):
//   users/{uid}                     { settings, schemaVersion, email, displayName, updatedAt }
//   users/{uid}/students/{id}
//   users/{uid}/sessions/{id}
//   users/{uid}/payments/{id}
//
// v3 kept everything in users/{uid}.appData; that blob is migrated on first
// sign-in and left in place as a backup.
import { KINDS, NORMALIZERS, migrateData, normalizeSettings, SCHEMA_VERSION } from "../lib/model.js";

const SDK = "https://www.gstatic.com/firebasejs/12.11.0";

// Firebase web config is public by design; access is enforced by firestore.rules.
const firebaseConfig = {
  apiKey: "AIzaSyC8oo9OfFR_oJfBvK3mKw425TnCoWEG6zs",
  authDomain: "tuitionpro-d1856.firebaseapp.com",
  projectId: "tuitionpro-d1856",
  storageBucket: "tuitionpro-d1856.firebasestorage.app",
  messagingSenderId: "475690490967",
  appId: "1:475690490967:web:6511277326958ee96f5712",
  measurementId: "G-7Y7VHXZ2VL",
};

let loading = null;

/** Lazily loads the Firebase SDK. Rejects if the CDN is unreachable. */
export function loadFirebase(timeoutMs = 15000) {
  loading ??= (async () => {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("Timed out loading sign-in")), timeoutMs));
    const [appMod, authMod, fs] = await Promise.race([
      Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]),
      timeout,
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    let db;
    try {
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch {
      db = fs.getFirestore(app);
    }
    return { authMod, fs, auth, db };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

const AUTH_ERRORS = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-password": "Enter your password.",
  "auth/user-not-found": "No account found with that email.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/email-already-in-use": "An account with that email already exists. Try signing in.",
  "auth/weak-password": "Choose a stronger password (at least 8 characters).",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/popup-closed-by-user": null,
  "auth/cancelled-popup-request": null,
  "auth/user-disabled": "This account has been disabled.",
  "auth/unauthorized-domain": "Google sign-in isn't enabled for this domain yet.",
  "auth/operation-not-allowed": "This sign-in method isn't enabled.",
  "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
  "auth/operation-not-supported-in-this-environment": "Google sign-in isn't supported here. Open TuitionPro in your browser, or use email and password.",
};

/** Human-readable auth error, or null when the error should be ignored. */
export function authErrorMessage(err) {
  if (err?.code in AUTH_ERRORS) return AUTH_ERRORS[err.code];
  return err?.message || "Something went wrong. Please try again.";
}

export function createAuth(fb) {
  const { authMod: a, auth } = fb;
  return {
    onChange: (cb) => a.onAuthStateChanged(auth, cb),
    signIn: (email, password) => a.signInWithEmailAndPassword(auth, email, password),
    async signUp(email, password, name) {
      const cred = await a.createUserWithEmailAndPassword(auth, email, password);
      if (name) await a.updateProfile(cred.user, { displayName: name });
      return cred;
    },
    resetPassword: (email) => a.sendPasswordResetEmail(auth, email),
    async signInWithGoogle() {
      const provider = new a.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      // Popup only: redirect sign-in breaks on browsers that partition
      // third-party storage when the app isn't hosted on the authDomain.
      return a.signInWithPopup(auth, provider);
    },
    /** Surfaces errors from a previous redirect sign-in. */
    checkRedirect: () => a.getRedirectResult(auth),
    async signOut() {
      await a.signOut(auth);
      // Don't leave the previous user's data cached on a shared device.
      try {
        await fb.fs.terminate(fb.db);
        await fb.fs.clearIndexedDbPersistence(fb.db);
      } catch {
        /* best effort */
      }
    },
  };
}

const BATCH_LIMIT = 400;

export class CloudBackend {
  constructor(fb, user) {
    this.fb = fb;
    this.user = user;
    this.unsubs = [];
    this.pending = new Set();
    this.serverSynced = new Set();
    this.error = null;
    this.serverReady = new Promise((res) => (this.resolveServerReady = res));
  }

  get userRef() {
    return this.fb.fs.doc(this.fb.db, "users", this.user.uid);
  }

  async start(handlers) {
    const fs = this.fb.fs;
    this.handlers = handlers;
    await this.migrateLegacy();

    const firstSnapshots = KINDS.map(
      (kind) =>
        new Promise((resolve) => {
          const unsub = fs.onSnapshot(
            fs.collection(this.userRef, kind),
            { includeMetadataChanges: true },
            (snap) => {
              const normalize = NORMALIZERS[kind];
              handlers.onRecords(kind, snap.docs.map((d) => normalize({ ...d.data(), id: d.id })));
              if (snap.metadata.hasPendingWrites) this.pending.add(kind);
              else this.pending.delete(kind);
              if (!snap.metadata.fromCache) {
                this.serverSynced.add(kind);
                if (this.serverSynced.size === KINDS.length) this.resolveServerReady();
              }
              this.error = null;
              this.reportStatus();
              resolve();
            },
            (err) => {
              this.error = err;
              this.reportStatus();
              resolve();
            },
          );
          this.unsubs.push(unsub);
        }),
    );

    this.unsubs.push(
      fs.onSnapshot(
        this.userRef,
        (snap) => {
          const settings = snap.data()?.settings;
          if (settings) handlers.onSettings(normalizeSettings(settings));
        },
        () => {},
      ),
    );

    this.onNetwork = () => this.reportStatus();
    window.addEventListener("online", this.onNetwork);
    window.addEventListener("offline", this.onNetwork);

    // Don't block the UI forever when offline with an empty cache.
    await Promise.race([Promise.all(firstSnapshots), new Promise((r) => setTimeout(r, 4000))]);
  }

  reportStatus() {
    if (this.error) {
      const denied = this.error.code === "permission-denied";
      this.handlers.onStatus(
        "error",
        denied
          ? "The cloud refused access. The Firestore security rules may need updating (see README)."
          : this.error.message,
      );
    } else if (!navigator.onLine) this.handlers.onStatus("offline");
    else if (this.pending.size) this.handlers.onStatus("syncing");
    else this.handlers.onStatus("synced");
  }

  async migrateLegacy() {
    const fs = this.fb.fs;
    let data;
    try {
      const snap = await fs.getDoc(this.userRef);
      data = snap.exists() ? snap.data() : null;
    } catch {
      return; // Offline with nothing cached: try again next launch.
    }
    const profile = { email: this.user.email || "", displayName: this.user.displayName || "" };
    if (!data) {
      fs.setDoc(this.userRef, { ...profile, schemaVersion: SCHEMA_VERSION, createdAt: fs.serverTimestamp() }, { merge: true }).catch(() => {});
      return;
    }
    if (!data.appData) return;
    // v3 clients (e.g. an old tab left open on another device) keep writing to
    // appData. Re-import whenever it changed after our last import.
    const legacyTime = data.lastUpdated?.toMillis?.() ?? 0;
    const upToDate = data.schemaVersion >= SCHEMA_VERSION && legacyTime <= (data.legacyImportedAt ?? 0);
    if (upToDate) return;

    // Only add records the subcollections don't already have, so a re-run
    // never reverts edits made in the new version.
    const existing = {};
    try {
      for (const kind of KINDS) {
        const snap = await fs.getDocs(fs.collection(this.userRef, kind));
        existing[kind] = new Set(snap.docs.map((d) => d.id));
      }
    } catch {
      return; // Can't tell what's there yet: try again next launch.
    }
    const migrated = migrateData(data.appData);
    const ops = [];
    for (const kind of KINDS) {
      for (const record of migrated[kind]) if (!existing[kind].has(record.id)) ops.push({ type: "put", kind, record });
    }
    const marker = { ...profile, schemaVersion: SCHEMA_VERSION, legacyImportedAt: legacyTime };
    if (!(data.schemaVersion >= SCHEMA_VERSION)) {
      marker.settings = normalizeSettings(data.settings || data.prefs || {});
      marker.migratedAt = fs.serverTimestamp();
    }
    // The marker goes in the final batch, which Firestore delivers last.
    this.commit(ops, (batch) => batch.set(this.userRef, marker, { merge: true })).catch((err) => console.error("Migration failed", err));
  }

  /** Writes ops in batches. Resolves once the server has acknowledged them (never while offline). */
  commit(ops, finalize) {
    const fs = this.fb.fs;
    const chunks = [];
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) chunks.push(ops.slice(i, i + BATCH_LIMIT));
    if (!chunks.length) {
      if (!finalize) return Promise.resolve();
      chunks.push([]);
    }
    const batches = chunks.map((chunk, idx) => {
      const batch = fs.writeBatch(this.fb.db);
      for (const op of chunk) {
        const ref = fs.doc(this.userRef, op.kind, op.type === "put" ? op.record.id : op.id);
        if (op.type === "put") batch.set(ref, op.record);
        else batch.delete(ref);
      }
      if (finalize && idx === chunks.length - 1) finalize(batch);
      return batch;
    });
    // Commit all at once: Firestore applies them to its persistent cache
    // immediately and sends them to the server in order, so a marker in the
    // final batch still lands last, and nothing is lost if the tab closes.
    return Promise.all(batches.map((b) => b.commit()));
  }

  write(ops) {
    // Firestore applies writes to its local cache synchronously; the snapshot
    // listeners pick them up immediately. Commits resolve when the server acks,
    // so we only surface rejections rather than waiting on them.
    this.commit(ops).catch((err) => {
      this.error = err;
      this.reportStatus();
      this.handlers.onError?.(err);
    });
    return Promise.resolve();
  }

  saveSettings(settings) {
    const fs = this.fb.fs;
    fs.setDoc(this.userRef, { settings, updatedAt: fs.serverTimestamp() }, { merge: true }).catch((err) => {
      this.error = err;
      this.reportStatus();
    });
    return Promise.resolve();
  }

  /** Resolves when every collection has been confirmed by the server (or after `ms`). */
  waitForServer(ms = 8000) {
    return Promise.race([this.serverReady.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
  }

  stop() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.onNetwork) {
      window.removeEventListener("online", this.onNetwork);
      window.removeEventListener("offline", this.onNetwork);
    }
  }
}
