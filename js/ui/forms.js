// Student, session and payment dialogs.
import * as store from "../store.js";
import { COLORS } from "../lib/model.js";
import { CYCLE_LABELS } from "../lib/billing.js";
import { todayISO, formatDate, isValidISODate } from "../lib/dates.js";
import { html, formatMoney, currencySymbol, formatDuration } from "../lib/format.js";
import { $, $$, setHTML, toast, openDialog, setupDialog, icon } from "./dom.js";

const money = (n) => formatMoney(n, store.state.settings.currency);
const DURATION_PRESETS = [30, 45, 60, 90, 120];

let onNavigate = () => {};

export function initForms({ navigate }) {
  onNavigate = navigate;
  for (const d of $$("dialog")) setupDialog(d);
  initStudentForm();
  initSessionForm();
  initPaymentForm();
}

export function refreshCurrency() {
  const sym = currencySymbol(store.state.settings.currency);
  $$(".currency-symbol").forEach((el) => (el.textContent = sym));
}

// ================================================================ student

let editingStudentId = null;
let subjects = [];

function renderSubjects() {
  const wrap = $("#s-subjects");
  const input = $("#s-subject-input");
  $$(".tag", wrap).forEach((t) => t.remove());
  for (const s of subjects) {
    const tag = document.createElement("span");
    tag.className = "tag";
    setHTML(tag, html`${s}<button type="button" aria-label="Remove ${s}" data-remove-subject="${s}">${icon("x")}</button>`);
    wrap.insertBefore(tag, input);
  }
}

function addSubjectFromInput() {
  const input = $("#s-subject-input");
  const parts = input.value.split(",").map((v) => v.trim()).filter(Boolean);
  for (const p of parts) if (!subjects.some((s) => s.toLowerCase() === p.toLowerCase())) subjects.push(p);
  input.value = "";
  renderSubjects();
}

function syncCycleFields() {
  const form = $("#student-form");
  const cycle = form.paymentCycle.value;
  const label = $("#s-amount-label");
  const hint = $("#s-amount-hint");
  if (cycle === "daily") {
    label.textContent = "Fee per class";
    hint.textContent = "Each class you log is billed at this fee. Changing it later won't affect classes already logged.";
  } else if (cycle === "weekly") {
    label.textContent = "Fee per week";
    hint.textContent = "Billed once for every week with at least one class.";
  } else {
    label.textContent = "Fee per month";
    hint.textContent = "Billed once for every month with at least one class.";
  }
}

function initStudentForm() {
  const form = $("#student-form");
  const dialog = $("#student-dialog");

  setHTML(
    $("#s-colors"),
    html`${COLORS.map(
      (c, i) => html`<label style="--c:${c}"><input type="radio" name="color" value="${c}" aria-label="Colour ${i + 1}" /></label>`,
    )}`,
  );

  form.addEventListener("change", (e) => {
    if (e.target.name === "paymentCycle") syncCycleFields();
  });

  const subjectInput = $("#s-subject-input");
  subjectInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSubjectFromInput();
    } else if (e.key === "Backspace" && !subjectInput.value && subjects.length) {
      subjects.pop();
      renderSubjects();
    }
  });
  subjectInput.addEventListener("blur", addSubjectFromInput);
  $("#s-subjects").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-subject]");
    if (btn) {
      subjects = subjects.filter((s) => s !== btn.dataset.removeSubject);
      renderSubjects();
      subjectInput.focus();
    } else if (e.target === e.currentTarget) subjectInput.focus();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    addSubjectFromInput();
    if (!form.reportValidity()) return;
    const cycle = form.paymentCycle.value;
    const amount = Math.max(0, Number(form.amount.value) || 0);
    const existing = editingStudentId ? store.getStudent(editingStudentId) : null;
    const data = {
      name: form.name.value,
      grade: form.grade.value,
      phone: form.phone.value,
      guardian: form.guardian.value,
      notes: form.notes.value,
      subjects: [...subjects],
      color: form.color.value || COLORS[0],
      monthlyTarget: form.monthlyTarget.value === "" ? 0 : Number(form.monthlyTarget.value),
      paymentCycle: cycle,
      // Keep the per-class rate around when switching to weekly/monthly.
      rate: cycle === "daily" ? amount : (existing?.rate ?? 0),
      billingAmount: amount,
    };
    const record = store.saveStudent(data, editingStudentId);
    dialog.close("saved");
    toast(editingStudentId ? `Saved ${record.name}` : `Added ${record.name}`);
    if (!editingStudentId) onNavigate(`#/students/${encodeURIComponent(record.id)}`);
  });
}

