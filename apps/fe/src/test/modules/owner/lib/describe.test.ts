import { expect, test } from "vitest";
import { applyBody, appliedTitle, orderSentence } from "@/modules/owner/lib/describe";

const order = (kind: number, target: `0x${string}` = "0x0000000000000000000000000000000000000000", value = 0n) => ({
  kind,
  target,
  value,
  nonce: 0n,
  expiry: 0n,
});

test("Close says it cannot be undone before it is applied", () => {
  expect(orderSentence(order(8))).toBe("Close the loan and move the operating funds, the owner share and the bond to lenders");
  expect(applyBody(order(8))).toContain("This cannot be undone");
  expect(appliedTitle(order(8))).toBe("The loan is closed");
});

test("RotateAgent names both new keys", () => {
  const o = order(9, "0x00000000000000000000000000000000000000c1", BigInt("0x00000000000000000000000000000000000000c2"));
  expect(orderSentence(o)).toBe("Replace the agent keys with spending key 0x0000…00c1 and operator key 0x0000…00c2");
  expect(applyBody(o)).not.toContain("cannot be undone");
  expect(appliedTitle(o)).toBe("The agent keys are replaced");
});
