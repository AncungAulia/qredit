import { ERC20_ABI, FUSD_ADDRESS, FUSD_DENOM } from "@qredit/qore/abi";
import type { RecipientCard, SealKeyPair } from "@qorechain/qoreseal";
import type { UnifiedAccount } from "@qorechain/sdk";
import { api, ApiError, parseResponse } from "@/lib/apiClient";
import { publicClient, restUrl } from "@/lib/chain";
import { env } from "@/lib/env";
import {
  balancesSchema,
  cardResponseSchema,
  faucetLimitedSchema,
  faucetOkSchema,
  type WalletChainStatus,
} from "@/modules/wallet/schemas/wallet.schema";

async function bankBalances(qor: string): Promise<Map<string, bigint>> {
  const res = await fetch(`${restUrl()}/cosmos/bank/v1beta1/balances/${qor}`, { signal: AbortSignal.timeout(20_000) });
  // A fresh account is unknown to some nodes; its balances are then empty rather than an error.
  if (res.status === 404) return new Map();
  if (!res.ok) throw new ApiError("server", res.status);
  const body = parseResponse(balancesSchema, await res.json());
  return new Map(body.balances.map((b) => [b.denom.toLowerCase(), BigInt(b.amount)]));
}

/** The bank (not yet converted) fUSD balance of an address, read fresh. */
export async function readBankFusd(qor: string): Promise<bigint> {
  return (await bankBalances(qor)).get(FUSD_DENOM.toLowerCase()) ?? 0n;
}

const cardObject = (raw: unknown): Partial<RecipientCard> | null => {
  try {
    const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value !== null && typeof value === "object" ? (value as Partial<RecipientCard>) : null;
  } catch {
    return null;
  }
};

/** True when the backend holds a card for the address, and, when keys are given, the card is for exactly those keys. */
export async function hasCard(qor: string, keys?: SealKeyPair): Promise<boolean> {
  try {
    const res = await api.get<unknown>(`/v1/cards/${qor}`);
    const parsed = cardResponseSchema.safeParse(res.data);
    if (!parsed.success) return false;
    if (!keys) return true;
    const card = cardObject((parsed.data as { card: unknown }).card);
    if (!card) return false;
    // The seal and key code is large; it loads here, when a wallet is checked, not with the page.
    const { recipientCardFields } = await import("@qorechain/qoreseal");
    const want = recipientCardFields({ chainId: env.chainId, address: qor, keys });
    return card.mlkemKeySha3 === want.mlkemKeySha3 && card.x25519PublicKey === want.x25519PublicKey;
  } catch (e) {
    if (e instanceof ApiError && e.kind === "notFound") return false;
    throw e;
  }
}

/** Stores the signed recipient card. The backend checks it against the keys registered on chain. */
export async function putCard(qor: string, card: unknown): Promise<void> {
  await api.put(`/v1/cards/${qor}`, { card });
}

/** Everything the setup steps need to know about the wallet, read from the chain and the backend. */
export async function readWalletStatus(acc: UnifiedAccount, sealKeys: SealKeyPair): Promise<WalletChainStatus> {
  const [{ fetchPqcStatus }, { fetchKemKey }, { toHex }] = await Promise.all([
    import("@qorechain/sdk"),
    import("@qorechain/qoreseal/network"),
    import("@qorechain/qoreseal"),
  ]);
  const [balances, pqc, kem, card, fusd] = await Promise.all([
    bankBalances(acc.cosmos),
    fetchPqcStatus({ rest: restUrl(), address: acc.cosmos }),
    fetchKemKey({ rest: restUrl(), address: acc.cosmos }),
    hasCard(acc.cosmos, sealKeys),
    publicClient.readContract({
      address: FUSD_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [acc.evm as `0x${string}`],
    }) as Promise<bigint>,
  ]);
  return {
    qor: balances.get("uqor") ?? 0n,
    fusdBank: balances.get(FUSD_DENOM.toLowerCase()) ?? 0n,
    fusd,
    pqcRegistered: pqc.registered,
    kemRegistered: kem.registered && !!kem.publicKey && toHex(kem.publicKey) === toHex(sealKeys.mlkemPublicKey),
    cardPublished: card,
  };
}

/** Asks the faucet for test funds. A rate limit gives the time the address may ask again; any other refusal throws. */
export async function claimFaucet(address: string): Promise<{ tx: string } | { retryAt: Date }> {
  const res = await api.post<unknown>("/v1/faucet", { address }, { validateStatus: (s) => s === 200 || s === 429 });
  if (res.status === 429) return { retryAt: parseResponse(faucetLimitedSchema, res.data).retryAt };
  return { tx: parseResponse(faucetOkSchema, res.data).tx };
}
