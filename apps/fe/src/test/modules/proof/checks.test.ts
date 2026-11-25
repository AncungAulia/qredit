import { describe, expect, test } from "vitest";
import {
  applicableCount,
  judgeBooks,
  judgeFactory,
  judgeOperatorWindow,
  judgeOwnerKey,
  judgeSpenderRule,
  judgeWidening,
  provenCount,
  resultsOf,
} from "@/modules/proof/checks";

const VAULT = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4";
const SEL = "0xdeadbeef";

describe("checks", () => {
  test("factory", () => {
    expect(judgeFactory(true, "0xaa", "0xaa").status).toBe("proven");
    expect(judgeFactory(false, "0xaa", "0xaa").status).toBe("failed");
    expect(judgeFactory(true, "0xbb", "0xaa").status).toBe("failed");
  });
  test("owner key must be registered and proven", () => {
    expect(judgeOwnerKey({ registered: true, possessionProven: true }).status).toBe("proven");
    expect(judgeOwnerKey({ registered: true, possessionProven: false }).status).toBe("failed");
    expect(judgeOwnerKey({ registered: true }).status).toBe("unknown");
    expect(judgeOwnerKey({ registered: false }).status).toBe("failed");
  });

  describe("spender rule", () => {
    const NOW = 1_800_000_000;
    const key = (
      pubkeyHex: string,
      extra: Partial<{ revoked: boolean; expiryUnix: bigint }> = {},
    ) => ({ pubkeyHex, revoked: false, expiryUnix: BigInt(NOW + 1000), ...extra });
    const rule = (calls: string[], enabled = true) => ({ enabled, allowedEvmCalls: calls });
    const ok = `${VAULT}/${SEL}`;
    const judge = (s: Parameters<typeof judgeSpenderRule>[0]) =>
      judgeSpenderRule(s, VAULT, SEL, NOW);

    test("an account-wide rule that allows only paySupplier proves it, in any letter case", () => {
      expect(judge({ keys: [key("aa")], rules: [rule([ok])], authenticatorRules: [] }).status).toBe(
        "proven",
      );
      const upper = `${VAULT.toUpperCase().replace("0X", "0x")}/${SEL.toUpperCase().replace("0X", "0x")}`;
      expect(
        judge({ keys: [key("aa")], rules: [rule([upper])], authenticatorRules: [] }).status,
      ).toBe("proven");
    });
    test("an empty call list fails, because it limits no call to paySupplier", () => {
      const res = judge({ keys: [key("aa")], rules: [rule([])], authenticatorRules: [] });
      expect(res.status).toBe("failed");
      expect(res.detail).toMatch(/lists no allowed call/);
    });
    test("an extra allowed call fails", () => {
      expect(
        judge({
          keys: [key("aa")],
          rules: [rule([ok, `${VAULT}/0x12345678`])],
          authenticatorRules: [],
        }).status,
      ).toBe("failed");
    });
    test("a disabled rule is skipped for the next enabled one", () => {
      expect(
        judge({
          keys: [key("aa")],
          rules: [rule(["0xother"], false), rule([ok])],
          authenticatorRules: [],
        }).status,
      ).toBe("proven");
      expect(
        judge({ keys: [key("aa")], rules: [rule([ok], false)], authenticatorRules: [] }).status,
      ).toBe("failed");
    });
    test("a per-key rule overrides the account-wide rule", () => {
      expect(
        judge({
          keys: [key("aa")],
          rules: [rule([VAULT])],
          authenticatorRules: [{ pubkeyHex: "AA", rule: rule([ok]) }],
        }).status,
      ).toBe("proven");
      expect(
        judge({
          keys: [key("aa")],
          rules: [rule([ok])],
          authenticatorRules: [{ pubkeyHex: "aa", rule: rule([VAULT]) }],
        }).status,
      ).toBe("failed");
    });
    test("a stray rule for a key that is not linked is ignored", () => {
      expect(
        judge({
          keys: [key("aa")],
          rules: [rule([ok])],
          authenticatorRules: [{ pubkeyHex: "probe", rule: rule(["0xany/0x1"]) }],
        }).status,
      ).toBe("proven");
    });
    test("no linked key fails; revoked and expired keys do not count", () => {
      expect(judge({ keys: [], rules: [rule([ok])], authenticatorRules: [] })).toMatchObject({
        status: "failed",
        detail: "No agent key is linked to the spender account.",
      });
      expect(
        judge({ keys: [key("aa", { revoked: true })], rules: [rule([ok])], authenticatorRules: [] })
          .status,
      ).toBe("failed");
      expect(
        judge({
          keys: [key("aa", { expiryUnix: BigInt(NOW - 1) })],
          rules: [rule([ok])],
          authenticatorRules: [],
        }).status,
      ).toBe("failed");
    });
    test("key ids match with or without a 0x prefix and in any case", () => {
      expect(
        judge({
          keys: [key("0xAB")],
          rules: [rule([VAULT])],
          authenticatorRules: [{ pubkeyHex: "ab", rule: rule([ok]) }],
        }).status,
      ).toBe("proven");
    });
    test("a key that says it has its own rule but none is returned fails", () => {
      const res = judge({
        keys: [{ ...key("aa"), hasSpendRule: true }],
        rules: [rule([ok])],
        authenticatorRules: [],
      });
      expect(res.status).toBe("failed");
      expect(res.detail).toMatch(/rule of its own/);
    });
    test("a linked key bound by no enabled rule fails", () => {
      expect(judge({ keys: [key("aa")], rules: [], authenticatorRules: [] }).status).toBe("failed");
    });
    test("every linked key must be bound correctly", () => {
      expect(
        judge({
          keys: [key("aa"), key("bb")],
          rules: [rule([ok])],
          authenticatorRules: [{ pubkeyHex: "bb", rule: rule([]) }],
        }).status,
      ).toBe("failed");
    });
  });

  test("operator window reaches only the vault", () => {
    expect(judgeOperatorWindow({ found: true, live: true, allowedTargets: [VAULT] }, VAULT).status).toBe("proven");
    expect(judgeOperatorWindow({ found: true, live: true, allowedTargets: [] }, VAULT).status).toBe("failed");
    expect(judgeOperatorWindow({ found: true, live: true, allowedTargets: [VAULT, "0x1"] }, VAULT).status).toBe("failed");
    expect(judgeOperatorWindow({ found: false, live: false, allowedTargets: [] }, VAULT)).toMatchObject({ status: "unknown" });
  });
  test("books equal the fUSD balance", () => {
    expect(judgeBooks([1n, 2n, 3n, 4n, 5n], 15n).status).toBe("proven");
    expect(judgeBooks([1n, 2n, 3n, 4n, 5n], 16n).status).toBe("failed");
  });
  const factoryOf = (status: "proven" | "failed" | "unknown") => ({ id: "factory" as const, status, detail: "" });
  test("widening: proven while a loan runs, not applicable once repaid", () => {
    expect(judgeWidening("Active", factoryOf("proven")).status).toBe("proven");
    expect(judgeWidening("Trapped", factoryOf("proven")).status).toBe("proven");
    expect(judgeWidening("Repaid", factoryOf("proven"))).toMatchObject({
      status: "na",
      detail: "The loan is repaid, so the owner may widen the rules again.",
    });
  });
  test("widening: unknown unless the factory check proved the code", () => {
    for (const status of ["failed", "unknown"] as const)
      expect(judgeWidening("Active", factoryOf(status))).toMatchObject({
        status: "unknown",
        detail: "The vault's code is not proven, so its widening rule is not proven either.",
      });
    expect(judgeWidening("Repaid", factoryOf("failed")).status).toBe("na");
  });
  test("counts: not applicable is neither proven nor part of the total", () => {
    const r = (status: "proven" | "failed" | "unknown" | "na") => ({ id: "books" as const, status, detail: "" });
    const all = [r("proven"), r("failed"), r("unknown"), r("proven"), r("na")];
    expect(provenCount(all)).toBe(2);
    expect(applicableCount(all)).toBe(4);
  });
  test("resultsOf: data as is, a failed query as six unknown checks, a pending query as nothing", () => {
    const data = [{ id: "books" as const, status: "proven" as const, detail: "" }];
    expect(resultsOf({ data, isError: false })).toBe(data);
    expect(resultsOf({ isError: false })).toBeUndefined();
    const failed = resultsOf({ isError: true });
    expect(failed).toHaveLength(6);
    expect(failed?.every((c) => c.status === "unknown")).toBe(true);
  });
});
