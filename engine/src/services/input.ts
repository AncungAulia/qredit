import { normalizeAddress } from "../suppliers/data/lists.ts";
import type { ParsedInput } from "./types.ts";

export const MAX_ADDRESSES = 20;

const short = (hex: string) => `${hex.slice(0, 8)}...${hex.slice(-4)}`;
const tokens = (input: string) => input.split(/[\s,]+/).filter(Boolean);
const bad = (token: string): ParsedInput => ({ ok: false, reason: `"${token.slice(0, 60)}" is not a valid qor1 or 0x address.` });

/** Exactly one address (`qor1...` or `0x...`); the supplier query uses the hex form. */
export function parseOneAddress(input: string): ParsedInput {
  const t = tokens(input);
  if (t.length === 0) return { ok: false, reason: "No address given." };
  if (t.length > 1) return { ok: false, reason: "Exactly one address is expected." };
  const a = normalizeAddress(t[0]!);
  if (!a) return bad(t[0]!);
  return { ok: true, query: { address: a.hex }, subject: short(a.hex) };
}

/** One address or up to 20, separated by commas, whitespace or new lines; duplicates removed. */
export function parseManyAddresses(input: string): ParsedInput {
  const t = tokens(input);
  if (t.length === 0) return { ok: false, reason: "No address given." };
  const hexes: string[] = [];
  for (const token of t) {
    const a = normalizeAddress(token);
    if (!a) return bad(token);
    if (!hexes.includes(a.hex)) hexes.push(a.hex);
  }
  if (hexes.length > MAX_ADDRESSES) return { ok: false, reason: `At most ${MAX_ADDRESSES} addresses per request, got ${hexes.length}.` };
  return { ok: true, query: { addresses: hexes.join(",") }, subject: hexes.length === 1 ? short(hexes[0]!) : `${hexes.length} addresses` };
}
