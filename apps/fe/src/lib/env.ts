const required = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local.`);
  return value.replace(/\/$/, "");
};

export const env = {
  apiUrl: required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL),
  evmUrl: required("NEXT_PUBLIC_QORE_EVM_URL", process.env.NEXT_PUBLIC_QORE_EVM_URL),
  chainId: required("NEXT_PUBLIC_QORE_CHAIN_ID", process.env.NEXT_PUBLIC_QORE_CHAIN_ID),
  explorerUrl: (process.env.NEXT_PUBLIC_EXPLORER_URL ?? "").replace(/\/$/, ""),
} as const;
