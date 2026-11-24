import type { Queryable } from "./db.ts";
import { envelopeHash } from "./hash.ts";

export type EnvelopeKind = "request" | "report" | "sample";

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

export interface Order {
  vault: string;
  orderId: string;
  buyer: string;
  serviceId: number;
  price: string;
  requestRef: string;
  deadline: number;
  status: "open" | "claimed" | "delivered" | "declined" | "reclaimed";
  placedTx: string;
  placedBlock: number;
  envelopeHash: string | null;
}

export interface Decision {
  vault: string;
  orderId: string | null;
  decision: "accepted" | "declined" | "delivered" | "failed";
  reason: string;
  suppliers: unknown[];
  cost: string;
}

type Base = { vault: string; orderId: string; block: number; logIndex: number; tx: string };
export type VaultEvent =
  | (Base & { kind: "OrderPlaced"; buyer: string; serviceId: number; price: string; requestRef: string; deadline: number })
  | (Base & { kind: "Delivered"; envelopeHash: string })
  | (Base & { kind: "Declined" | "Reclaimed" });

const lc = (s: string) => s.toLowerCase();

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

export async function putEnvelope(db: Queryable, kind: EnvelopeKind, body: string): Promise<string> {
  const hash = envelopeHash(body);
  await db.query(
    "insert into qredit.envelopes (hash, kind, body, size) values ($1, $2, $3, $4) on conflict (hash) do nothing",
    [hash, kind, body, new TextEncoder().encode(body).length],
  );
  return hash;
}

export async function getEnvelope(db: Queryable, hash: string): Promise<{ kind: EnvelopeKind; body: string } | null> {
  const [r] = await db.query<{ kind: EnvelopeKind; body: string }>("select kind, body from qredit.envelopes where hash = $1", [lc(hash)]);
  return r ?? null;
}

export async function putCard(db: Queryable, address: string, card: unknown): Promise<void> {
  await db.query(
    "insert into qredit.cards (address, card) values ($1, $2::jsonb) on conflict (address) do update set card = excluded.card, updated_at = now()",
    [lc(address), JSON.stringify(card)],
  );
}

export async function getCard(db: Queryable, address: string): Promise<unknown | null> {
  const [r] = await db.query<{ card: unknown }>("select card from qredit.cards where address = $1", [lc(address)]);
  return r?.card ?? null;
}

export async function addDecision(db: Queryable, d: Decision): Promise<number> {
  const [r] = await db.query<{ id: string | number }>(
    "insert into qredit.decisions (vault, order_id, decision, reason, suppliers, cost) values ($1, $2, $3, $4, $5::jsonb, $6) returning id",
    [lc(d.vault), d.orderId, d.decision, d.reason, JSON.stringify(d.suppliers), d.cost],
  );
  return Number(r.id);
}

