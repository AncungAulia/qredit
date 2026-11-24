import type { Queryable } from "../../db.ts";
import { lc } from "./lc.ts";

export interface Business {
  slug: string;
  vault: string;
  name: string;
  tagline: string;
  services: unknown;
  operator: string;
  spender: string;
  startBlock: number;
}

export async function upsertBusiness(db: Queryable, b: Business): Promise<void> {
  await db.query(
    `insert into qredit.businesses (slug, vault, name, tagline, services, operator, spender, start_block)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     on conflict (slug) do update set vault = excluded.vault, name = excluded.name, tagline = excluded.tagline,
       services = excluded.services, operator = excluded.operator, spender = excluded.spender, start_block = excluded.start_block`,
    [b.slug, lc(b.vault), b.name, b.tagline, JSON.stringify(b.services), lc(b.operator), lc(b.spender), b.startBlock],
  );
}

type BusinessRow = { slug: string; vault: string; name: string; tagline: string; services: unknown; operator: string; spender: string; start_block: string | number };
const toBusiness = (r: BusinessRow): Business => ({
  slug: r.slug, vault: r.vault, name: r.name, tagline: r.tagline, services: r.services,
  operator: r.operator, spender: r.spender, startBlock: Number(r.start_block),
});

export async function listBusinesses(db: Queryable): Promise<Business[]> {
  return (await db.query<BusinessRow>("select * from qredit.businesses order by created_at, slug")).map(toBusiness);
}

export async function getBusiness(db: Queryable, slug: string): Promise<Business | null> {
  const [r] = await db.query<BusinessRow>("select * from qredit.businesses where slug = $1", [slug]);
  return r ? toBusiness(r) : null;
}
