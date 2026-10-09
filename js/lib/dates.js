// Date helpers. All app dates are local calendar days stored as "YYYY-MM-DD".
// Never use Date#toISOString() for these: it converts to UTC and shifts the day
// for anyone east or west of Greenwich.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const pad2 = (n) => String(n).padStart(2, "0");

/** Local calendar day of a Date as "YYYY-MM-DD". */
export function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

/** Parse "YYYY-MM-DD" as local midnight. Returns null for anything invalid. */
export function parseISODate(str) {
  const m = ISO_RE.exec(String(str ?? ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

export const isValidISODate = (str) => parseISODate(str) !== null;

/** "YYYY-MM" for an ISO day string or Date. */
export function monthKey(value) {
  if (value instanceof Date) return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}`;
  return isValidISODate(value) ? String(value).slice(0, 7) : "";
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  if (!d) return "";
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** First day of the month `n` months away from `date`. */
export function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

/** The last `count` month keys ending with the month of `now`, oldest first. */
export function recentMonthKeys(count, now = new Date()) {
  const keys = [];
  for (let i = count - 1; i >= 0; i--) keys.push(monthKey(addMonths(now, -i)));
  return keys;
}

/**
 * ISO day of the first day of the week containing `iso`.
 * weekStart: 0 = Sunday … 6 = Saturday.
 */
export function weekStartOf(iso, weekStart = 0) {
  const d = parseISODate(iso);
  if (!d) return "";
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}

export function daysBetween(fromIso, toIso) {
  const a = parseISODate(fromIso);
  const b = parseISODate(toIso);
  if (!a || !b) return NaN;
  return Math.round((b - a) / 86400000);
}

export function formatDate(iso, opts = { day: "numeric", month: "short", year: "numeric" }, locale) {
  const d = parseISODate(iso);
  return d ? d.toLocaleDateString(locale, opts) : "—";
}

/** "Today", "Yesterday", weekday for the last week, otherwise a short date. */
export function relativeDay(iso, now = new Date(), locale) {
  const diff = daysBetween(iso, todayISO(now));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  if (diff > 1 && diff < 7) return formatDate(iso, { weekday: "long" }, locale);
  const sameYear = iso.slice(0, 4) === String(now.getFullYear());
  return formatDate(
    iso,
    sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" },
    locale,
  );
}

export function monthLabel(key, opts = { month: "short" }, locale) {
  const d = parseISODate(`${key}-01`);
  return d ? d.toLocaleDateString(locale, opts) : key;
}

export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
