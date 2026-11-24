import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPqcStatus } from "@qorechain/sdk";
import { TESTNET } from "@qredit/qore";
import { loadEngineConfig } from "../config.ts";
import { keystore } from "../keystore.ts";
import { accountNames, ensureAccounts, loadAccount } from "../setup/accounts.ts";
import { loadBusinesses } from "../setup/businesses.ts";
import { convertFusd, registerKey, sendQor } from "../setup/chain.ts";

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
