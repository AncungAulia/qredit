import { expect, test } from "vitest";
import { lendSchema } from "@/modules/lend/schemas/lend.schema";

const fusd = (n: number) => BigInt(n) * 1_000_000n;
const check = (amount: string, limits: { balance: bigint | null; room: bigint }) =>
  lendSchema(limits).safeParse({ amount });
const message = (amount: string, limits: { balance: bigint | null; room: bigint }) => {
  const r = check(amount, limits);
  return r.success ? null : r.error.issues[0].message;
};

test("an empty or zero amount asks for an amount", () => {
  expect(message("", { balance: fusd(10), room: fusd(10) })).toBe("Enter an amount.");
  expect(message("0", { balance: fusd(10), room: fusd(10) })).toBe("Enter an amount greater than zero.");
});

test("more than the room left says the limit and what to enter", () => {
  expect(message("5000", { balance: fusd(9000), room: fusd(3600) })).toBe(
    "This exceeds the 3,600.00 fUSD still available. Enter 3,600.00 fUSD or less.",
  );
});

test("more than the balance says the balance", () => {
  expect(message("500", { balance: fusd(100), room: fusd(3600) })).toBe(
    "This exceeds your balance of 100.00 fUSD. Enter 100.00 fUSD or less.",
  );
});

test("a wallet with no fUSD says so", () => {
  expect(message("1", { balance: 0n, room: fusd(3600) })).toBe("Your wallet holds no fUSD to lend.");
});

test("a valid amount passes and keeps the text; a trailing dot is allowed while typing", () => {
  expect(check("500", { balance: fusd(1250), room: fusd(3600) }).success).toBe(true);
  expect(check("1.5", { balance: fusd(2), room: fusd(3600) }).success).toBe(true);
  expect(check("2.", { balance: fusd(2), room: fusd(3600) }).success).toBe(true);
});

test("an unknown balance does not block the amount rule, the form blocks the button instead", () => {
  expect(check("500", { balance: null, room: fusd(3600) }).success).toBe(true);
  expect(message("5000", { balance: null, room: fusd(3600) })).toMatch(/still available/);
});
