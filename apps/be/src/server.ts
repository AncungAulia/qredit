import { createPublicClient, http } from "viem";
import { accountFrom, broadcastHybrid, parseKeyList, parseKeySpec, type Net, txEvents } from "@qredit/qore";
import { chainCardVerifier } from "./services/cards.ts";
import { loadConfig } from "./config.ts";
import { pgDb } from "./db/client.ts";
import { createFaucet, ipHasher, treasurySender } from "./services/faucet.ts";
import { createApp } from "./http/app.ts";
import { MIGRATIONS_DIR, runMigrations } from "./db/migrate.ts";
import { createRelayer } from "./services/relayer.ts";
import { listBusinesses } from "./db/store/index.ts";
import { syncVault, viemLogSource } from "./services/watcher.ts";
import { assertWindowOptions, keepWindows, sdkWindowChain, serialPerAccount } from "./services/windows.ts";

const cfg = loadConfig();
const net: Net = { chainId: cfg.QORE_CHAIN_ID, rest: cfg.QORE_REST_URL, rpc: cfg.QORE_RPC_URL };
const db = pgDb(cfg.DATABASE_URL);
console.log("[migrate] applied:", await runMigrations(db, MIGRATIONS_DIR));

const relayer = await accountFrom(parseKeySpec(cfg.RELAYER_KEY));
const treasury = await accountFrom(parseKeySpec(cfg.TREASURY_KEY));
const operators = await Promise.all(parseKeyList(cfg.OPERATOR_KEYS).map(accountFrom));
const client = createPublicClient({ transport: http(cfg.QORE_EVM_URL) });

const vaultSpenders = async () =>
  new Map((await listBusinesses(db)).map((b) => [b.vault.toLowerCase(), b.spender.toLowerCase()] as const));
const relay = createRelayer({
  relayerAddress: relayer.cosmos,
  vaults: vaultSpenders,
  send: (msg) => broadcastHybrid(net, relayer, [msg], { memo: "qredit relay", gas: "1500000", feeUqor: "200000" }),
  events: (hash) => txEvents(net.rest, hash),
});
const faucet = createFaucet({
  db,
  send: treasurySender(net, treasury, cfg.FAUCET_UQOR, cfg.FAUCET_FUSD_UNITS),
  cooldownHours: cfg.FAUCET_COOLDOWN_HOURS,
  dailyCap: cfg.FAUCET_DAILY_CAP,
  hashIp: ipHasher(cfg.IP_SALT),
});

const app = createApp({
  db,
  engineToken: cfg.ENGINE_TOKEN,
  corsOrigins: cfg.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  relayerAddress: relayer.cosmos,
  relay,
  faucet,
  verifyCard: chainCardVerifier(net),
  trustedProxyHops: cfg.TRUSTED_PROXY_HOPS,
  clientIpHeader: cfg.CLIENT_IP_HEADER,
  rateLimits: { envelopes: cfg.RATE_ENVELOPES_PER_MIN, cards: cfg.RATE_CARDS_PER_MIN, faucet: cfg.RATE_FAUCET_PER_MIN },
});

function loop(name: string, everyMs: number, fn: () => Promise<void>) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[${name}]`, (e as Error).message);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, everyMs);
  void tick();
}

const logs = viemLogSource(client);
loop("watcher", cfg.WATCH_INTERVAL_MS, async () => {
  for (const b of await listBusinesses(db)) await syncVault(db, logs, b.vault, b.startBlock, b.version);
});

const windowOptions = { blocks: 17_280, maxTxs: cfg.WINDOW_MAX_TXS, maxValue: cfg.WINDOW_MAX_UQOR, minBlocks: cfg.WINDOW_MIN_BLOCKS };
assertWindowOptions(windowOptions); // bad window config stops the boot instead of failing every tick
const windowChain = serialPerAccount(sdkWindowChain(net));
loop("windows", cfg.WINDOW_CHECK_INTERVAL_MS, async () => {
  const businesses = await listBusinesses(db);
  const items = operators
    .map((account) => ({ account, targets: businesses.filter((b) => b.operator.toLowerCase() === account.evm.toLowerCase()).map((b) => b.vault) }))
    .filter((i) => i.targets.length > 0);
  for (const r of await keepWindows(items, windowChain, windowOptions)) {
    if (r.action !== "kept") console.log("[windows]", JSON.stringify(r));
  }
});

// Hono reads the socket peer from env.server (used when there is no trusted proxy header).
Bun.serve({ hostname: "::", port: cfg.PORT, maxRequestBodySize: 512 * 1024, fetch: (req, server) => app.fetch(req, { server }) });
console.log(`[http] listening on :${cfg.PORT}; relayer ${relayer.cosmos}; treasury ${treasury.cosmos}; operators ${operators.length}`);
