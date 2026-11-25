import { expect, test } from "bun:test";
import { SUPPLIER_NAMES, SUPPLIERS } from "../src/suppliers.ts";

test("every supplier role has a lowercase address and a name", () => {
  const roles = Object.keys(SUPPLIER_NAMES);
  expect(Object.keys(SUPPLIERS).sort()).toEqual([...roles].sort());
  for (const role of roles) {
    expect(SUPPLIERS[role as keyof typeof SUPPLIERS]).toMatch(/^0x[0-9a-f]{40}$/);
    expect(SUPPLIER_NAMES[role as keyof typeof SUPPLIER_NAMES].length).toBeGreaterThan(0);
  }
});

test("no two suppliers share an address", () => {
  const a = Object.values(SUPPLIERS);
  expect(new Set(a).size).toBe(a.length);
});
