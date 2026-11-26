import type { VaultVersion } from "@qredit/qore";
import type { Queryable } from "../client.ts";
import { lc } from "./lc.ts";

export type Ended = "defaulted" | "closed";

export interface Business {
  slug: string;
  vault: string;
  name: string;
  tagline: string;
  services: unknown;
  operator: string;
  spender: string;
  startBlock: number;
  /** The LoanVault build of the vault; v1 vaults stay listed for old orders and positions only. */
  version: VaultVersion;
  /** Set by the watcher from LoanEnded; null while the loan runs. */
  ended: Ended | null;
}

export type BusinessInput = Omit<Business, "version" | "ended"> & { version?: VaultVersion };

export async function upsertBusiness(db: Queryable, b: BusinessInput): Promise<void> {
  await db.query(
    `insert into qredit.businesses (slug, vault, name, tagline, services, operator, spender, start_block, version)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     on conflict (vault) do update set slug = excluded.slug, name = excluded.name, tagline = excluded.tagline,
       services = excluded.services, operator = excluded.operator, spender = excluded.spender,
       start_block = excluded.start_block`,
    [b.slug, lc(b.vault), b.name, b.tagline, JSON.stringify(b.services), lc(b.operator), lc(b.spender), b.startBlock, b.version ?? 1],
  );
}

type BusinessRow = {
  slug: string; vault: string; name: string; tagline: string; services: unknown; operator: string; spender: string;
  start_block: string | number; version: string | number; ended: Ended | null;
};
const toBusiness = (r: BusinessRow): Business => ({
  slug: r.slug, vault: r.vault, name: r.name, tagline: r.tagline, services: r.services,
  operator: r.operator, spender: r.spender, startBlock: Number(r.start_block),
  version: Number(r.version) === 2 ? 2 : 1, ended: r.ended,
});

export async function listBusinesses(db: Queryable): Promise<Business[]> {
  return (await db.query<BusinessRow>("select * from qredit.businesses order by created_at, slug, version")).map(toBusiness);
}

/** The newest vault of a slug: the business page shows the v2 vault once it exists. */
export async function getBusiness(db: Queryable, slug: string): Promise<Business | null> {
  const [r] = await db.query<BusinessRow>("select * from qredit.businesses where slug = $1 order by version desc limit 1", [slug]);
  return r ? toBusiness(r) : null;
}

/** Records the end of a loan once; a later LoanEnded for the same vault changes nothing. */
export async function setBusinessEnded(db: Queryable, vault: string, ended: Ended): Promise<boolean> {
  const rows = await db.query("update qredit.businesses set ended = $2 where vault = $1 and ended is null returning 1", [lc(vault), ended]);
  return rows.length > 0;
}

/** Follows a RotateAgent order, so the relayer and the window keeper use the new keys. */
export async function setBusinessAgents(db: Queryable, vault: string, spender: string, operator: string): Promise<boolean> {
  const rows = await db.query(
    "update qredit.businesses set spender = $2, operator = $3 where vault = $1 returning 1",
    [lc(vault), lc(spender), lc(operator)],
  );
  return rows.length > 0;
}
