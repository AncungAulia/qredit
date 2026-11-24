import type { Queryable } from "../client.ts";
import { lc } from "./lc.ts";

export interface Decision {
  vault: string;
  orderId: string | null;
  decision: "accepted" | "declined" | "delivered" | "failed";
  reason: string;
  suppliers: unknown[];
  cost: string;
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
