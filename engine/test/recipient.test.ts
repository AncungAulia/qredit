import { describe, expect, test } from "bun:test";
import { createRecipientResolver } from "../src/agent/recipient.ts";

describe("createRecipientResolver", () => {
  test("a stored card in JSON text is parsed, and a network error is rethrown (retriable), not turned into null", async () => {
    const r = createRecipientResolver({ rest: "http://127.0.0.1:1", chainId: "c", card: async () => JSON.stringify({ version: 1 }) });
    await expect(r("0x" + "11".repeat(20))).rejects.toThrow(/request to .* failed/);
  });
});
