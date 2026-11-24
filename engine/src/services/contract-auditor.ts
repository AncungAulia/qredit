import { bytecodeFacts, bytecodeFindings, type BytecodeF } from "./bytecode.ts";
import { parseOneAddress } from "./input.ts";
import { firstMatch, type Rule, type ServiceDef } from "./types.ts";

const RULES: Rule[] = [
  { when: (f) => !(f as BytecodeF).isContract, label: "not a contract", rule: "no contract code at this address" },
  { when: (f) => (f as BytecodeF).usesPqcPrecompile && !(f as BytecodeF).ecrecoverHint, label: "pq-ready", rule: "PQC precompile used and no ecrecover hint" },
  { when: (f) => (f as BytecodeF).usesPqcPrecompile, label: "partial", rule: "PQC precompile used and ecrecover hint" },
  { when: () => true, label: "not ready", rule: "otherwise" },
];

export const contractAuditor: ServiceDef = {
  slug: "contract-auditor",
  parseInput: parseOneAddress,
  suppliers: { required: [], choice: ["computeBasic", "computeDeep"] },
  facts: (_query, data) => bytecodeFacts(data),
  verdict: (f) => firstMatch(RULES, f),
  findings: (f) => bytecodeFindings(f as BytecodeF),
};
