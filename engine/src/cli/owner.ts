import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPqcStatus } from "@qorechain/sdk";
import { FACTORY_ADDRESS, FUSD_ADDRESS, TESTNET } from "@qredit/qore";
import { loadEngineConfig } from "../config.ts";
import { keystore } from "../keystore.ts";
import { accountNames, agentKey, ensureAccounts, loadAccount, SUPPLIER_ACCOUNTS } from "../setup/accounts.ts";
import { loadBusinesses, vaultInit } from "../setup/businesses.ts";
import { convertFusd, createVault, lend, linkAgent, openWindow, registerBusiness, registerKey, sendQor } from "../setup/chain.ts";
import { readDeployments, writeDeployment } from "../setup/deployments.ts";

const cfg = loadEngineConfig();
const ks = keystore(cfg.KEYS_DIR);
const businesses = loadBusinesses();
const names = accountNames(businesses);
const keyed = (n: string) => !n.endsWith("-agent");
const units = (fusd: string) => BigInt(Math.round(Number(fusd) * 1e6));
const uqor = (qor: string) => BigInt(Math.round(Number(qor) * 1e6));

async function balance(address: string): Promise<string> {
  const r = await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`);
  const b = r.ok ? ((await r.json()) as { balances: { denom: string; amount: string }[] }).balances : [];
  const q = Number(b.find((x) => x.denom === "uqor")?.amount ?? 0) / 1e6;
  const f = Number(b.find((x) => x.denom.startsWith("erc20:0x97143"))?.amount ?? 0) / 1e6;
  return `${q} QOR, ${f} bank fUSD`;
}

function upsertEnv(path: string, entries: Record<string, string>) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((l) => !Object.keys(entries).some((k) => l.startsWith(`${k}=`)));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  writeFileSync(path, [...kept, ...Object.entries(entries).map(([k, v]) => `${k}=${v}`), ""].join("\n"), { mode: 0o600 });
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async "accounts"([sub]) {
    if (sub === "init") {
      const r = ensureAccounts(ks, names);
      console.log(`created ${r.created.length}, existing ${r.existing.length}`);
    } else if (sub === "show") {
      for (const n of names.filter(keyed)) {
        const a = await loadAccount(ks, n);
        const pqc = await fetchPqcStatus({ rest: TESTNET.rest, address: a.cosmos });
        console.log(`${n.padEnd(28)} ${a.cosmos} ${a.evm}  ${await balance(a.cosmos)}  ML-DSA ${pqc.registered ? "yes" : "no"}`);
      }
    } else if (sub === "register") {
      for (const n of names.filter(keyed)) {
        try {
          const tx = await registerKey(await loadAccount(ks, n));
          console.log(`${n}: ${tx ?? "already registered"}`);
        } catch (e) {
          console.log(`${n}: skipped (${(e as Error).message})`);
        }
      }
    } else throw new Error("usage: accounts init|show|register");
  },
  async "fund"([from, qor, fusd, ...to]) {
    const sender = await loadAccount(ks, from);
    const targets = await Promise.all(to.map(async (n) => (await loadAccount(ks, n)).cosmos));
    console.log("funded:", await sendQor(sender, targets, uqor(qor), units(fusd)));
  },
  async "convert"([name, fusd]) {
    console.log("converted:", await convertFusd(await loadAccount(ks, name), units(fusd)));
  },
  async "windows"() {
    const treasury = await loadAccount(ks, "treasury");
    const vaults = Object.values(readDeployments()).map((d) => d.vault);
    console.log("treasury window:", await openWindow(treasury, [FACTORY_ADDRESS, FUSD_ADDRESS, ...vaults], { blocks: 3600, maxTxs: 40, maxValue: 60_000_000n }));
  },
  async "business"([sub, which]) {
    if (sub !== "create" || !which) throw new Error("usage: business create <slug>|all");
    if (!cfg.ENGINE_TOKEN) throw new Error("ENGINE_TOKEN is required in engine/.env");
    const treasury = await loadAccount(ks, "treasury");
    const suppliers = Object.fromEntries(
      await Promise.all(Object.entries(SUPPLIER_ACCOUNTS).map(async ([role, name]) => [role, (await loadAccount(ks, name)).evm.toLowerCase()])),
    ) as Record<keyof typeof SUPPLIER_ACCOUNTS, `0x${string}`>;
    for (const b of businesses.filter((x) => which === "all" || x.slug === which)) {
      const spender = await loadAccount(ks, `${b.slug}-spender`);
      const operator = await loadAccount(ks, `${b.slug}-operator`);
      const agent = agentKey(ks, b.slug);
      let d = readDeployments()[b.slug];
      if (!d) {
        const init = vaultInit(b, { spender: spender.evm.toLowerCase() as `0x${string}`, operator: operator.evm.toLowerCase() as `0x${string}`, ownerPq: cfg.OWNER_ADDRESS.toLowerCase() as `0x${string}`, suppliers }, Math.floor(Date.now() / 1000));
        const v = await createVault(treasury, init);
        d = { slug: b.slug, vault: v.vault, startBlock: v.startBlock, createTx: v.tx, spender: spender.evm.toLowerCase(), operator: operator.evm.toLowerCase(), agentPubkey: Buffer.from(agent.publicKey).toString("hex"), linkTx: "", windowTx: "" };
        writeDeployment(d);
        console.log(`${b.slug}: vault ${d.vault} (block ${d.startBlock})`);
      }
      if (!d.linkTx) {
        d = { ...d, linkTx: await linkAgent(spender, agent, d.vault) };
        writeDeployment(d);
        console.log(`${b.slug}: agent key linked ${d.linkTx}`);
      }
      if (!d.windowTx) {
        d = { ...d, windowTx: await openWindow(operator, [d.vault]) };
        writeDeployment(d);
        console.log(`${b.slug}: operator window ${d.windowTx}`);
      }
      await registerBusiness(cfg.API_URL, cfg.ENGINE_TOKEN, {
        slug: b.slug, vault: d.vault, name: b.name, tagline: b.tagline, services: b.services,
        operator: d.operator, spender: d.spender, startBlock: d.startBlock,
      });
      console.log(`${b.slug}: registered with the API`);
    }
  },
  async "lend"([slug, fusd]) {
    const d = readDeployments()[slug];
    if (!d) throw new Error(`no deployment for ${slug}; run business create first`);
    const r = await lend(await loadAccount(ks, "treasury"), d.vault, units(fusd));
    console.log(`${slug}: approved ${r.approveTx}, deposited ${r.depositTx}`);
  },
  async "be-env"() {
    const spec = (n: string) => JSON.stringify(ks.read(n));
    const operators = businesses.map((b) => ks.read(`${b.slug}-operator`));
    upsertEnv(join(import.meta.dir, "..", "..", "..", "apps", "be", ".env"), {
      RELAYER_KEY: spec("relayer"),
      TREASURY_KEY: spec("treasury"),
      OPERATOR_KEYS: JSON.stringify(operators),
    });
    console.log("apps/be/.env updated (RELAYER_KEY, TREASURY_KEY, OPERATOR_KEYS)");
  },
};

const [cmd, ...args] = process.argv.slice(2);
const run = commands[cmd ?? ""];
if (!run) {
  console.log("usage: owner accounts init|show|register | fund <from> <qor> <fusd> <name...> | convert <name> <fusd> | be-env | business create <slug>|all | lend <slug> <fusd> | windows");
  process.exit(1);
}
run(args).catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
