import { describe, expect, test } from "vitest";
import {
  enabledRules,
  judgeBooks,
  judgeFactory,
  judgeOperatorWindow,
  judgeOwnerKey,
  judgeSpenderRule,
  judgeWidening,
  provenCount,
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
  test("spender rule allows only paySupplier on this vault", () => {
    expect(judgeSpenderRule([{ allowedEvmCalls: [`${VAULT}/${SEL}`] }], VAULT, SEL).status).toBe("proven");
    expect(
      judgeSpenderRule([{ allowedEvmCalls: [`${VAULT.toUpperCase().replace("0X", "0x")}/${SEL}`] }], VAULT, SEL).status,
    ).toBe("proven");
    expect(judgeSpenderRule([{ allowedEvmCalls: [`${VAULT}/${SEL}`, `${VAULT}/0x12345678`] }], VAULT, SEL).status).toBe("failed");
    expect(judgeSpenderRule([{ allowedEvmCalls: [] }], VAULT, SEL).status).toBe("failed");
    expect(judgeSpenderRule([], VAULT, SEL).status).toBe("failed");
  });
  test("the real SDK shape: account-wide and per-key rules, disabled rules ignored", () => {
    const view = (enabled: boolean, calls: string[]) => ({ id: "x", enabled, allowedEvmCalls: calls });
    const rules = enabledRules({
      rules: [view(false, ["0xother/0x1"])],
      authenticatorRules: [{ scheme: "ed25519", pubkeyHex: "ab", rule: view(true, [`${VAULT}/${SEL}`]) }],
    });
    expect(rules).toEqual([{ allowedEvmCalls: [`${VAULT}/${SEL}`] }]);
    expect(judgeSpenderRule(rules, VAULT, SEL).status).toBe("proven");
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
  test("widening", () => {
    expect(judgeWidening("Active").status).toBe("proven");
    expect(judgeWidening("Trapped").status).toBe("proven");
    expect(judgeWidening("Repaid")).toMatchObject({
      status: "proven",
      detail: "The loan is repaid, so the owner may widen the rules again.",
    });
  });
  test("provenCount counts only proven checks", () => {
    const r = (status: "proven" | "failed" | "unknown") => ({ id: "books" as const, status, detail: "" });
    expect(provenCount([r("proven"), r("failed"), r("unknown"), r("proven")])).toBe(2);
  });
});
