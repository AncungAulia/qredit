export const proofKeys = {
  business: (slug: string) => ["proof", "business", slug] as const,
  factoryCodeHash: ["proof", "factoryCodeHash"] as const,
  factoryVaults: ["proof", "factoryVaults"] as const,
};
