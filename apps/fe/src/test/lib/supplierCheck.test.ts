import { expect, test } from "vitest";
import { SUPPLIERS } from "@qredit/qore/suppliers";
import { hasUnverifiedSuppliers, unknownSuppliers } from "@/lib/supplierCheck";

test("an address outside the Qredit supplier list is unverified, in any case", () => {
  const known = SUPPLIERS.dataIndexer.toUpperCase().replace("0X", "0x");
  const other = "0x00000000000000000000000000000000000000ee";
  expect(unknownSuppliers([known, other])).toEqual([other]);
  expect(hasUnverifiedSuppliers([known])).toBe(false);
  expect(hasUnverifiedSuppliers([known, other])).toBe(true);
});
