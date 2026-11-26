import { z } from "zod";

export const balancesSchema = z.object({
  balances: z.array(z.object({ denom: z.string(), amount: z.string().regex(/^\d+$/) })),
});

export const cardResponseSchema = z.object({ card: z.unknown() }).refine((v) => v.card !== null && v.card !== undefined);

export const faucetOkSchema = z.object({ tx: z.string() });
export const faucetLimitedSchema = z.object({ retryAt: z.coerce.date() });

export type WalletChainStatus = {
  qor: bigint;
  fusdBank: bigint;
  fusd: bigint;
  pqcRegistered: boolean;
  kemRegistered: boolean;
  cardPublished: boolean;
};
