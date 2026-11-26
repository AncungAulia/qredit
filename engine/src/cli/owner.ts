import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPqcStatus } from "@qorechain/sdk";
import { FACTORY_ADDRESS, FUSD_ADDRESS, TESTNET } from "@qredit/qore";
import { keysDir, loadEngineConfig } from "../config.ts";
import { keystore } from "../keystore.ts";
import { accountNames, agentKey, ensureAccounts, fundedFirst, loadAccount, SUPPLIER_ACCOUNTS } from "../setup/accounts.ts";
import { loadSealKeys } from "../agent/seal.ts";
import { loadBusinesses, vaultInit } from "../setup/businesses.ts";
import { agentLinkIsLive, convertFusd, createVault, ensureWindow, findExistingVault, lend, linkAgent, openWindow, registerBusiness, registerKey, sendQor, TREASURY_WINDOW } from "../setup/chain.ts";
import { ensureSealSeed, publishCard, registerSealKey } from "../setup/seal.ts";
import { readDeployments, readDeploymentsV1, writeDeployment } from "../setup/deployments.ts";
import { RUNTIME_KEY_FIELDS, SUPPLIERS_PATH } from "../runtime-keys.ts";
import { upsertEnv } from "../setup/env.ts";
import { initDemoBuyer, placeDemoOrder, readDemoReport } from "../setup/demo-buyer.ts";

const ks = keystore(keysDir());
const businesses = loadBusinesses();
const names = accountNames(businesses);
const keyed = (n: string) => !n.endsWith("-agent");
const units = (fusd: string) => BigInt(Math.round(Number(fusd) * 1e6));
const uqor = (qor: string) => BigInt(Math.round(Number(qor) * 1e6));

