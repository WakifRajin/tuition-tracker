// Shared view fragments.
import * as store from "../store.js";
import { html, formatMoney, formatDuration, initials } from "../lib/format.js";
import { parseISODate, relativeDay } from "../lib/dates.js";
import { icon } from "../ui/dom.js";

export const money = (n) => formatMoney(n, store.state.settings.currency);

export const studentHref = (id) => `#/students/${encodeURIComponent(id)}`;

export function avatar(student, size = "") {
  return html`<span class="avatar ${size}" style="--c:${student?.color || "var(--primary)"}" aria-hidden="true">${initials(student?.name)}</span>`;
}

export function emptyState({ iconName, title, body, actions = "" , compact = false}) {
  return html`<div class="empty ${compact ? "compact" : ""}">
    <div class="empty-icon">${icon(iconName)}</div>
    <h3>${title}</h3>
    ${body ? html`<p>${body}</p>` : ""}
    ${actions ? html`<div class="btn-row" style="justify-content:center">${actions}</div>` : ""}
  </div>`;
}

export function dateChip(iso) {
  const d = parseISODate(iso);
  if (!d) return "";
  return html`<span class="date-chip" aria-hidden="true">
    <div class="d">${d.getDate()}</div>
    <div class="m">${d.toLocaleDateString(undefined, { month: "short" })}</div>
  </span>`;
}

const STATUS = {
  paid: ["success", "Paid"],
  partial: ["warning", "Part paid"],
  unpaid: ["warning", "Unpaid"],
};

export function paymentBadge(status) {
  const [tone, label] = STATUS[status] || STATUS.unpaid;
  return html`<span class="badge ${tone}">${label}</span>`;
}

export function balanceBadge(summary) {
  if (summary.owed > 0) return html`<span class="badge danger">${money(summary.owed)} due</span>`;
  if (summary.credit > 0) return html`<span class="badge info">${money(summary.credit)} credit</span>`;
  return html`<span class="badge success">${icon("check")}Settled</span>`;
}

/**
 * A class row. `showStudent` shows the student's name (for mixed lists);
 * `actions` adds edit/delete buttons.
 */
export function sessionRow(session, { showStudent = false, actions = false, status = null } = {}) {
  const st = store.getStudent(session.studentId);
  const title = showStudent ? st?.name || "Unknown student" : session.subject || "Class";
  const subParts = [
    showStudent ? relativeDay(session.date) : null,
    formatDuration(session.duration),
    showStudent && session.subject ? session.subject : null,
  ].filter(Boolean);
  return html`<li>
    <div class="row">
      ${showStudent ? avatar(st, "sm") : dateChip(session.date)}
      <div class="row-main">
        <div class="row-title"><span class="truncate">${title}</span></div>
        <div class="row-sub truncate">${subParts.join(" · ")}</div>
        ${session.notes && actions ? html`<div class="row-note">${session.notes}</div>` : ""}
      </div>
      <div class="row-end">
        ${status ? paymentBadge(status) : ""}
        ${actions
          ? html`<button type="button" class="btn icon sm" data-action="edit-session" data-id="${session.id}" aria-label="Edit class on ${session.date}">${icon("edit")}</button>
              <button type="button" class="btn icon sm" data-action="delete-session" data-id="${session.id}" aria-label="Delete class on ${session.date}">${icon("trash")}</button>`
          : ""}
      </div>
    </div>
  </li>`;
}

const METHOD_LABELS = { cash: "Cash", bkash: "bKash", nagad: "Nagad", bank: "Bank", card: "Card", other: "Other" };

export function paymentRow(p, { showStudent = false, actions = false } = {}) {
  const st = store.getStudent(p.studentId);
  return html`<li>
    <div class="row">
      ${showStudent ? avatar(st, "sm") : dateChip(p.date)}
      <div class="row-main">
        <div class="row-title"><span class="truncate">${showStudent ? st?.name || "Unknown" : money(p.amount)}</span></div>
        <div class="row-sub truncate">${[showStudent ? relativeDay(p.date) : null, METHOD_LABELS[p.method], p.note].filter(Boolean).join(" · ")}</div>
      </div>
      <div class="row-end">
        ${showStudent ? html`<span class="row-amount" style="color:var(--success)">${money(p.amount)}</span>` : ""}
        ${actions
          ? html`<button type="button" class="btn icon sm" data-action="edit-payment" data-id="${p.id}" aria-label="Edit payment">${icon("edit")}</button>
              <button type="button" class="btn icon sm" data-action="delete-payment" data-id="${p.id}" aria-label="Delete payment">${icon("trash")}</button>`
          : ""}
      </div>
    </div>
  </li>`;
}
