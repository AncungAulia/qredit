import { z } from "zod";

/** Accepts a value or the same value encoded as JSON text (the API returns jsonb columns as text). */
export const jsonText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, schema);

const units = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/).transform((v) => v.toLowerCase() as `0x${string}`);

export const serviceSchema = z.object({ id: z.number().int().nonnegative(), name: z.string(), priceUnits: units });
export type Service = z.infer<typeof serviceSchema>;

const statsSchema = z.object({ delivered: z.number().int(), rejected: z.number().int(), uniqueBuyers: z.number().int() });

export const businessSchema = z.object({
  slug: z.string(),
  vault: hex,
  name: z.string(),
  tagline: z.string(),
  services: jsonText(z.array(serviceSchema)),
  operator: hex,
  spender: hex,
  startBlock: z.number().int(),
  /** v1 vaults stay readable for old orders and positions; Market, lending and buying use v2 only. */
  version: z.union([z.literal(1), z.literal(2)]).default(1),
  ended: z.enum(["defaulted", "closed"]).nullable().default(null),
  /** Counted by the backend from vault events; absent from an older backend. */
  stats: statsSchema.optional(),
});
export type Business = z.infer<typeof businessSchema>;

export const orderStatus = z.enum(["open", "claimed", "delivered", "in_review", "settled", "rejected", "declined", "reclaimed"]);
export const orderSchema = z.object({
  vault: hex,
  orderId: z.string(),
  buyer: hex,
  serviceId: z.number().int(),
  price: units,
  requestRef: hex,
  deadline: z.number().int().transform((s) => new Date(s * 1000)),
  status: orderStatus,
  placedTx: hex,
  placedBlock: z.number().int(),
  envelopeHash: hex.nullable(),
  /** The end of the buyer's review (v2 deliveries only). */
  reviewEnds: z.number().int().nullable().default(null).transform((s) => (s === null ? null : new Date(s * 1000))),
  /** What a rejection returned to the buyer. */
  refund: units.nullable().default(null),
});
export type Order = z.infer<typeof orderSchema>;

export const decisionSchema = z.object({
  id: z.number().int(),
  vault: hex,
  orderId: z.string().nullable(),
  decision: z.enum(["accepted", "declined", "delivered", "failed"]),
  reason: z.string(),
  suppliers: jsonText(z.array(z.object({ role: z.string(), amount: units }))),
  cost: units,
  createdAt: z.string().transform((s) => new Date(s)),
});
export type Decision = z.infer<typeof decisionSchema>;
