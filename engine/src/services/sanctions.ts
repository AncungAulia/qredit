import type { ListData } from "../suppliers/data/lists.ts";
import { parseManyAddresses } from "./input.ts";
import { firstMatch, labelsOf, type Rule, type ServiceDef } from "./types.ts";

type F = { list: string; checked: string[]; checkedCount: number; matches: { address: string; entry: string }[]; matchCount: number };

const RULES: Rule[] = [
  { when: (f) => (f as F).matchCount > 0, label: "match", rule: "listed on the sanctions list" },
  { when: () => true, label: "no match", rule: "no address is on the sanctions list" },
];

export const sanctions: ServiceDef = {
  slug: "sanctions-screen",
  labels: labelsOf(RULES),
  parseInput: parseManyAddresses,
  suppliers: { required: ["listOracle"], choice: [] },
  facts(_query, data) {
    const d = data.listOracle as ListData;
    const f: F = { list: d.list, checked: d.checked, checkedCount: d.checked.length, matches: d.matches, matchCount: d.matches.length };
    return f;
  },
  verdict(facts) {
    const v = firstMatch(RULES, facts);
    const f = facts as F;
    return f.matchCount > 0 ? { label: v.label, rule: `listed on ${f.list}` } : v;
  },
  findings(facts) {
    const f = facts as F;
    const out = [`Checked ${f.checkedCount} address${f.checkedCount === 1 ? "" : "es"} against ${f.list}.`];
    for (const m of f.matches) out.push(`${m.address} is listed: ${m.entry}.`);
    if (f.matchCount === 0) out.push("No address matched.");
    return out;
  },
  notice: "The sanctions list is synthetic demo data, not a real screening list.",
};
