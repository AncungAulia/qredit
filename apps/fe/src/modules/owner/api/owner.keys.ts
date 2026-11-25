export const ownerKeys = {
  all: ["owner"] as const,
  owned: (evm: string, vaults: string[]) => ["owner", "owned", evm, ...vaults] as const,
  rules: (vault: string) => ["owner", "rules", vault] as const,
};
