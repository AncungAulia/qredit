import type { Verdict } from "../services/types.ts";

export type Prose = { summary: string; findings: string[] };
export type Grounding = { ok: true } | { ok: false; reason: string };

const ADDRESS = /0x[0-9a-fA-F]{40}|qor1[0-9a-z]{38,58}/g;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;
const GRADE = /\b(?:grade|rated)\s+([A-F])\b/gi;

const TERM = /\b[A-Za-z]\w*-\d+\b/g; // e.g. ERC-20

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `needle` as a whole token (not part of a longer word, number or hyphenated term). */
const wholeToken = (needle: string, flags = ""): RegExp => new RegExp(`(?<![\\w.-])${escapeRegExp(needle)}(?![\\w-]|\\.\\d)`, flags);

/** Every address, number and verdict label in the prose must come from the facts, the verdict or the code findings. */
export function checkGrounding(prose: Prose, facts: Record<string, unknown>, verdict: Verdict, labels?: readonly string[], codeFindings: readonly string[] = []): Grounding {
  const text = [prose.summary, ...prose.findings].join("\n");
  const factsText = JSON.stringify(facts).toLowerCase();
  const findingsText = codeFindings.join(" ").toLowerCase();
  const known = `${factsText} ${verdict.label} ${verdict.rule} ${findingsText}`.toLowerCase();

  for (const a of text.match(ADDRESS) ?? []) {
    if (!factsText.includes(a.toLowerCase())) return { ok: false, reason: `address not in facts: ${a}` };
  }
  // Standard names such as "ERC-20" are grounded when the code findings use the same term.
  const noAddresses = text.replace(ADDRESS, " ").replace(TERM, (t) => (findingsText.includes(t.toLowerCase()) ? " " : t));
  for (const n of noAddresses.match(NUMBER) ?? []) {
    if (!wholeToken(n).test(known)) return { ok: false, reason: `number not in facts: ${n}` };
  }
  for (const m of noAddresses.matchAll(GRADE)) {
    if (m[1]!.toUpperCase() !== verdict.label.toUpperCase()) return { ok: false, reason: `different grade: ${m[1]}` };
  }
  for (const other of (labels ?? []).filter((l) => l.toLowerCase() !== verdict.label.toLowerCase())) {
    if (wholeToken(other, "i").test(noAddresses)) return { ok: false, reason: `different verdict: ${other}` };
  }
  return { ok: true };
}

/** The fallback when the model is unavailable or fails grounding: only code output. */
export function factsOnlyProse(verdict: Verdict, codeFindings: string[]): Prose {
  return { summary: `Verdict: ${verdict.label} (${verdict.rule}).`, findings: codeFindings };
}
