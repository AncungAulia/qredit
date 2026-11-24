import type { Queryable } from "../client.ts";
import { envelopeHash } from "../../lib/hash.ts";
import { lc } from "./lc.ts";

export type EnvelopeKind = "request" | "report" | "sample";

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
