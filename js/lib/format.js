// Formatting and safe HTML templating.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"'`]/g, (c) => ESC[c]);
}

/** Marks a string as trusted HTML so `html` will not escape it. */
class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new SafeHtml(String(value ?? ""));

function interpolate(value) {
  if (value == null || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  return escapeHtml(value);
}

/**
 * Tagged template that escapes every interpolated value unless it is wrapped in
 * raw() or is itself the result of html``. Arrays are joined. null/false render
 * nothing, so `${cond && html`…`}` works.
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += interpolate(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export const CURRENCIES = [
  { code: "BDT", label: "Bangladeshi Taka" },
  { code: "INR", label: "Indian Rupee" },
  { code: "PKR", label: "Pakistani Rupee" },
  { code: "NPR", label: "Nepalese Rupee" },
  { code: "LKR", label: "Sri Lankan Rupee" },
  { code: "USD", label: "US Dollar" },
  { code: "CAD", label: "Canadian Dollar" },
  { code: "AUD", label: "Australian Dollar" },
  { code: "GBP", label: "British Pound" },
  { code: "EUR", label: "Euro" },
  { code: "AED", label: "UAE Dirham" },
  { code: "SAR", label: "Saudi Riyal" },
  { code: "MYR", label: "Malaysian Ringgit" },
  { code: "SGD", label: "Singapore Dollar" },
  { code: "NGN", label: "Nigerian Naira" },
  { code: "JPY", label: "Japanese Yen" },
];

// Earlier versions stored the symbol itself.
const LEGACY_SYMBOLS = { "৳": "BDT", "₹": "INR", $: "USD", "£": "GBP", "€": "EUR", "¥": "JPY" };

export function normalizeCurrency(value) {
  if (LEGACY_SYMBOLS[value]) return LEGACY_SYMBOLS[value];
  return CURRENCIES.some((c) => c.code === value) ? value : "BDT";
}

const formatterCache = new Map();

export function formatMoney(amount, currency = "BDT") {
  const key = currency;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    }
    formatterCache.set(key, fmt);
  }
  return fmt.format(Number(amount) || 0);
}

export function currencySymbol(currency = "BDT") {
  const part = (() => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
        .formatToParts(0)
        .find((p) => p.type === "currency");
    } catch {
      return null;
    }
  })();
  return part?.value || currency;
}

export function formatNumber(n, maxFractionDigits = 1) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: maxFractionDigits }).format(Number(n) || 0);
}

/** 90 -> "1h 30m", 60 -> "1h", 45 -> "45m" */
export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export const plural = (n, one, many = `${one}s`) => `${formatNumber(n, 0)} ${n === 1 ? one : many}`;

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Escape a value for a CSV cell. */
export function csvCell(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const s = String(value ?? "");
  // Neutralise spreadsheet formula injection in free text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
