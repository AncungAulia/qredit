import { expect, test } from "bun:test";
import { FACTORY_RUNTIME_CODEHASH, LOAN_VAULT_ABI, VAULT_FACTORY_ABI } from "../src/index.ts";

const names = (abi: readonly { type: string; name?: string }[], type: string) =>
  abi.filter((x) => x.type === type).map((x) => x.name);

test("vault ABI has the reads the web app needs", () => {
  const fns = names(LOAN_VAULT_ABI, "function");
  for (const f of ["state", "loan", "raised", "repaid", "books", "orders", "orderCount", "lenderClaimable", "deposits", "dailyCap", "spentToday", "suppliers", "paused", "lenderBps", "ownerBps", "orderTtl", "ownerPq", "spender", "operator", "servicePrice", "expectedRepaid"]) {
    expect(fns).toContain(f);
  }
});

test("factory ABI lists vaults", () => {
  expect(names(VAULT_FACTORY_ABI, "function")).toEqual(expect.arrayContaining(["all", "count", "vaultAt", "create"]));
  expect(FACTORY_RUNTIME_CODEHASH).toMatch(/^0x[0-9a-f]{64}$/);
});
