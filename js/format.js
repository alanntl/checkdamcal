// Number and date formatting shared by the UI.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** 12345.6 -> "12,346"; digits sets the decimals. Non-numbers -> "–". */
export function num(v, digits = 0) {
  if (!isNum(v)) return "–";
  // A value that rounds to zero prints as 0, never "-0.00"; negatives get a true minus sign.
  if (Math.abs(v) < 0.5 * 10 ** -digits) v = 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/^-/, "−");
}

/** Up to `digits` decimals, trailing zeros dropped: 157 -> "157", 98.43 -> "98.43". */
export function trim(v, digits = 2) {
  if (!isNum(v)) return "–";
  if (Math.abs(v) < 0.5 * 10 ** -digits) v = 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits }).replace(/^-/, "−");
}

/** Round to n significant figures, keeping thousands separators. */
export function sig(v, n = 3) {
  if (!isNum(v)) return "–";
  if (v === 0) return "0";
  const d = Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(v))));
  return num(v, Math.min(d, 6));
}

/** 0.3230 -> "32.3%" */
export function pct(v, digits = 1) {
  if (!isNum(v)) return "–";
  return `${num(v * 100, digits)}%`;
}

/** Signed percentage change, "+4.9%" / "−3.3%" (true minus sign). */
export function signedPct(v, digits = 1) {
  if (!isNum(v)) return "–";
  const s = num(Math.abs(v) * 100, digits);
  if (Math.abs(v) < 0.5 * 10 ** -(digits + 2)) return `0${digits ? "." + "0".repeat(digits) : ""}%`;
  return `${v > 0 ? "+" : "−"}${s}%`;
}

/** "2014-07-16" -> "16 Jul 2014" (or "16 Jul" with year:false). */
export function date(iso, { year = true } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "–");
  const s = `${+m[3]} ${MONTHS[+m[2] - 1]}`;
  return year ? `${s} ${m[1]}` : s;
}

/** Day number (days since epoch, may be fractional) -> "16 Jul 2014". */
export function dateFromDay(dayNumber, opts) {
  const d = new Date(Math.floor(dayNumber) * 86400000);
  return date(d.toISOString().slice(0, 10), opts);
}

/** "16 Jul – 12 Nov 2014", dropping the first year when both match. */
export function dateRange(a, b) {
  if (!a || !b) return "–";
  if (a.slice(0, 4) === b.slice(0, 4)) return `${date(a, { year: false })} – ${date(b)}`;
  return `${date(a)} – ${date(b)}`;
}

export function monthLabel(month, year) {
  return year == null ? MONTHS[month] : `${MONTHS[month]} ${year}`;
}

/** Parse a user-typed number; blank -> null, junk -> NaN. Accepts "1,234.5". */
export function parseNum(text) {
  if (text == null) return null;
  const s = String(text).trim().replace(/,/g, "");
  if (s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}
