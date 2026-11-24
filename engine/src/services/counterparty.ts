import type { IndexerData } from "../suppliers/data/indexer.ts";
import { parseOneAddress } from "./input.ts";
import { firstMatch, type Rule, type ServiceDef } from "./types.ts";

type F = {
  address: { bech32: string; hex: string };
  listed: boolean; listEntry: string | null; list: string;
  mldsaRegistered: boolean; possessionProven: boolean; keyType: string | null;
  windowLive: boolean; windowOpenToAny: boolean;
};

const RULES: Rule[] = [
  { when: (f) => (f as F).listed, label: "F", rule: "address is on the flag list" },
  { when: (f) => !(f as F).mldsaRegistered && (f as F).windowOpenToAny, label: "D", rule: "no ML-DSA key registered and a live EVM window open to any target" },
  { when: (f) => !(f as F).mldsaRegistered, label: "C", rule: "no ML-DSA key registered" },
  { when: (f) => !(f as F).possessionProven, label: "B", rule: "ML-DSA key registered but possession not proven" },
  { when: () => true, label: "A", rule: "otherwise" },
];

export const counterparty: ServiceDef = {
  slug: "counterparty-check",
  parseInput: parseOneAddress,
  suppliers: { required: ["dataIndexer"], choice: [] },
  facts(_query, data) {
    const d = data.dataIndexer as IndexerData;
    const f: F = {
      address: d.address,
      listed: d.flagged.listed, listEntry: d.flagged.entry, list: d.flagged.list,
      mldsaRegistered: d.pq.registered, possessionProven: d.pq.possessionProven, keyType: d.pq.keyType,
      windowLive: d.pq.window.live, windowOpenToAny: d.pq.window.live && d.pq.window.allowedTargets.length === 0,
    };
    return f;
  },
  verdict: (f) => firstMatch(RULES, f),
  findings(facts) {
    const f = facts as F;
    const out = [
      f.listed ? `Address is on the flag list ${f.list}: ${f.listEntry ?? "no entry text"}.` : `Address is not on the flag list ${f.list}.`,
      `ML-DSA-87 key registered: ${f.mldsaRegistered ? "yes" : "no"}.`,
    ];
    if (f.mldsaRegistered) out.push(`Key possession proven: ${f.possessionProven ? "yes" : "no"}.`);
    if (!f.windowLive) out.push("No live EVM window.");
    else out.push(f.windowOpenToAny ? "Live EVM window open to any target." : "Live EVM window open to a limited set of targets.");
    return out;
  },
  notice: "The flag list is synthetic demo data, not a real screening list.",
};
