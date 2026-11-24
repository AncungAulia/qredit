import { createPublicClient, http } from "viem";
import { accountFrom, parseKeyList, parseKeySpec } from "./chain/keys.ts";
import { broadcastHybrid, type Net, txEvents } from "./chain/tx.ts";
import { chainCardVerifier } from "./cards.ts";
import { loadConfig } from "./config.ts";
import { pgDb } from "./db.ts";
import { createFaucet, ipHasher, treasurySender } from "./faucet.ts";
import { createApp } from "./http.ts";
import { MIGRATIONS_DIR, runMigrations } from "./migrate.ts";
import { createRelayer } from "./relayer.ts";
import { listBusinesses } from "./store.ts";
import { syncVault, viemLogSource } from "./watcher.ts";
import { keepWindows, sdkWindowChain } from "./windows.ts";

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
  for (const b of await listBusinesses(db)) await syncVault(db, logs, b.vault, b.startBlock);
});

const windowChain = sdkWindowChain(net);
loop("windows", cfg.WINDOW_CHECK_INTERVAL_MS, async () => {
  const businesses = await listBusinesses(db);
  const items = operators
    .map((account) => ({ account, targets: businesses.filter((b) => b.operator.toLowerCase() === account.evm.toLowerCase()).map((b) => b.vault) }))
    .filter((i) => i.targets.length > 0);
  for (const r of await keepWindows(items, windowChain, {
    blocks: 17_280, maxTxs: cfg.WINDOW_MAX_TXS, maxValue: cfg.WINDOW_MAX_UQOR, minBlocks: cfg.WINDOW_MIN_BLOCKS,
  })) {
    if (r.action !== "kept") console.log("[windows]", JSON.stringify(r));
  }
});

Bun.serve({ port: cfg.PORT, fetch: app.fetch });
console.log(`[http] listening on :${cfg.PORT}; relayer ${relayer.cosmos}; treasury ${treasury.cosmos}; operators ${operators.length}`);
