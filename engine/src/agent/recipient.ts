import { isQoreSealError, type SealRecipient } from "@qorechain/qoreseal";
import { resolveRecipient } from "@qorechain/qoreseal/network";
import { hexToQor } from "@qredit/qore";

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
