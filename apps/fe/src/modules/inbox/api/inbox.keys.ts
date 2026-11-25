export const inboxKeys = {
  all: ["inbox"] as const,
  orders: (evm: string, vaults: string[]) => ["inbox", "orders", evm, ...vaults] as const,
  times: (blocks: number[]) => ["inbox", "times", ...blocks] as const,
  context: (vault: string, orderId: string) => ["inbox", "context", vault, orderId] as const,
  delivery: (vault: string, orderId: string) => ["inbox", "delivery", vault, orderId] as const,
};
