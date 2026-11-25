import { SUPPLIER_NAMES, SUPPLIERS, type SupplierRole } from "@qredit/qore";

const NAME_BY_ADDRESS = new Map<string, string>(
  (Object.keys(SUPPLIERS) as SupplierRole[]).map((role) => [SUPPLIERS[role], SUPPLIER_NAMES[role]]),
);

/** The display name of a testnet supplier, or undefined for an address that is not one of them. */
export const supplierName = (address: string): string | undefined =>
  NAME_BY_ADDRESS.get(address.toLowerCase());
