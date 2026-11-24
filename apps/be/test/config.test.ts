import { describe, expect, test } from "bun:test";
import { FUSD_DENOM } from "@qredit/qore";
import { loadConfig } from "../src/config.ts";

const base = {
  DATABASE_URL: "postgresql://u:p@host:5432/postgres",
  ENGINE_TOKEN: "x".repeat(32),
  IP_SALT: "s".repeat(16),
  RELAYER_KEY: '{"mnemonic":"a b c"}',
  TREASURY_KEY: '{"mnemonic":"a b c"}',
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(8787);
    expect(c.QORE_CHAIN_ID).toBe("qorechain-diana");
    expect(c.FAUCET_UQOR).toBe(2_000_000n);
    expect(c.FAUCET_FUSD_UNITS).toBe(50_000_000n);
    expect(c.WINDOW_MIN_BLOCKS).toBe(3600);
    expect(c.OPERATOR_KEYS).toBe("[]");
    expect(c.TRUSTED_PROXY_HOPS).toBe(1);
    expect(c.FAUCET_DAILY_CAP).toBe(200);
    expect([c.RATE_ENVELOPES_PER_MIN, c.RATE_CARDS_PER_MIN, c.RATE_FAUCET_PER_MIN]).toEqual([30, 10, 5]);
  });

  test("rejects a short engine token", () => {
    expect(() => loadConfig({ ...base, ENGINE_TOKEN: "short" })).toThrow();
  });

  test("requires the database url", () => {
    const { DATABASE_URL: _, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow();
  });

  test("fUSD denom is the faucet bank coin", () => {
    expect(FUSD_DENOM).toBe("erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA");
  });
});
