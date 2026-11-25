import { z } from "zod";
import { qorToHex } from "@qredit/qore/address";
import { parseFusd } from "@/lib/format";

/** The kinds of the vault's policy orders. The index of a name is the uint8 `kind` the vault takes. */
export const POLICY_KINDS = [
  "RemoveSupplier",
  "LowerSupplierCap",
  "LowerDailyCap",
  "Pause",
  "Unpause",
  "AddSupplier",
  "RaiseSupplierCap",
  "RaiseDailyCap",
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const EXPIRY_MIN = 5;
export const EXPIRY_MAX = 1440;

type KindInfo = {
  label: string;
  description: string;
  /** The order names one supplier. */
  target: boolean;
  /** The order carries an amount in fUSD. */
  value: boolean;
  valueLabel: string;
  /** The vault refuses these until the loan is repaid. */
  widening: boolean;
};

/** What each kind means for the owner. `target` and `value` follow what `applyOrder` reads for that kind. */
export const KIND_INFO: Record<PolicyKind, KindInfo> = {
  Pause: {
    label: "Pause the agent",
    description: "Stops new payments to suppliers. Open orders can still be delivered or reclaimed.",
    target: false,
    value: false,
    valueLabel: "",
    widening: false,
  },
  Unpause: {
    label: "Resume the agent",
    description: "Lets the agent pay suppliers again after a pause.",
    target: false,
    value: false,
    valueLabel: "",
    widening: false,
  },
  LowerDailyCap: {
    label: "Lower the daily spending cap",
    description: "The agent may spend less each day.",
    target: false,
    value: true,
    valueLabel: "New daily cap",
    widening: false,
  },
  LowerSupplierCap: {
    label: "Lower a supplier limit",
    description: "One supplier may be paid less for each payment.",
    target: true,
    value: true,
    valueLabel: "New limit for each payment",
    widening: false,
  },
  RemoveSupplier: {
    label: "Remove a supplier",
    description: "The agent can no longer pay this supplier.",
    target: true,
    value: false,
    valueLabel: "",
    widening: false,
  },
  RaiseDailyCap: {
    label: "Raise the daily spending cap",
    description: "The agent may spend more each day.",
    target: false,
    value: true,
    valueLabel: "New daily cap",
    widening: true,
  },
  RaiseSupplierCap: {
    label: "Raise a supplier limit",
    description: "One supplier may be paid more for each payment.",
    target: true,
    value: true,
    valueLabel: "New limit for each payment",
    widening: true,
  },
  AddSupplier: {
    label: "Add a supplier",
    description: "The agent may pay a new supplier, up to the limit you set.",
    target: true,
    value: true,
    valueLabel: "Limit for each payment",
    widening: true,
  },
};

/** The order the kinds are listed in: what narrows the rules first, what widens them last. */
export const KIND_LIST: PolicyKind[] = [
  "Pause",
  "Unpause",
  "LowerDailyCap",
  "LowerSupplierCap",
  "RemoveSupplier",
  "RaiseDailyCap",
  "RaiseSupplierCap",
  "AddSupplier",
];

export const ADDRESS_ERROR = "This is not a valid address. Enter one that starts with qor1 or 0x.";
export const EXPIRY_ERROR = `Enter a whole number of minutes from ${EXPIRY_MIN} to ${EXPIRY_MAX.toLocaleString("en-US")}.`;

/** The address of a supplier as 0x text, from a 0x or qor1 address; null when it is neither. */
export function supplierAddress(text: string): `0x${string}` | null {
  const t = text.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase() as `0x${string}`;
  if (t.startsWith("qor1")) {
    const hex = qorToHex(t);
    return hex ? (hex.toLowerCase() as `0x${string}`) : null;
  }
  return null;
}

/** An amount typed as text; a trailing dot is allowed while the person is still typing. */
const amountUnits = (text: string): bigint | null => parseFusd(text.replace(/\.$/, ""));

/** The Owner form: which change, its one supplier and one amount where the kind uses them, and how long the order stays valid. */
export const policyOrderSchema = z
  .object({
    kind: z.enum(POLICY_KINDS),
    target: z.string(),
    value: z.string(),
    expiryMinutes: z.string(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const info = KIND_INFO[v.kind];
    if (info.target) {
      if (v.target.trim() === "") issue("target", "Enter the address of the supplier.");
      else if (supplierAddress(v.target) === null) issue("target", ADDRESS_ERROR);
    }
    if (info.value) {
      if (v.value.trim() === "") issue("value", "Enter an amount.");
      else {
        const units = amountUnits(v.value);
        if (units === null || units <= 0n) issue("value", "Enter an amount greater than zero.");
      }
    }
    const minutes = /^\d+$/.test(v.expiryMinutes.trim()) ? Number(v.expiryMinutes) : NaN;
    if (!(minutes >= EXPIRY_MIN && minutes <= EXPIRY_MAX)) issue("expiryMinutes", EXPIRY_ERROR);
  });
export type PolicyOrderValues = z.infer<typeof policyOrderSchema>;

/** The order exactly as the vault's `applyOrder` takes it. */
export type PolicyOrder = { kind: number; target: `0x${string}`; value: bigint; nonce: bigint; expiry: bigint };

/** What the owner chose, before the vault's nonce and the clock make it an order. */
export type OrderInput = { kind: number; target: `0x${string}`; value: bigint; expiryMinutes: number };

/** The values of a form that passed the schema, as contract values. A field the kind does not use is ignored. */
export function orderInput(values: PolicyOrderValues): OrderInput {
  const info = KIND_INFO[values.kind];
  return {
    kind: POLICY_KINDS.indexOf(values.kind),
    target: (info.target ? supplierAddress(values.target) : null) ?? ZERO_ADDRESS,
    value: info.value ? (amountUnits(values.value) ?? 0n) : 0n,
    expiryMinutes: Number(values.expiryMinutes),
  };
}

/** Hex digits only, even length, no 0x: such text is never read as base64, the owner is asked to add 0x. */
export const isBareHex = (text: string): boolean => /^(?:[0-9a-fA-F]{2})+$/.test(text.trim());

/** A signature pasted as hex (0x…) or base64; null when it is empty, bare hex, or cannot be decoded. */
export function parseSignature(text: string): Uint8Array | null {
  const t = text.trim();
  if (t === "" || isBareHex(t)) return null;
  if (/^0x/i.test(t)) {
    const hex = t.slice(2);
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
    return Uint8Array.from(hex.match(/../g) as string[], (b) => parseInt(b, 16));
  }
  const b64 = t.replace(/\s+/g, "");
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}
