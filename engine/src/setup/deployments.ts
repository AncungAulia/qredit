import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Deployment = {
  slug: string; vault: string; startBlock: number; createTx: string;
  spender: string; operator: string; agentPubkey: string; linkTx: string; windowTx: string;
};
const DEFAULT = join(import.meta.dir, "..", "..", "deployments.json");
const V1 = join(import.meta.dir, "..", "..", "deployments.v1.json");

export const readDeployments = (path = DEFAULT): Record<string, Deployment> =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, Deployment>) : {};

export function writeDeployment(d: Deployment, path = DEFAULT): void {
  const all = { ...readDeployments(path), [d.slug]: d };
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** The v1 vaults (kept on chain, no longer served); `deployments.json` holds the v2 vaults. */
export const readDeploymentsV1 = (path = V1): Record<string, Deployment> => readDeployments(path);
