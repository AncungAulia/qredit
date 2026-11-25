const DECIMALS = 6n;
const SCALE = 10n ** DECIMALS;
const LOCALE = "en-US";
const TIME_ZONE = "UTC";

const groups = (n: bigint) => n.toLocaleString(LOCALE);

/** fUSD units (6 decimals) as text: two decimals, more only when the amount needs them. */
export function formatFusd(units: bigint | string, opts: { unit?: boolean } = {}): string {
  const v = typeof units === "bigint" ? units : BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / SCALE;
  const frac = abs % SCALE;
  let text: string;
  if (frac !== 0n && frac % 10_000n !== 0n && whole === 0n) {
    text = `0.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
  } else {
    const cents = (abs * 100n + SCALE / 2n) / SCALE;
    text = `${groups(cents / 100n)}.${(cents % 100n).toString().padStart(2, "0")}`;
  }
  return `${neg ? "-" : ""}${text}${opts.unit === false ? "" : " fUSD"}`;
}

/** User text to fUSD units; null when it is not a number or has more than 6 decimals. */
export function parseFusd(text: string): bigint | null {
  const t = text.replace(/,/g, "").trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]) * SCALE + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

/** A whole count with thousands separators. */
export const formatCount = (n: number) => n.toLocaleString(LOCALE);

export const formatBps = (bps: number) => `${(bps / 100).toLocaleString(LOCALE, { maximumFractionDigits: 2 })}%`;

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIME_ZONE });

export const formatDate = (d: Date | number) => dateFmt.format(d);
export const formatDateTime = (d: Date | number) => `${dateFmt.format(d)}, ${timeFmt.format(d)} UTC`;

/** A time still ahead of now, given as whole seconds ahead. */
function formatFuture(d: Date | number, ahead: number): string {
  if (ahead < 60) return "in less than a minute";
  const m = Math.floor(ahead / 60);
  if (m < 60) return `in ${m} ${m === 1 ? "minute" : "minutes"}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} ${h === 1 ? "hour" : "hours"}`;
  return formatDate(d);
}

export function formatRelative(d: Date | number, now: Date | number = Date.now()): string {
  const ms = +now - +d;
  if (ms < 0) return formatFuture(d, Math.floor(-ms / 1000));
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  if (h < 48) return "yesterday";
  return formatDate(d);
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

const DURATION_UNITS: [string, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/** A length of time in the largest unit that divides it exactly: "1 hour", "90 minutes". */
export function formatDuration(seconds: number): string {
  const [unit, size] = DURATION_UNITS.find(([, s]) => seconds % s === 0) ?? DURATION_UNITS[3];
  const n = seconds / size;
  return `${n.toLocaleString(LOCALE)} ${unit}${n === 1 ? "" : "s"}`;
}
