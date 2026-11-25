import { readFileSync } from "node:fs";
import { hexToQor, qorToHex } from "@qredit/qore";

export type ListFile = { list: string; entries: { address: string; entry: string }[] };
export type ListData = { list: string; checked: string[]; matches: { address: string; entry: string }[] };

export function normalizeAddress(s: string): { bech32: string; hex: string } | null {
  const t = s.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return { hex: t.toLowerCase(), bech32: hexToQor(t.toLowerCase()) };
  const hex = /^qor1/.test(t) ? qorToHex(t) : null;
  return hex ? { hex, bech32: t } : null;
}

export function matchList(file: ListFile, addresses: string[]): ListData {
  const index = new Map(file.entries.map((e) => [e.address.toLowerCase(), e.entry]));
  const checked = addresses.map((a) => normalizeAddress(a)?.hex ?? a.toLowerCase());
  return { list: file.list, checked, matches: checked.filter((a) => index.has(a)).map((a) => ({ address: a, entry: index.get(a)! })) };
}

/** Loads a synthetic list from `engine/fixtures`. */
export function loadList(name: "flagged-synthetic" | "sanctions-synthetic"): ListFile {
  return JSON.parse(readFileSync(new URL(`../../../fixtures/${name}.json`, import.meta.url), "utf8")) as ListFile;
}