async function balances(address: string): Promise<{ qor: number; fusd: number }> {
  const r = await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`);
  const b = r.ok ? ((await r.json()) as { balances: { denom: string; amount: string }[] }).balances : [];
  return {
    qor: Number(b.find((x) => x.denom === "uqor")?.amount ?? 0) / 1e6,
    fusd: Number(b.find((x) => x.denom.startsWith("erc20:0x97143"))?.amount ?? 0) / 1e6,
  };
}
const balance = async (address: string): Promise<string> => {
  const { qor, fusd } = await balances(address);
  return `${qor} QOR, ${fusd} bank fUSD`;
};

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
      const accounts = await Promise.all(names.filter(keyed).map(async (n) => ({ n, acc: await loadAccount(ks, n) })));
      const funded = new Set<string>();
      for (const { n, acc } of accounts) if ((await balances(acc.cosmos)).qor > 0) funded.add(n);
      let failed = 0;
      for (const { n, acc } of fundedFirst(accounts, (x) => funded.has(x.n))) {
        try {
          const tx = await registerKey(acc);
          console.log(`${n}: ${tx ?? "already registered"}`);
        } catch (e) {
          failed++;
          console.error(`${n}: FAILED (${(e as Error).message})`);
        }
      }
      if (failed) throw new Error(`${failed} account(s) failed to register`);
    } else throw new Error("usage: accounts init|show|register");
  },
  async "fund"([from, qor, fusd, ...to]) {
    if (!from || qor === undefined || fusd === undefined || to.length === 0) throw new Error("usage: fund <from> <qor> <fusd> <name...>");
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
    console.log("treasury window:", await openWindow(treasury, [FACTORY_ADDRESS, FUSD_ADDRESS, ...vaults], TREASURY_WINDOW));
  },
  async "business"([sub, which]) {
    if (sub !== "create" || !which) throw new Error("usage: business create <slug>|all");
    const cfg = loadEngineConfig();
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
        const spenderHex = spender.evm.toLowerCase();
        const ownerPq = cfg.OWNER_ADDRESS.toLowerCase();
        const base = { slug: b.slug, spender: spenderHex, operator: operator.evm.toLowerCase(), agentPubkey: Buffer.from(agent.publicKey).toString("hex"), linkTx: "", windowTx: "" };
        const existing = await findExistingVault(ownerPq, spenderHex);
        let v;
        if (existing) {
          v = existing;
          console.log(`${b.slug}: found existing vault ${v.vault} (block ${v.startBlock}); not creating another`);
        } else {
          const known = Object.values(readDeployments()).map((x) => x.vault);
          const w = await ensureWindow(treasury, [FACTORY_ADDRESS, FUSD_ADDRESS, ...known], TREASURY_WINDOW);
          if (w) console.log(`${b.slug}: treasury window ${w}`);
          const init = vaultInit(b, { spender: spenderHex as `0x${string}`, operator: base.operator as `0x${string}`, ownerPq: ownerPq as `0x${string}`, suppliers }, Math.floor(Date.now() / 1000));
          v = await createVault(treasury, init);
          if (v.approveTx) console.log(`${b.slug}: bond approval ${v.approveTx}`);
        }
        d = { ...base, vault: v.vault, startBlock: v.startBlock, createTx: v.tx };
        writeDeployment(d);
        console.log(`${b.slug}: vault ${d.vault} (block ${d.startBlock})`);
      }
      if (!d.linkTx) {
        d = { ...d, linkTx: await linkAgent(spender, agent, d.vault, Boolean(readDeploymentsV1()[b.slug]?.linkTx) && await agentLinkIsLive(spender.cosmos, agent.publicKey)) };
        writeDeployment(d);
        console.log(`${b.slug}: agent key linked ${d.linkTx}`);
      }
      const opened = await ensureWindow(operator, [d.vault]);
      if (opened) {
        d = { ...d, windowTx: opened };
        writeDeployment(d);
        console.log(`${b.slug}: operator window ${opened}`);
      }
      await registerBusiness(cfg.API_URL, cfg.ENGINE_TOKEN, {
        slug: b.slug, vault: d.vault, name: b.name, tagline: b.tagline, services: b.services,
        operator: d.operator, spender: d.spender, startBlock: d.startBlock, version: 2,
      });
      console.log(`${b.slug}: registered with the API`);
    }
  },
  async "lend"([slug, fusd]) {
    const d = readDeployments()[slug];
    if (!d) throw new Error(`no deployment for ${slug}; run business create first`);
    const known = Object.values(readDeployments()).map((x) => x.vault);
    const r = await lend(await loadAccount(ks, "treasury"), d.vault, units(fusd), known);
    if (r.skipped) console.log(`${slug}: ${r.skipped}`);
    else console.log(`${slug}: deposited ${r.amount} units (${r.approveTx ? `approve ${r.approveTx}, ` : "allowance sufficient, "}deposit ${r.depositTx})`);
  },
  async "seal-keys"([which]) {
    if (!which) throw new Error("usage: seal-keys <slug>|all");
    const targets = which === "all" ? businesses : businesses.filter((b) => b.slug === which);
    if (targets.length === 0) throw new Error(`unknown business "${which}"`);
    const cfg = loadEngineConfig();
    for (const b of targets) {
      const spender = await loadAccount(ks, `${b.slug}-spender`);
      ensureSealSeed(ks, b.slug);
      const keys = loadSealKeys(ks, b.slug);
      const tx = await registerSealKey(spender, keys.mlkemPublicKey);
      if (tx) await Bun.sleep(10_000);
      await publishCard(cfg.API_URL, spender, keys);
      console.log(`${b.slug}: ${spender.cosmos} seal key ${tx ?? "already registered"}, card uploaded`);
    }
  },
  async "demo-buyer"([sub]) {
    if (sub !== "init") throw new Error("usage: demo-buyer init");
    await initDemoBuyer(ks, loadEngineConfig().API_URL, (l) => console.log(l));
  },
  async "demo-order"([slug, input]) {
    const d = slug ? readDeployments()[slug] : undefined;
    if (!d || !input) throw new Error('usage: demo-order <slug> "<input>"');
    const r = await placeDemoOrder(ks, loadEngineConfig().API_URL, { vault: d.vault, spender: d.spender, input }, (l) => console.log(l));
    console.log(`order id ${r.orderId}`);
  },
  async "demo-report"([slug, orderId]) {
    const d = slug ? readDeployments()[slug] : undefined;
    if (!d || !orderId) throw new Error("usage: demo-report <slug> <orderId>");
    console.log(JSON.stringify(await readDemoReport(ks, loadEngineConfig().API_URL, { vault: d.vault, orderId }), null, 2));
  },
  async "suppliers-json"() {
    const out = Object.fromEntries(
      await Promise.all(Object.entries(SUPPLIER_ACCOUNTS).map(async ([role, name]) => [role, (await loadAccount(ks, name)).evm.toLowerCase()])),
    );
    writeFileSync(SUPPLIERS_PATH, `${JSON.stringify(out, null, 2)}
`);
    console.log(`wrote ${SUPPLIERS_PATH} (public supplier addresses)`);
  },
  async "runtime-keys"([sub]) {
    if (sub !== "check") throw new Error("usage: runtime-keys check");
    for (const b of businesses) {
      const parts = Object.entries(RUNTIME_KEY_FIELDS).map(([kind, fields]) => {
        const name = `${b.slug}-${kind}`;
        const rec = ks.has(name) ? ks.read(name) : {};
        return `${name}: ${fields.map((f) => `${f} ${rec[f] ? "yes" : "MISSING"}`).join(", ")}`;
      });
      console.log(`${b.slug.padEnd(20)} ${parts.join(" | ")}`);
    }
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
  console.log("usage: owner accounts init|show|register | fund <from> <qor> <fusd> <name...> | convert <name> <fusd> | be-env | suppliers-json | runtime-keys check | business create <slug>|all | lend <slug> <fusd> | windows | seal-keys <slug>|all | demo-buyer init | demo-order <slug> <input> | demo-report <slug> <orderId>");
  process.exit(1);
}
run(args).catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
