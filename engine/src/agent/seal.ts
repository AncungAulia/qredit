import { envelopeFromText, envelopeToText, open, seal, sealKeysFromSeed, type SealKeyPair, type SealRecipient } from "@qorechain/qoreseal";
import { envelopeHash } from "@qredit/qore";
import { z } from "zod";
import type { Keystore } from "../keystore.ts";

export const REQUEST_PURPOSE = "qredit/request/v1";
export const REPORT_PURPOSE = "qredit/report/v1";
export const MAX_INPUT = 2000;

const requestSchema = z.object({ v: z.literal(1), serviceId: z.number().int().nonnegative(), input: z.string().min(1).max(MAX_INPUT) }).strict();
export type RequestBody = z.infer<typeof requestSchema>;

export class RequestUnreadable extends Error {}

const utf8 = (s: string) => new TextEncoder().encode(s);
const lower = (a: string) => a.toLowerCase();
const modeOf = (r: SealRecipient) => (r.x25519PublicKey ? "hybrid" : "mlkem");

export function loadSealKeys(ks: Keystore, slug: string): SealKeyPair {
  const seed = ks.read(`${slug}-seal`).seed;
  if (!/^[0-9a-f]{64}$/.test(seed ?? "")) throw new Error(`${slug}-seal has no valid seed`);
  return sealKeysFromSeed(Uint8Array.from(Buffer.from(seed!, "hex")));
}

export function sealRequest(o: { body: RequestBody; vault: string; recipient: SealRecipient; chainId: string }): string {
  const bytes = seal({ chainId: o.chainId, purpose: REQUEST_PURPOSE, recipients: [o.recipient], plaintext: utf8(JSON.stringify(o.body)), aad: utf8(lower(o.vault)), mode: modeOf(o.recipient) });
  return envelopeToText(bytes);
}

export function openRequest(o: { text: string; requestRef: string; vault: string; keys: SealKeyPair; chainId: string }): RequestBody {
  if (lower(envelopeHash(o.text)) !== lower(o.requestRef)) throw new RequestUnreadable("the envelope does not match the order's requestRef");
  let plain: Uint8Array;
  try {
    plain = open({ chainId: o.chainId, purpose: REQUEST_PURPOSE, envelope: envelopeFromText(o.text), keys: o.keys, aad: utf8(lower(o.vault)) });
  } catch {
    throw new RequestUnreadable("the envelope cannot be opened with this agent's keys");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new RequestUnreadable("the request is not JSON");
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) throw new RequestUnreadable("the request does not match { v: 1, serviceId, input }");
  return parsed.data;
}

export function sealReport(o: { report: unknown; vault: string; orderId: string; recipient: SealRecipient; chainId: string }): string {
  const bytes = seal({ chainId: o.chainId, purpose: REPORT_PURPOSE, recipients: [o.recipient], plaintext: utf8(JSON.stringify(o.report)), aad: utf8(`${lower(o.vault)}:${o.orderId}`), mode: modeOf(o.recipient) });
  return envelopeToText(bytes);
}
