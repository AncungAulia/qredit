export const marketKeys = {
  all: ["market"] as const,
  business: (slug: string) => ["market", "business", slug] as const,
  vault: (vault: string) => ["market", "vault", vault] as const,
  orders: (vault: string) => ["market", "orders", vault] as const,
  latestOrders: (txs: string[]) => ["market", "latestOrders", ...txs] as const,
};
