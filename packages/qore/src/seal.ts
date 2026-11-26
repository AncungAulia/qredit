import {
  envelopeFromText, envelopeToText, isQoreSealError, open, seal, type SealKeyPair, type SealRecipient,
} from "@qorechain/qoreseal";
import { resolveRecipient } from "@qorechain/qoreseal/network";
import { z } from "zod";
import { hexToQor } from "./address.ts";

import { MAX_INPUT, REPORT_PURPOSE, REQUEST_PURPOSE, ReportUnreadable } from "./seal-shared.ts";

export { MAX_INPUT, REPORT_PURPOSE, REQUEST_PURPOSE, ReportUnreadable };

export const requestSchema = z.object({ v: z.literal(1), serviceId: z.number().int().nonnegative(), input: z.string().min(1).max(MAX_INPUT) }).strict();
export type RequestBody = z.infer<typeof requestSchema>;

const utf8 = (s: string) => new TextEncoder().encode(s);
const lower = (a: string) => a.toLowerCase();
const modeOf = (r: SealRecipient) => (r.x25519PublicKey ? "hybrid" : "mlkem");

/** Seals a request to the business spender; the aad is the lowercase vault address. */
export function sealRequest(o: { body: RequestBody; vault: string; recipient: SealRecipient; chainId: string }): string {
  const bytes = seal({ chainId: o.chainId, purpose: REQUEST_PURPOSE, recipients: [o.recipient], plaintext: utf8(JSON.stringify(o.body)), aad: utf8(lower(o.vault)), mode: modeOf(o.recipient) });
  return envelopeToText(bytes);
}

/** Opens a delivered report with the buyer's keys; the aad is `${vault}:${orderId}`. Throws ReportUnreadable when it does not open or is not JSON. */
export function openReport(o: { text: string; vault: string; orderId: string; keys: SealKeyPair; chainId: string }): unknown {
  let plain: Uint8Array;
  try {
    plain = open({ chainId: o.chainId, purpose: REPORT_PURPOSE, envelope: envelopeFromText(o.text), keys: o.keys, aad: utf8(`${lower(o.vault)}:${o.orderId}`) });
  } catch {
    throw new ReportUnreadable("the report cannot be opened with these keys");
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new ReportUnreadable("the report is not JSON");
  }
}

type Card = NonNullable<Parameters<typeof resolveRecipient>[0]["card"]>;

/**
 * Builds the sealing recipient for an 0x address: hybrid with the uploaded card when there is one, else ML-KEM alone.
 * Returns null when the chain has no ML-KEM key for it; any other failure (network, registry) is rethrown so callers can retry.
 */
export function createRecipientResolver(o: { rest: string; chainId: string; card: (qor: string) => Promise<unknown | null> }) {
  return async (address0x: string): Promise<SealRecipient | null> => {
    const address = hexToQor(address0x.toLowerCase());
    const raw = await o.card(address);
    // The backend stores the card as JSON text; accept an object too.
    const card = (typeof raw === "string" ? JSON.parse(raw) : raw) as Card | null;
    try {
      return await resolveRecipient({ rest: o.rest, chainId: o.chainId, address, card: card ?? undefined, mode: card ? "hybrid" : "mlkem" });
    } catch (e) {
      if (isQoreSealError(e, "KEM_KEY_NOT_REGISTERED")) return null;
      throw e;
    }
  };
}
