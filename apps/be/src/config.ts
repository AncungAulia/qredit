import { z } from "zod";

export const FUSD_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8787),
  ENGINE_TOKEN: z.string().min(32, "ENGINE_TOKEN must be at least 32 characters"),
  IP_SALT: z.string().min(16),
  CORS_ORIGINS: z.string().default("http://localhost:3000,https://app.qredit.fun,https://qredit.fun"),
  QORE_CHAIN_ID: z.string().default("qorechain-diana"),
  QORE_REST_URL: z.string().url().default("https://api-testnet.qore.host"),
  QORE_RPC_URL: z.string().url().default("https://rpc-testnet.qore.host"),
  QORE_EVM_URL: z.string().url().default("https://evm-testnet.qore.host"),
  RELAYER_KEY: z.string().min(1),
  TREASURY_KEY: z.string().min(1),
  OPERATOR_KEYS: z.string().default("[]"),
  FAUCET_UQOR: z.coerce.bigint().default(2_000_000n),
  FAUCET_FUSD_UNITS: z.coerce.bigint().default(50_000_000n),
  FAUCET_COOLDOWN_HOURS: z.coerce.number().positive().default(24),
  FAUCET_DAILY_CAP: z.coerce.number().int().positive().default(200),
  /** Reverse proxies in front of this process; the client is the x-forwarded-for entry they appended. 0 ignores the header. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  RATE_ENVELOPES_PER_MIN: z.coerce.number().int().positive().default(30),
  RATE_CARDS_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_FAUCET_PER_MIN: z.coerce.number().int().positive().default(5),
  WATCH_INTERVAL_MS: z.coerce.number().int().positive().default(4000),
  WINDOW_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  WINDOW_MIN_BLOCKS: z.coerce.number().int().positive().default(3600),
  WINDOW_MAX_TXS: z.coerce.number().int().positive().default(500),
  WINDOW_MAX_UQOR: z.coerce.bigint().default(25_000_000n),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
