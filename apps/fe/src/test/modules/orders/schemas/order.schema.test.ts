import { expect, test } from "vitest";
import { MAX_INPUT } from "@qredit/qore";
import { inputRuleFor, orderInput, orderInputSchema, ADDRESS_ERROR } from "@/modules/orders/schemas/order.schema";

const HEX = "0x37bb4c1e9a2f03d4aa11bb22cc33dd44ee55ff66";
const QOR = "qor1q4k8xv2d9ewn7lm0t5c3j6yhp4r8z2s0km3s07d";

test("a single-address service takes one qor1 or 0x address", () => {
  const schema = orderInputSchema("counterparty-check");
  expect(schema.safeParse(HEX).success).toBe(true);
  expect(schema.safeParse(`  ${HEX}\n`).success).toBe(true);
  expect(schema.safeParse(QOR).success).toBe(false); // checksum of the sample is not valid
});

test("a real qor1 address is accepted", async () => {
  const { hexToQor } = await import("@qredit/qore");
  expect(orderInputSchema("due-diligence").safeParse(hexToQor(HEX)).success).toBe(true);
});

test("an invalid address is refused with a sentence under the field", () => {
  const r = orderInputSchema("counterparty-check").safeParse("0x37bb4c1e9a2f03d4");
  expect(r.success).toBe(false);
  expect(r.error?.issues[0]?.message).toBe(ADDRESS_ERROR);
});

test("an empty input is refused", () => {
  const r = orderInputSchema("contract-auditor").safeParse("   ");
  expect(r.error?.issues[0]?.message).toBe("Enter an address.");
});

test("a single-address service refuses two addresses", () => {
  const r = orderInputSchema("due-diligence").safeParse(`${HEX} ${HEX}`);
  expect(r.error?.issues[0]?.message).toBe("Enter exactly one address.");
});

test("the sanctions screen takes up to 20 addresses separated by commas, spaces or lines", () => {
  const schema = orderInputSchema("sanctions-screen");
  expect(schema.safeParse(`${HEX}, ${HEX}\n${HEX}`).success).toBe(true);
  const twenty = Array.from({ length: 20 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`).join("\n");
  expect(schema.safeParse(twenty).success).toBe(true);
  const r = schema.safeParse(`${twenty}\n0x${"f".repeat(40)}`);
  expect(r.error?.issues[0]?.message).toBe("Enter at most 20 addresses.");
});

test("the sanctions screen names the first bad address", () => {
  const r = orderInputSchema("sanctions-screen").safeParse(`${HEX} nonsense`);
  expect(r.error?.issues[0]?.message).toBe(ADDRESS_ERROR);
});

test("a text longer than the limit is refused", () => {
  const r = orderInputSchema("sanctions-screen").safeParse("a".repeat(MAX_INPUT + 1));
  expect(r.success).toBe(false);
});

test("a service this app does not know takes free text up to the limit", () => {
  const schema = orderInputSchema("something-new");
  expect(schema.safeParse("hello").success).toBe(true);
  expect(schema.safeParse("a".repeat(MAX_INPUT + 1)).success).toBe(false);
  expect(inputRuleFor("something-new").kind).toBe("text");
});

test("orderInput gives the text that is sealed: addresses on separate lines, trimmed", () => {
  expect(orderInput("sanctions-screen", ` ${HEX},\n${HEX.toUpperCase().replace("0X", "0x")} `)).toBe(`${HEX}\n${HEX.toUpperCase().replace("0X", "0x")}`);
  expect(orderInput("counterparty-check", `  ${HEX} `)).toBe(HEX);
});

test("only the counterparty check pre-fills the buyer's own address", () => {
  expect(inputRuleFor("counterparty-check").prefillOwn).toBe(true);
  expect(inputRuleFor("sanctions-screen").prefillOwn).toBe(false);
});
