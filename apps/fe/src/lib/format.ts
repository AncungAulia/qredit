// src/lib/format.ts: every number, amount, quantity and date shown to people goes through here.
// Missing values render as "-" so they are visibly missing, never as 0 or a guess.
export const LOCALE = "en-US"; // from the UI profile
// Fixed time zone so server and browser render the same date (no hydration mismatch).
export const TIME_ZONE = "UTC"; // from the UI profile
const MISSING = "-"; // hyphen: UI rules forbid the em dash

type Maybe<T> = T | null | undefined;

export function formatNumber(value: Maybe<number>, maxFractionDigits = 2): string {
  if (value == null || Number.isNaN(value)) return MISSING;
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxFractionDigits }).format(value);
}

export function formatCurrency(value: Maybe<number>, currency = "USD"): string {
  if (value == null || Number.isNaN(value)) return MISSING;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

/** 0.125 → "12.5%" */
export function formatPercent(ratio: Maybe<number>, maxFractionDigits = 1): string {
  if (ratio == null || Number.isNaN(ratio)) return MISSING;
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    maximumFractionDigits: maxFractionDigits,
  }).format(ratio);
}

// Small units that read better scaled up: 1500 g → 1.5 kg, 100000 ml → 100 L.
const SCALE_UP: Record<string, { factor: number; unit: string }> = {
  g: { factor: 1000, unit: "kg" },
  ml: { factor: 1000, unit: "L" },
  mg: { factor: 1000, unit: "g" },
  cm: { factor: 100, unit: "m" },
  m: { factor: 1000, unit: "km" },
};

/** Quantity with its unit, rescaled when large. An unknown unit is kept as given. */
export function formatQuantity(value: Maybe<number>, unit: Maybe<string>): string {
  if (value == null || Number.isNaN(value)) return MISSING;
  const key = unit?.trim();
  if (!key) return formatNumber(value);
  const scale = SCALE_UP[key.toLowerCase()];
  if (scale && Math.abs(value) >= scale.factor) {
    return `${formatNumber(value / scale.factor)} ${scale.unit}`;
  }
  return `${formatNumber(value)} ${key}`;
}

function toDate(value: Maybe<string | number | Date>): Date | null {
  if (value == null || value === "") return null;
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(
  value: Maybe<string | number | Date>,
  style: "short" | "long" = "short",
): string {
  const date = toDate(value);
  if (!date) return MISSING;
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat(
    LOCALE,
    style === "long"
      ? { dateStyle: "full", timeZone: TIME_ZONE }
      : { dateStyle: "medium", timeZone: TIME_ZONE },
  ).format(date);
}

export function formatDateTime(value: Maybe<string | number | Date>): string {
  const date = toDate(value);
  if (!date) return MISSING;
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(date);
}
