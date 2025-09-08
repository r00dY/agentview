type RoundingMode = "floor" | "round" | "ceil";

interface AgoOptions {
  /** Compare against this moment (defaults to now). */
  now?: Date | number;
  /** Rounding strategy for the unit value. */
  round?: RoundingMode;
  /** Switch to date when older than this many days (strictly greater). */
  cutoffDays?: number;
  /** Optional override for locale; by default uses browser locale. */
  locale?: string | string[];
}

/**
 * One-part "time ago" formatter.
 * - <= cutoffDays → compact like "30s", "1m", "2h", "7d"
 * -  > cutoffDays → returns a date as MM/DD/YYYY or DD/MM/YYYY based on locale
 */
export function timeAgoShort(
  input: Date | number | string,
  opts: AgoOptions = {}
): string {
  const { now, round = "floor", cutoffDays = 7, locale } = opts;

  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid date");

  const nowMs =
    now instanceof Date
      ? now.getTime()
      : now !== undefined
      ? new Date(now).getTime()
      : Date.now();

  const diffMs = nowMs - date.getTime(); // >0 past, <0 future
  const abs = Math.abs(diffMs);

  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  // If older than cutoffDays → return date in locale-based slash order
  if (abs > cutoffDays * DAY) {
    return formatSlashDateByLocale(date, locale);
  }

  const applyRound = (v: number) =>
    round === "ceil" ? Math.ceil(v) : round === "round" ? Math.round(v) : Math.floor(v);

  if (abs >= DAY) return `${applyRound(abs / DAY)}d`;
  if (abs >= HOUR) return `${applyRound(abs / HOUR)}h`;
  if (abs >= MIN) return `${applyRound(abs / MIN)}m`;

  return "now";
  // return `${applyRound(abs / SEC)}s`;
}

/** Formats as DD/MM/YYYY or MM/DD/YYYY depending on the locale’s day/month order, using slashes. */
function formatSlashDateByLocale(date: Date, locale?: string | string[]): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const parts = fmt.formatToParts(date);

  const day = parts.find(p => p.type === "day")?.value
    ?? String(date.getDate()).padStart(2, "0");
  const month = parts.find(p => p.type === "month")?.value
    ?? String(date.getMonth() + 1).padStart(2, "0");
  const year = parts.find(p => p.type === "year")?.value
    ?? String(date.getFullYear());

  const iMonth = parts.findIndex(p => p.type === "month");
  const iDay = parts.findIndex(p => p.type === "day");
  const monthFirst = iMonth !== -1 && iDay !== -1 ? iMonth < iDay : false;

  return monthFirst ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}
