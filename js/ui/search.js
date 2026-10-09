// Command-palette style global search (Ctrl/⌘+K or "/").
import * as store from "../store.js";
import { html, formatDuration } from "../lib/format.js";
import { relativeDay } from "../lib/dates.js";
import { $, $$, setHTML, icon, openDialog } from "./dom.js";
import { avatar, money, studentHref } from "../views/common.js";

let navigate = () => {};
let active = 0;

function matches(q, ...fields) {
  return fields.some((f) => f && String(f).toLowerCase().includes(q));
}

function results(q) {
  if (!q) {
    return {
      students: store.listStudents().slice(0, 8),
      sessions: [],
      payments: [],
    };
  }
  const students = store.listStudents({ archived: "all" }).filter((s) => matches(q, s.name, s.grade, s.phone, s.guardian, s.notes, ...s.subjects));
  const sessions = store.allSessions().filter((s) => matches(q, s.subject, s.notes)).slice(0, 8);
  const payments = store.allPayments().filter((p) => matches(q, p.note)).slice(0, 5);
  return { students: students.slice(0, 8), sessions, payments };
}

function render() {
  const q = $("#search-input").value.trim().toLowerCase();
  const r = results(q);
  const items = [];
  const section = (label, rows) => (rows.length ? html`<div class="group-label" role="presentation">${label}</div>${rows}` : "");
  const row = (href, inner) => {
    const i = items.length;
    items.push(href);
    return html`<a class="row" role="option" id="sr-${i}" href="${href}" aria-selected="${i === active}" data-index="${i}">${inner}</a>`;
  };

  const out = html`
    ${section(
      q ? "Students" : "Jump to student",
      r.students.map((s) =>
        row(
          studentHref(s.id),
          html`${avatar(s, "sm")}<div class="row-main"><div class="row-title"><span class="truncate">${s.name}</span>${s.archived ? html`<span class="badge">Archived</span>` : ""}</div><div class="row-sub truncate">${[s.grade, s.subjects.join(", ")].filter(Boolean).join(" · ")}</div></div>`,
        ),
      ),
    )}
    ${section(
      "Classes",
      r.sessions.map((s) => {
        const st = store.getStudent(s.studentId);
        return row(
          studentHref(s.studentId),
          html`${avatar(st, "sm")}<div class="row-main"><div class="row-title"><span class="truncate">${s.subject || "Class"}</span></div><div class="row-sub truncate">${st?.name} · ${relativeDay(s.date)} · ${formatDuration(s.duration)}${s.notes ? ` · ${s.notes}` : ""}</div></div>`,
        );
      }),
    )}
    ${section(
      "Payments",
      r.payments.map((p) => {
        const st = store.getStudent(p.studentId);
        return row(
          studentHref(p.studentId),
          html`${avatar(st, "sm")}<div class="row-main"><div class="row-title">${money(p.amount)}</div><div class="row-sub truncate">${st?.name} · ${relativeDay(p.date)} · ${p.note}</div></div>`,
        );
      }),
    )}
  `;
  setHTML(
    $("#search-results"),
    items.length
      ? out
      : html`<div class="empty compact"><div class="empty-icon">${icon("search")}</div><p>${q ? "No results." : "No students yet."}</p></div>`,
  );
  const input = $("#search-input");
  if (items.length) input.setAttribute("aria-activedescendant", `sr-${Math.min(active, items.length - 1)}`);
  else input.removeAttribute("aria-activedescendant");
  return items;
}

let items = [];

function move(delta) {
  if (!items.length) return;
  active = (active + delta + items.length) % items.length;
  $$("#search-results [role=option]").forEach((el) => el.setAttribute("aria-selected", String(Number(el.dataset.index) === active)));
  $(`#sr-${active}`)?.scrollIntoView({ block: "nearest" });
  $("#search-input").setAttribute("aria-activedescendant", `sr-${active}`);
}

export function initSearch(opts) {
  navigate = opts.navigate;
  const dialog = $("#search-dialog");
  const input = $("#search-input");
  input.addEventListener("input", () => {
    active = 0;
    items = render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      dialog.close();
      navigate(items[active]);
    }
  });
  $("#search-results").addEventListener("click", (e) => {
    if (e.target.closest("a.row")) dialog.close();
  });
}

export function openSearch() {
  const input = $("#search-input");
  input.value = "";
  active = 0;
  items = render();
  openDialog($("#search-dialog"), "#search-input");
}
