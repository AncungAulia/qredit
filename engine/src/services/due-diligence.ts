import { bytecodeFacts, bytecodeFindings, type BytecodeF } from "./bytecode.ts";
import { parseOneAddress } from "./input.ts";
import { firstMatch, type Rule, type ServiceDef } from "./types.ts";

const RULES: Rule[] = [
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
  facts: (_query, data) => bytecodeFacts(data),
  verdict: (f) => firstMatch(RULES, f),
  findings(facts) {
    const f = facts as BytecodeF;
    const out = bytecodeFindings(f);
    if (f.token) {
      const t = f.token;
      out.push(`Token name ${t.name ?? "unknown"}, symbol ${t.symbol ?? "unknown"}, decimals ${t.decimals ?? "unknown"}, total supply ${t.totalSupply ?? "unknown"}.`);
    }
    if (f.ownerPresent) out.push(`Contract has an owner: ${f.owner}.`);
    return out;
  },
};
