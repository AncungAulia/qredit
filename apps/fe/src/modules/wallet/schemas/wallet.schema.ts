import { z } from "zod";

export const balancesSchema = z.object({
  balances: z.array(z.object({ denom: z.string(), amount: z.string().regex(/^\d+$/) })),
});

export const cardResponseSchema = z.object({ card: z.unknown() }).refine((v) => v.card !== null && v.card !== undefined);

export const faucetOkSchema = z.object({ tx: z.string() });
export const faucetLimitedSchema = z.object({ retryAt: z.coerce.date() });

export const walletChainStatusSchema = z.object({
  qor: z.bigint(),
  fusdBank: z.bigint(),
  fusd: z.bigint(),
  pqcRegistered: z.boolean(),
  kemRegistered: z.boolean(),
  cardPublished: z.boolean(),
});
export type WalletChainStatus = z.infer<typeof walletChainStatusSchema>;
