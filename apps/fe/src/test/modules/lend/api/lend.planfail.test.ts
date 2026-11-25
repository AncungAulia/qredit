import { expect, test, vi } from "vitest";

vi.mock("@/lib/chain", () => ({
  readVault: async (_v: string, fn: string) => (fn === "state" ? 0 : fn === "raised" ? 0n : [1000n, 0n, 0n, 0n, 0n, 0n]),
  publicClient: { readContract: async () => 1000n },
}));
vi.mock("@/modules/market/api/market.api", () => ({ readVaultSnapshot: vi.fn() }));
vi.mock("@/modules/wallet/signer", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/signer")>()),
  evmSignerFor: () => ({ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", send: vi.fn() }),
  ensureWindowFor: vi.fn(),
}));
vi.mock("@qredit/qore/lend", async (orig) => ({
  ...(await orig<typeof import("@qredit/qore/lend")>()),
  planLend: () => {
    throw new Error("something the planner never said before");
  },
}));

import { lend } from "@/modules/lend/api/lend.api";
import type { TestSession } from "@/modules/wallet/session";
import { TxFailed } from "@/modules/wallet/signer";

test("an unexpected planner failure is a typed failure with a formal sentence, never matched by its text", async () => {
  const error = await lend({ kind: "test" } as unknown as TestSession, "0x1111111111111111111111111111111111111111", 10n).catch((e) => e);
  expect(error).toBeInstanceOf(TxFailed);
  expect(error.reason).toBe("The loan could not be prepared. Please try again.");
});