export function openStudentForm(id = null) {
  const form = $("#student-form");
  form.reset();
  const s = id ? store.getStudent(id) : null;
  editingStudentId = s ? s.id : null;
  subjects = s ? [...s.subjects] : [];
  $("#student-dialog-title").textContent = s ? "Edit student" : "Add student";
  $("#student-submit").textContent = s ? "Save changes" : "Add student";

  const used = new Set(store.listStudents({ archived: "all" }).map((x) => x.color));
  const color = s?.color || COLORS.find((c) => !used.has(c)) || COLORS[store.state.students.size % COLORS.length];
  form.name.value = s?.name || "";
  form.grade.value = s?.grade || "";
  form.monthlyTarget.value = s ? s.monthlyTarget : 8;
  form.phone.value = s?.phone || "";
  form.guardian.value = s?.guardian || "";
  form.notes.value = s?.notes || "";
  form.paymentCycle.value = s?.paymentCycle || "daily";
  const amount = s ? (s.paymentCycle === "daily" ? s.rate : s.billingAmount) : "";
  form.amount.value = amount === 0 && !s ? "" : amount;
  const radio = $(`input[name="color"][value="${color}"]`, form) || $('input[name="color"]', form);
  radio.checked = true;
  renderSubjects();
  syncCycleFields();
  refreshCurrency();
  openDialog($("#student-dialog"), "#s-name");
}

// ================================================================ session

let editingSessionId = null;

function syncDurationPresets() {
  const val = Number($("#session-duration").value);
  $$("#duration-presets button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.min) === val)));
}

function syncSessionStudent() {
  const id = $("#session-student").value;
  const s = store.getStudent(id);
  const paidWrap = $("#session-paid-wrap");
  const perClass = s && s.paymentCycle === "daily" && s.rate > 0;
  paidWrap.hidden = Boolean(editingSessionId) || !perClass;
  if (perClass) $("#session-paid-hint").textContent = `Records a ${money(s.rate)} payment along with this class.`;
  setHTML($("#session-subject-list"), html`${(s ? store.subjectSuggestions(s.id) : []).map((x) => html`<option value="${x}"></option>`)}`);
  $("#session-dialog-sub").textContent = s && $("#session-student-field").hidden ? s.name : "";
}

function initSessionForm() {
  const form = $("#session-form");
  setHTML(
    $("#duration-presets"),
    html`${DURATION_PRESETS.map((m) => html`<button type="button" data-min="${m}" aria-pressed="false">${formatDuration(m)}</button>`)}`,
  );
  $("#duration-presets").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $("#session-duration").value = b.dataset.min;
    syncDurationPresets();
  });
  $("#session-duration").addEventListener("input", syncDurationPresets);
  $("#session-student").addEventListener("change", syncSessionStudent);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (!isValidISODate(form.date.value)) return;
    const data = {
      studentId: form.studentId.value,
      date: form.date.value,
      duration: Number(form.duration.value),
      subject: form.subject.value,
      notes: form.notes.value,
    };
    if (editingSessionId) {
      store.updateSession(editingSessionId, data);
      toast("Class updated");
    } else {
      const s = store.getStudent(data.studentId);
      store.logSession(data, { paid: form.paid.checked });
      toast(`Logged ${formatDuration(data.duration)} with ${s?.name ?? "student"} · ${formatDate(data.date, { day: "numeric", month: "short" })}`);
      try {
        localStorage.setItem("tuitionpro.lastStudent", data.studentId);
      } catch {
        /* ignore */
      }
    }
    $("#session-dialog").close("saved");
  });
}

/**
 * Open the class dialog.
 * @param {{studentId?: string, date?: string, sessionId?: string}} opts
 */
