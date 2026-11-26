import { expect, test } from "vitest";
import {
  ZERO_ADDRESS,
  KIND_INFO,
  POLICY_KINDS,
  orderInput,
  isBareHex,
  parseSignature,
  policyOrderSchema,
} from "@/modules/owner/schemas/policyOrder.schema";

const SUPPLIER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const base = { kind: "Pause", target: "", value: "", operator: "", expiryMinutes: "30" } as const;
const parse = (over: Record<string, string>) => policyOrderSchema.safeParse({ ...base, ...over });
const message = (over: Record<string, string>) => {
  const r = parse(over);
  return r.success ? null : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

test("the kinds keep the order of the contract enum", () => {
  expect([...POLICY_KINDS]).toEqual([
    "RemoveSupplier",
    "LowerSupplierCap",
    "LowerDailyCap",
    "Pause",
    "Unpause",
    "AddSupplier",
    "RaiseSupplierCap",
    "RaiseDailyCap",
    "Close",
    "RotateAgent",
  ]);
});

test("only the three raising kinds are marked as widening, as the vault locks them", () => {
  expect(POLICY_KINDS.filter((k) => KIND_INFO[k].widening)).toEqual(["AddSupplier", "RaiseSupplierCap", "RaiseDailyCap"]);
});

test("pause and unpause need neither a supplier nor an amount", () => {
  expect(parse({ kind: "Pause" }).success).toBe(true);
  expect(parse({ kind: "Unpause" }).success).toBe(true);
});

test("a daily cap kind needs an amount greater than zero and no supplier", () => {
  expect(parse({ kind: "LowerDailyCap", value: "40" }).success).toBe(true);
  expect(message({ kind: "LowerDailyCap", value: "" })).toEqual(["value: Enter an amount."]);
  expect(message({ kind: "RaiseDailyCap", value: "0" })).toEqual(["value: Enter an amount greater than zero."]);
  expect(message({ kind: "LowerDailyCap", value: "1.1234567" })).toEqual(["value: Enter an amount greater than zero."]);
});

test("a supplier kind needs a valid supplier address", () => {
  expect(parse({ kind: "RemoveSupplier", target: SUPPLIER }).success).toBe(true);
  expect(message({ kind: "RemoveSupplier", target: "" })).toEqual(["target: Enter the address of the supplier."]);
  expect(message({ kind: "RemoveSupplier", target: "0x123" })?.[0]).toMatch(/^target: This is not a valid address/);
});

test("a supplier cap kind needs both the supplier and an amount", () => {
  expect(parse({ kind: "AddSupplier", target: SUPPLIER, value: "5" }).success).toBe(true);
  expect(message({ kind: "LowerSupplierCap", target: "", value: "" })).toEqual([
    "target: Enter the address of the supplier.",
    "value: Enter an amount.",
  ]);
});

test("the validity is 5 to 1440 whole minutes", () => {
  expect(parse({ expiryMinutes: "5" }).success).toBe(true);
  expect(parse({ expiryMinutes: "1440" }).success).toBe(true);
  expect(message({ expiryMinutes: "4" })).toEqual(["expiryMinutes: Enter a whole number of minutes from 5 to 1,440."]);
  expect(message({ expiryMinutes: "1441" })).toEqual(["expiryMinutes: Enter a whole number of minutes from 5 to 1,440."]);
  expect(message({ expiryMinutes: "" })).toEqual(["expiryMinutes: Enter a whole number of minutes from 5 to 1,440."]);
});

test("orderInput turns the form values into the contract values", () => {
  expect(orderInput({ kind: "LowerDailyCap", target: "", value: "40.5", operator: "", expiryMinutes: "30" })).toEqual({
    kind: 2,
    target: "0x0000000000000000000000000000000000000000",
    value: 40_500_000n,
    expiryMinutes: 30,
  });
  const supplier = orderInput({ kind: "RemoveSupplier", target: SUPPLIER, value: "", operator: "", expiryMinutes: "5" });
  expect(supplier.kind).toBe(0);
  expect(supplier.target).toBe(SUPPLIER.toLowerCase());
  expect(supplier.value).toBe(0n);
});

test("a field a kind does not use is ignored even when it holds text", () => {
  expect(orderInput({ kind: "Pause", target: SUPPLIER, value: "9", operator: "", expiryMinutes: "30" })).toMatchObject({
    kind: 3,
    target: "0x0000000000000000000000000000000000000000",
    value: 0n,
  });
});

test("parseSignature reads hex and base64 and refuses anything else", () => {
  expect(parseSignature("0x0a0b0c")).toEqual(Uint8Array.from([10, 11, 12]));
  expect(parseSignature("  0X0A0B0C \n")).toEqual(Uint8Array.from([10, 11, 12]));
  expect(parseSignature("CgsM")).toEqual(Uint8Array.from([10, 11, 12]));
  expect(parseSignature("")).toBeNull();
  expect(parseSignature("0x")).toBeNull();
  expect(parseSignature("0xabc")).toBeNull(); // odd length
  expect(parseSignature("0xzz")).toBeNull();
  expect(parseSignature("not a signature!")).toBeNull();
  // hex without 0x is never read as base64
  expect(parseSignature("0a0b0c0d")).toBeNull();
  expect(parseSignature("abcd")).toBeNull();
});

test("isBareHex spots hex without 0x so the form can ask for the prefix", () => {
  expect(isBareHex("0a0b0c0d")).toBe(true);
  expect(isBareHex(" ABCD  ")).toBe(true);
  expect(isBareHex("0x0a0b")).toBe(false);
  expect(isBareHex("abc")).toBe(false); // odd length
  expect(isBareHex("CgsM")).toBe(false);
  expect(isBareHex("")).toBe(false);
});

const NEW_SPENDER = "0x00000000000000000000000000000000000000c1";
const NEW_OPERATOR = "0x00000000000000000000000000000000000000c2";

test("Close and RotateAgent follow the contract's kind numbers", () => {
  expect(POLICY_KINDS.indexOf("Close")).toBe(8);
  expect(POLICY_KINDS.indexOf("RotateAgent")).toBe(9);
});

test("RotateAgent needs both new keys and carries the operator in value", () => {
  const missing = policyOrderSchema.safeParse({ kind: "RotateAgent", target: NEW_SPENDER, value: "", operator: "", expiryMinutes: "30" });
  expect(missing.success).toBe(false);
  const ok = policyOrderSchema.parse({ kind: "RotateAgent", target: NEW_SPENDER, value: "", operator: NEW_OPERATOR, expiryMinutes: "30" });
  expect(orderInput(ok)).toEqual({ kind: 9, target: NEW_SPENDER, value: BigInt(NEW_OPERATOR), expiryMinutes: 30 });
});

test("Close needs no address and no amount", () => {
  const v = policyOrderSchema.parse({ kind: "Close", target: "", value: "", operator: "", expiryMinutes: "30" });
  expect(orderInput(v)).toEqual({ kind: 8, target: ZERO_ADDRESS, value: 0n, expiryMinutes: 30 });
  expect(KIND_INFO.Close.irreversible).toBe(true);
});
