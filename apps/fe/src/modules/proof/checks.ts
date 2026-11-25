import type { VaultStateName } from "@/components/shared/StateBadge";

export type CheckId =
  "factory" | "ownerKey" | "spenderRule" | "operatorWindow" | "books" | "widening";
export type CheckResult = { id: CheckId; status: "proven" | "failed" | "unknown"; detail: string };

export const CHECK_IDS: CheckId[] = [
  "factory",
  "ownerKey",
  "spenderRule",
  "operatorWindow",
  "books",
  "widening",
];

export const CHECK_TITLES: Record<CheckId, string> = {
  factory: "The vault was created by the published Qredit factory.",
  ownerKey: "The owner's ML-DSA-87 key is registered and proven.",
  spenderRule: "The agent key may only pay listed suppliers through this vault.",
  operatorWindow: "The operator key can reach only this vault.",
  books: "The vault's books equal its fUSD balance.",
  widening: "The rules cannot be widened while the loan runs.",
};

export const UNKNOWN_DETAIL = "This could not be checked right now.";

const r = (id: CheckId, status: CheckResult["status"], detail: string): CheckResult => ({
  id,
  status,
  detail,
});
const lower = (s: string) => s.toLowerCase();

export const provenCount = (results: CheckResult[]) =>
  results.filter((c) => c.status === "proven").length;

export const judgeFactory = (inFactory: boolean, codeHash: string, expected: string) =>
  !inFactory
    ? r("factory", "failed", "The factory does not list this vault.")
    : lower(codeHash) !== lower(expected)
      ? r("factory", "failed", "The factory on chain does not match the published build.")
      : r("factory", "proven", "The factory lists this vault, and its code matches the published build.");

export function judgeOwnerKey(s: { registered: boolean; possessionProven?: boolean }): CheckResult {
  if (!s.registered) return r("ownerKey", "failed", "The owner has no registered post-quantum key.");
  if (s.possessionProven === undefined)
    return r("ownerKey", "unknown", "The chain did not report whether the key was proven.");
  return s.possessionProven
    ? r("ownerKey", "proven", "The key is registered with a proof of possession.")
    : r("ownerKey", "failed", "The key is registered without a proof of possession.");
}

type RuleView = { id?: string; enabled: boolean; allowedEvmCalls: string[] };
type StoredRules = {
  rules: RuleView[];
  authenticatorRules: { scheme?: string; pubkeyHex?: string; rule: RuleView }[];
};

/** The rules that bind the agent key: every enabled account-wide rule and every enabled per-key rule. */
export const enabledRules = (stored: StoredRules): { allowedEvmCalls: string[] }[] =>
  [...stored.rules, ...stored.authenticatorRules.map((a) => a.rule)]
    .filter((x) => x.enabled)
    .map((x) => ({ allowedEvmCalls: x.allowedEvmCalls }));

export function judgeSpenderRule(
  rules: { allowedEvmCalls: string[] }[],
  vault: string,
  selector: string,
): CheckResult {
  const expected = `${lower(vault)}/${lower(selector)}`;
  const calls = rules.flatMap((x) => x.allowedEvmCalls.map(lower));
  if (rules.length === 0 || calls.length === 0)
    return r("spenderRule", "failed", "No spending rule limits the agent key's calls.");
  return calls.every((c) => c === expected)
    ? r("spenderRule", "proven", "Every rule allows only paySupplier on this vault.")
    : r("spenderRule", "failed", "A rule allows a call other than paySupplier on this vault.");
}

export function judgeOperatorWindow(
  w: { found: boolean; live: boolean; allowedTargets: string[] },
  vault: string,
): CheckResult {
  if (!w.found || !w.live)
    return r("operatorWindow", "unknown", "The operator has no open window right now, so it cannot send anything.");
  const t = w.allowedTargets.map(lower);
  return t.length === 1 && t[0] === lower(vault)
    ? r("operatorWindow", "proven", "The open window lists this vault as its only target.")
    : r("operatorWindow", "failed", "The open window allows other targets.");
}

export function judgeBooks(books: readonly bigint[], balance: bigint): CheckResult {
  const sum = books.reduce((a, b) => a + b, 0n);
  return sum === balance
    ? r("books", "proven", "Escrow, lender pool, owner share, operating funds and held funds add up to the balance.")
    : r("books", "failed", "The books do not add up to the vault's balance.");
}

export const judgeWidening = (state: VaultStateName): CheckResult =>
  state === "Repaid"
    ? r("widening", "proven", "The loan is repaid, so the owner may widen the rules again.")
    : r("widening", "proven", "The loan is not repaid, so the vault refuses every widening order.");
