import { SUPPLIERS } from "@qredit/qore/suppliers";

const KNOWN = new Set(Object.values(SUPPLIERS).map((a) => a.toLowerCase()));

/** Suppliers that are not in Qredit's supplier list (`packages/qore/src/suppliers.json`). */
export const unknownSuppliers = (addresses: readonly string[]): string[] => addresses.filter((a) => !KNOWN.has(a.toLowerCase()));

/** The vault can pay an address Qredit does not know, which may be the owner's own (spec hole K1). */
export const hasUnverifiedSuppliers = (addresses: readonly string[]): boolean => unknownSuppliers(addresses).length > 0;
