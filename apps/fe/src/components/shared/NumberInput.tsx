"use client";

import type { ComponentProps } from "react";
import { controlClass } from "@/components/shared/formStyles";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Raw text of a number as typed: digits and at most one dot, no grouping, no leading zeros, at most `decimals`
 * digits after the dot. Kept as text so an amount never passes through a floating point number.
 */
export function sanitizeNumber(text: string, decimals: number): string {
  const cleaned = text.replace(/,/g, "").replace(decimals > 0 ? /[^\d.]/g : /\D/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  const fraction = rest.join("").slice(0, decimals);
  const hasDot = decimals > 0 && rest.length > 0;
  if (!whole && !hasDot) return "";
  const integer = whole.replace(/^0+(?=\d)/, "") || "0";
  return hasDot ? `${integer}.${fraction}` : integer;
}

/** Thousands separators on the whole part; the fraction stays as typed. */
function group(raw: string): string {
  const [whole, fraction] = raw.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

type Props = Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange" | "type"> & {
  /** The raw text, for example "1250.5"; an empty string when nothing is entered. */
  value: string;
  onValueChange: (raw: string) => void;
  /** Shown inside the field after the value, for example "fUSD". */
  suffix?: string;
  /** Digits allowed after the decimal point; 0 means whole numbers only. */
  decimals?: number;
};

/** The one input for amounts: groups thousands while typing, reports the raw text, keeps the unit inside the field. */
export function NumberInput({ value, onValueChange, suffix, decimals = 0, className, ...input }: Props) {
  return (
    <div className="relative">
      <Input
        {...input}
        type="text"
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        value={group(value)}
        onChange={(event) => onValueChange(sanitizeNumber(event.target.value, decimals))}
        className={cn(controlClass, suffix && "pr-16 tabular-nums", className)}
      />
      {suffix && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-text-tertiary">
          {suffix}
        </span>
      )}
    </div>
  );
}
