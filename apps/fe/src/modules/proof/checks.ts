import type { VaultStateName } from "@/components/shared/StateBadge";

export type CheckId =
  "factory" | "ownerKey" | "spenderRule" | "operatorWindow" | "books" | "widening";
export type CheckResult = { id: CheckId; status: "proven" | "failed" | "unknown" | "na"; detail: string };

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
  spenderRule: "The agent key may call only paySupplier on this vault.",
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
const keyId = (hex: string) => lower(hex.replace(/^0x/i, ""));

export const provenCount = (results: CheckResult[]) =>
  results.filter((c) => c.status === "proven").length;

/** The checks that apply now. A check that is not applicable is neither proven nor failed, so it is left out of "N of M". */
export const applicableCount = (results: CheckResult[]) =>
  results.filter((c) => c.status !== "na").length;

type Query = { data?: CheckResult[]; isError: boolean };

/** The checks to show for one query. A query that failed outright shows every check as not proven; none is ever read as a pass. */
export function resultsOf(q: Query): CheckResult[] | undefined {
  if (q.data) return q.data;
  return q.isError
    ? CHECK_IDS.map((id) => ({ id, status: "unknown" as const, detail: UNKNOWN_DETAIL }))
    : undefined;
}

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

type RuleView = { enabled: boolean; allowedEvmCalls: string[] };
type LinkedKey = { pubkeyHex: string; revoked: boolean; expiryUnix: bigint; hasSpendRule?: boolean };
export type SpenderInput = {
  /** Every key linked to the spender account, revoked ones included (as the chain returns them). */
  keys: LinkedKey[];
  /** Account-wide rules in stored order. */
  rules: RuleView[];
  /** Per-key rules. */
  authenticatorRules: { pubkeyHex: string; rule: RuleView }[];
};

/**
 * The agent key may call only paySupplier on this vault. Chain rule (SDK docs): a linked key is bound by its
 * own per-key rule, else by the first enabled account-wide rule; an empty allowed_evm_calls lets a bound key
 * send no call data at all. Only keys that are still linked (not revoked, not expired) are judged, and a rule
 * that binds no linked key is ignored.
 */
export function judgeSpenderRule(
  s: SpenderInput,
  vault: string,
  selector: string,
  nowUnix = Math.floor(Date.now() / 1000),
): CheckResult {
  // Assumption: the SDK types do not say what expiryUnix 0 means; it is treated as "no expiry".
  const linked = s.keys.filter((k) => !k.revoked && (k.expiryUnix === 0n || k.expiryUnix > BigInt(nowUnix)));
  if (linked.length === 0) return r("spenderRule", "failed", "No agent key is linked to the spender account.");
  const expected = `${lower(vault)}/${lower(selector)}`;
  const accountWide = s.rules.find((x) => x.enabled);
  for (const key of linked) {
    const ownRule = s.authenticatorRules.find((a) => keyId(a.pubkeyHex) === keyId(key.pubkeyHex));
    if (key.hasSpendRule === true && !ownRule)
      return r("spenderRule", "failed", "A linked agent key has a rule of its own that the chain did not return.");
    const own = ownRule?.rule.enabled ? ownRule : undefined;
    const binding = own?.rule ?? accountWide;
    if (!binding) return r("spenderRule", "failed", "A linked agent key is bound by no enabled spending rule.");
    const calls = binding.allowedEvmCalls.map(lower);
    if (calls.length === 0)
      return r("spenderRule", "failed", "The rule of a linked agent key lists no allowed call, so it limits no call to paySupplier.");
    if (!calls.every((c) => c === expected))
      return r("spenderRule", "failed", "The rule of a linked agent key allows a call other than paySupplier on this vault.");
  }
  return r("spenderRule", "proven", "Every linked agent key may call only paySupplier on this vault.");
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

/**
 * The vault state alone proves nothing: the refusal is code in the vault, so it holds only when the factory check
 * proved that the vault runs the published build.
 */
export function judgeWidening(state: VaultStateName, factory: CheckResult): CheckResult {
  if (state === "Repaid") return r("widening", "na", "The loan is repaid, so the owner may widen the rules again.");
  if (factory.status !== "proven")
    return r("widening", "unknown", "The vault's code is not proven, so its widening rule is not proven either.");
  return r("widening", "proven", "The loan is not repaid, so the vault refuses every widening order.");
}
