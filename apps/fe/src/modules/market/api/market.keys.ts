export const marketKeys = {
  all: ["market"] as const,
  businesses: ["market", "businesses"] as const,
  business: (slug: string) => ["market", "business", slug] as const,
  vault: (vault: string) => ["market", "vault", vault] as const,
  orders: (vault: string) => ["market", "orders", vault] as const,
  blockTimes: (blocks: number[]) => ["market", "blockTimes", ...blocks] as const,
};
