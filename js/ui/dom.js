// Small DOM utilities: queries, icons, toasts and dialog helpers.
import { html, raw } from "../lib/format.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const icon = (name, cls = "") => raw(`<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`);

export function setHTML(el, content) {
  el.innerHTML = String(content);
}

// ---------------------------------------------------------------- toasts

const TOAST_MS = 4500;

/**
 * Shows a toast. `action` = { label, onClick } adds a button (e.g. Undo).
 * Returns a function that dismisses it.
 */
export function toast(message, { action, tone = "", duration } = {}) {
  const host = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${tone}`;
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  setHTML(el, html`<span class="msg">${message}</span>${action ? html`<button type="button" class="btn sm">${action.label}</button>` : ""}`);
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  };
  if (action) {
    el.querySelector("button").addEventListener("click", () => {
      dismiss();
      action.onClick();
    });
  }
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  timer = setTimeout(dismiss, duration ?? (action ? 7000 : TOAST_MS));
  el.addEventListener("pointerenter", () => clearTimeout(timer));
  el.addEventListener("pointerleave", () => (timer = setTimeout(dismiss, 2000)));
  return dismiss;
}

export const toastError = (message) => toast(message, { tone: "error", duration: 7000 });

// ---------------------------------------------------------------- dialogs

const supportsClosedBy = typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;

/** Wires close buttons and a light-dismiss fallback for browsers without `closedby`. */
export function setupDialog(dialog) {
  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) {
      dialog.close("cancel");
      return;
    }
    if (supportsClosedBy || e.target !== dialog || dialog.getAttribute("closedby") !== "any") return;
    const r = dialog.getBoundingClientRect();
    const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
    if (!inside) dialog.close("cancel");
  });
}

export function openDialog(dialog, focusSelector) {
  if (!dialog.open) dialog.showModal();
  const target = focusSelector ? $(focusSelector, dialog) : null;
  if (target) requestAnimationFrame(() => target.focus());
}

/**
 * Promise-based confirmation. Resolves true when confirmed.
 * `typeToConfirm` requires the user to type an exact phrase first.
 */
export async function confirmDialog(opts) {
  const dialog = $("#confirm-dialog");
  // One confirmation at a time: wait for any open one to finish.
  while (dialog.open) await new Promise((r) => dialog.addEventListener("close", r, { once: true }));
  return showConfirm(dialog, opts);
}

function showConfirm(dialog, { title, message, confirmLabel = "Confirm", tone = "danger", iconName = "alert", typeToConfirm = null }) {
  $("#confirm-title").textContent = title;
  $("#confirm-msg").textContent = message;
  const ok = $("#confirm-ok");
  ok.textContent = confirmLabel;
  ok.className = `btn ${tone === "danger" ? "danger" : "primary"}`;
  const ic = $("#confirm-icon");
  ic.className = `confirm-icon ${tone === "danger" ? "" : "info"}`;
  setHTML(ic, icon(iconName));

  const typeWrap = $("#confirm-type-wrap");
  const typeInput = $("#confirm-type");
  typeWrap.hidden = !typeToConfirm;
  typeInput.value = "";
  ok.disabled = Boolean(typeToConfirm);
  const onType = () => (ok.disabled = typeInput.value.trim() !== typeToConfirm);
  if (typeToConfirm) {
    $("#confirm-type-label").textContent = `Type "${typeToConfirm}" to confirm`;
    typeInput.addEventListener("input", onType);
  }

  dialog.returnValue = "";
  dialog.showModal();
  (typeToConfirm ? typeInput : dialog.querySelector('button[value="cancel"]')).focus();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        typeInput.removeEventListener("input", onType);
        resolve(dialog.returnValue === "ok");
      },
      { once: true },
    );
  });
}

/** Debounce helper. */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