export function openSessionForm({ studentId = null, date = null, sessionId = null } = {}) {
  const active = store.listStudents();
  const existing = sessionId ? store.state.sessions.get(sessionId) : null;
  if (!existing && !active.length) {
    toast("Add a student first");
    openStudentForm();
    return;
  }
  const form = $("#session-form");
  form.reset();
  editingSessionId = existing?.id || null;

  let lastStudent = null;
  try {
    lastStudent = localStorage.getItem("tuitionpro.lastStudent");
  } catch {
    /* ignore */
  }
  const chosen = existing?.studentId || studentId || (active.some((s) => s.id === lastStudent) ? lastStudent : active[0]?.id);
  const options = [...active];
  const chosenStudent = store.getStudent(chosen);
  if (chosenStudent && !options.includes(chosenStudent)) options.unshift(chosenStudent);
  setHTML($("#session-student"), html`${options.map((s) => html`<option value="${s.id}">${s.name}${s.grade ? ` · ${s.grade}` : ""}</option>`)}`);
  form.studentId.value = chosen;

  // When opened from a student's page, the student is fixed.
  $("#session-student-field").hidden = Boolean(existing || studentId);
  form.date.value = existing?.date || date || todayISO();
  form.date.max = "";
  form.duration.value = existing?.duration || store.state.settings.defaultDuration;
  form.subject.value = existing?.subject || "";
  form.notes.value = existing?.notes || "";
  $("#session-dialog-title").textContent = existing ? "Edit class" : "Log a class";
  setHTML($("#session-submit"), html`${icon("check")}${existing ? "Save changes" : "Log class"}`);
  syncSessionStudent();
  syncDurationPresets();
  openDialog($("#session-dialog"), existing || studentId ? "#session-subject" : "#session-student");
}

// ================================================================ payment

let paymentStudentId = null;
let editingPaymentId = null;

function initPaymentForm() {
  const form = $("#payment-form");
  $("#payment-presets").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    form.amount.value = b.dataset.amount;
    form.amount.focus();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const amount = Number(form.amount.value);
    if (!(amount > 0)) return;
    store.savePayment(
      { studentId: paymentStudentId, amount, date: form.date.value || todayISO(), method: form.method.value, note: form.note.value },
      editingPaymentId,
    );
    toast(editingPaymentId ? "Payment updated" : `Recorded ${money(amount)}`);
    $("#payment-dialog").close("saved");
  });
}

export function openPaymentForm(studentId, paymentId = null) {
  const s = store.getStudent(studentId);
  if (!s) return;
  const existing = paymentId ? store.state.payments.get(paymentId) : null;
  paymentStudentId = s.id;
  editingPaymentId = existing?.id || null;
  const form = $("#payment-form");
  form.reset();
  const summary = store.summaryFor(s);
  $("#payment-dialog-title").textContent = existing ? "Edit payment" : "Record payment";
  $("#payment-dialog-sub").textContent = existing
    ? s.name
    : `${s.name} · ${summary.owed > 0 ? `${money(summary.owed)} outstanding` : summary.credit > 0 ? `${money(summary.credit)} in credit` : "nothing outstanding"}`;
  form.amount.value = existing ? existing.amount : summary.owed > 0 ? summary.owed : "";
  form.date.value = existing?.date || todayISO();
  form.method.value = existing?.method || "cash";
  form.note.value = existing?.note || "";

  const presets = new Set();
  if (!existing) {
    if (summary.owed > 0) presets.add(summary.owed);
    if (summary.chargePerUnit > 0) {
      presets.add(summary.chargePerUnit);
      if (s.paymentCycle !== "monthly") presets.add(summary.chargePerUnit * (s.paymentCycle === "daily" ? s.monthlyTarget || 8 : 4));
    }
  }
  const unit = CYCLE_LABELS[s.paymentCycle].unit;
  setHTML(
    $("#payment-presets"),
    html`${[...presets]
      .filter((v) => v > 0)
      .sort((a, b) => a - b)
      .map(
        (v) =>
          html`<button type="button" data-amount="${v}" aria-pressed="false">${money(v)}${v === summary.owed ? " · all due" : v === summary.chargePerUnit ? ` · 1 ${unit}` : ""}</button>`,
      )}`,
  );
  $("#payment-presets").style.marginTop = presets.size ? "6px" : "0";
  refreshCurrency();
  openDialog($("#payment-dialog"), "#payment-amount");
}
