export const businessKeys = {
  suppliers: (vault: string) => ["business", "suppliers", vault] as const,
  rules: (vault: string) => ["business", "rules", vault] as const,
  decisions: (vault: string) => ["business", "decisions", vault] as const,
  defaultable: (vault: string) => ["business", "defaultable", vault] as const,
  books: (vault: string) => ["business", "books", vault] as const,
};
