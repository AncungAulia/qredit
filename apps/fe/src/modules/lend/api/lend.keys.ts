export const lendKeys = {
  all: ["lend"] as const,
  positions: (evm: string, vaults: string[]) => ["lend", "positions", evm, ...vaults] as const,
  balance: (evm: string) => ["lend", "balance", evm] as const,
};
