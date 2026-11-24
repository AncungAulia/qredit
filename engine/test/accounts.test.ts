import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidRecoveryCode } from "@qorechain/sdk";
import { keystore } from "../src/keystore.ts";
import { accountNames, agentKey, ensureAccounts } from "../src/setup/accounts.ts";
import { loadBusinesses } from "../src/setup/businesses.ts";

describe("accounts", () => {
  test("names cover shared roles and three per business", () => {
    const names = accountNames(loadBusinesses());
    expect(names.slice(0, 6)).toEqual(["relayer", "treasury", "supplier-data-indexer", "supplier-list-oracle", "supplier-compute-basic", "supplier-compute-deep"]);
    expect(names).toContain("due-diligence-operator");
    expect(names.length).toBe(6 + 4 * 3);
  });

  test("ensureAccounts creates each kind once and is idempotent", () => {
    const ks = keystore(mkdtempSync(join(tmpdir(), "qredit-acc-")));
    const names = ["relayer", "x-spender", "x-operator", "x-agent"];
    expect(ensureAccounts(ks, names)).toEqual({ created: names, existing: [] });
    expect(ensureAccounts(ks, names)).toEqual({ created: [], existing: names });
    expect(ks.read("relayer").mnemonic.split(" ").length).toBe(24);
    const op = ks.read("x-operator");
    expect(op.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(isValidRecoveryCode(op.recoveryCode)).toBe(true);
    expect(agentKey(ks, "x").publicKey.length).toBe(32);
  });
});
