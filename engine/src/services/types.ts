import type { SupplierRole } from "../setup/businesses.ts";

export type Tier = "basic" | "deep";
/** `choice`: pick exactly one, or `[]` for none. */
export type SupplierPlan = { required: SupplierRole[]; choice: SupplierRole[] };
export type ParsedInput = { ok: true; query: Record<string, string>; subject: string } | { ok: false; reason: string };
export type Verdict = { label: string; rule: string };
export type SupplierData = Partial<Record<SupplierRole, unknown>>;
export type Facts = Record<string, unknown>;

export interface ServiceModule {
  slug: string;
  /** SKILL.md text, loaded at start. */
  skill: string;
  parseInput(input: string): ParsedInput;
  suppliers: SupplierPlan;
  /** Facts from supplier data; deterministic, plain JSON, only values from the data and the parsed input. */
  facts(query: Record<string, string>, data: SupplierData): Facts;
  verdict(facts: Facts): Verdict;
  /** Findings written by code (always shown, before any LLM prose). */
  findings(facts: Facts): string[];
  notice?: string;
}

/** A module as written in source: the skill text is attached by `index.ts`. */
export type ServiceDef = Omit<ServiceModule, "skill">;

export type Rule = { when(f: Facts): boolean; label: string; rule: string };

/** First matching rule wins; every table ends with a catch-all. */
export function firstMatch(rules: Rule[], f: Facts): Verdict {
  const r = rules.find((x) => x.when(f)) ?? rules[rules.length - 1]!;
  return { label: r.label, rule: r.rule };
}
