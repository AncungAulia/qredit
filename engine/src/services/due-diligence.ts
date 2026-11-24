import type { IndexerData } from "../suppliers/data/indexer.ts";
import { bytecodeFacts, bytecodeFindings, type BytecodeF } from "./bytecode.ts";
import { parseOneAddress } from "./input.ts";
import { firstMatch, type Rule, type ServiceDef, type SupplierData } from "./types.ts";

type DdF = BytecodeF & { listed: boolean; listEntry: string | null; list: string | null };

/** Flag-list facts from the indexer; absent data means not listed. */
function flagFacts(data: SupplierData): Pick<DdF, "listed" | "listEntry" | "list"> {
  const d = data.dataIndexer as IndexerData | undefined;
  return { listed: d?.flagged.listed ?? false, listEntry: d?.flagged.entry ?? null, list: d?.flagged.list ?? null };
}

const RULES: Rule[] = [
  { when: (f) => (f as DdF).listed, label: "high", rule: "address is on the flag list" },
  { when: (f) => !(f as BytecodeF).isContract, label: "high", rule: "no contract code at this address" },
  { when: (f) => (f as BytecodeF).ecrecoverHint && !(f as BytecodeF).usesPqcPrecompile, label: "high", rule: "ecrecover hint and no PQC precompile use" },
  { when: (f) => (f as BytecodeF).ownerPresent && !(f as BytecodeF).usesPqcPrecompile, label: "medium", rule: "owner present and no PQC precompile use" },
  { when: (f) => !(f as BytecodeF).usesPqcPrecompile, label: "medium", rule: "no PQC precompile use" },
  { when: () => true, label: "low", rule: "otherwise" },
];

export const dueDiligence: ServiceDef = {
  slug: "due-diligence",
  parseInput: parseOneAddress,
  suppliers: { required: ["dataIndexer"], choice: ["computeBasic", "computeDeep"] },
  facts: (_query, data): DdF => ({ ...bytecodeFacts(data), ...flagFacts(data) }),
  verdict: (f) => firstMatch(RULES, f),
  findings(facts) {
    const f = facts as DdF;
    const out = bytecodeFindings(f);
    if (f.listed) out.push(`Address is on the flag list ${f.list}: ${f.listEntry ?? "no entry text"}.`);
    if (f.token) {
      const t = f.token;
      out.push(`Token name ${t.name ?? "unknown"}, symbol ${t.symbol ?? "unknown"}, decimals ${t.decimals ?? "unknown"}, total supply ${t.totalSupply ?? "unknown"}.`);
    }
    if (f.ownerPresent) out.push(`Contract has an owner: ${f.owner}.`);
    return out;
  },
};