export async function listDecisions(db: Queryable, vault: string, limit: number): Promise<(Decision & { id: number; createdAt: string })[]> {
  const rows = await db.query<{ id: string | number; vault: string; order_id: string | null; decision: Decision["decision"]; reason: string; suppliers: unknown[]; cost: string; created_at: Date }>(
    "select * from qredit.decisions where vault = $1 order by id desc limit $2",
    [lc(vault), limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), vault: r.vault, orderId: r.order_id, decision: r.decision, reason: r.reason,
    suppliers: r.suppliers, cost: r.cost, createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** Apply one vault event idempotently. Returns true when a row was inserted or updated, false when the event was a duplicate or did not fit the order's state. */
export async function applyVaultEvent(db: Queryable, e: VaultEvent): Promise<boolean> {
  if (e.kind === "OrderPlaced") {
    const rows = await db.query(
      `insert into qredit.orders (vault, order_id, buyer, service_id, price, request_ref, deadline, status, placed_tx, placed_block)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9) on conflict (vault, order_id) do nothing returning 1`,
      [lc(e.vault), e.orderId, lc(e.buyer), e.serviceId, e.price, lc(e.requestRef), e.deadline, lc(e.tx), e.block],
    );
    return rows.length > 0;
  }
  const status = e.kind === "Delivered" ? "delivered" : e.kind === "Declined" ? "declined" : "reclaimed";
  const hash = e.kind === "Delivered" ? lc(e.envelopeHash) : null;
  // Only an open or claimed order can be closed; a late or replayed event never rewrites a closed one.
  const rows = await db.query(
    `update qredit.orders set status = $3, envelope_hash = coalesce($4, envelope_hash), closed_tx = $5, updated_at = now()
     where vault = $1 and order_id = $2 and status in ('open', 'claimed') returning 1`,
    [lc(e.vault), e.orderId, status, hash, lc(e.tx)],
  );
  return rows.length > 0;
}

export async function getWatchState(db: Queryable, vault: string): Promise<number | null> {
  const [r] = await db.query<{ last_block: string | number }>("select last_block from qredit.watcher_state where vault = $1", [lc(vault)]);
  return r ? Number(r.last_block) : null;
}

export async function setWatchState(db: Queryable, vault: string, block: number): Promise<void> {
  await db.query(
    "insert into qredit.watcher_state (vault, last_block) values ($1, $2) on conflict (vault) do update set last_block = excluded.last_block",
    [lc(vault), block],
  );
}

type OrderRow = { vault: string; order_id: string; buyer: string; service_id: number; price: string; request_ref: string; deadline: string | number; status: Order["status"]; placed_tx: string; placed_block: string | number; envelope_hash: string | null };
const toOrder = (r: OrderRow): Order => ({
  vault: r.vault, orderId: r.order_id, buyer: r.buyer, serviceId: Number(r.service_id), price: r.price,
  requestRef: r.request_ref, deadline: Number(r.deadline), status: r.status, placedTx: r.placed_tx,
  placedBlock: Number(r.placed_block), envelopeHash: r.envelope_hash,
});

/**
 * Atomically claim the oldest open order (or one whose claim is older than staleAfterSeconds) among the given vaults.
 * A takeover of a stale claim can only repeat off-chain work: the vault refuses a second delivery (OrderNotOpen).
 */
export async function claimNextOrder(db: Queryable, vaults: string[], staleAfterSeconds = 900): Promise<Order | null> {
  if (vaults.length === 0) return null;
  const [r] = await db.query<OrderRow>(
    `update qredit.orders set status = 'claimed', claimed_at = now(), updated_at = now()
     where (vault, order_id) = (
       select vault, order_id from qredit.orders
       where vault = any(string_to_array($1, ','))
         and (status = 'open' or (status = 'claimed' and claimed_at < now() - make_interval(secs => $2)))
       order by placed_block, order_id::numeric
       limit 1
       for update skip locked)
     returning *`,
    // Joined text: addresses contain no commas, and this behaves the same in postgres.js and PGlite.
    [vaults.map(lc).join(","), staleAfterSeconds],
  );
  return r ? toOrder(r) : null;
}

export async function listOrders(db: Queryable, vault: string, status?: Order["status"]): Promise<Order[]> {
  const rows = status
    ? await db.query<OrderRow>("select * from qredit.orders where vault = $1 and status = $2 order by placed_block desc limit 100", [lc(vault), status])
    : await db.query<OrderRow>("select * from qredit.orders where vault = $1 order by placed_block desc limit 100", [lc(vault)]);
  return rows.map(toOrder);
}

export async function lastGrant(db: Queryable, address: string, ipHash: string): Promise<Date | null> {
  const [r] = await db.query<{ at: Date | null }>(
    "select max(created_at) as at from qredit.faucet_grants where address = $1 or ip_hash = $2",
    [lc(address), ipHash],
  );
  return r?.at ? new Date(r.at) : null;
}

/** Reserve a faucet slot atomically. Call inside db.transaction. */
export async function reserveGrant(
  q: Queryable,
  address: string,
  ipHash: string,
  cooldownHours: number,
  now: Date,
): Promise<{ ok: true; id: number } | { ok: false; retryAt: Date }> {
  await q.query("select pg_advisory_xact_lock(hashtext('qredit.faucet'))");
  const last = await lastGrant(q, address, ipHash);
  if (last) {
    const retryAt = new Date(last.getTime() + cooldownHours * 3_600_000);
    if (retryAt > now) return { ok: false, retryAt };
  }
  const [r] = await q.query<{ id: string | number }>(
    "insert into qredit.faucet_grants (address, ip_hash, tx, created_at) values ($1, $2, 'pending', $3) returning id",
    [lc(address), ipHash, now.toISOString()],
  );
  return { ok: true, id: Number(r.id) };
}

export async function completeGrant(q: Queryable, id: number, tx: string): Promise<void> {
  await q.query("update qredit.faucet_grants set tx = $2 where id = $1", [id, tx]);
}

export async function cancelGrant(q: Queryable, id: number): Promise<void> {
  await q.query("delete from qredit.faucet_grants where id = $1", [id]);
}
