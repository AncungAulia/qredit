import { ERC20_ABI, FUSD_ADDRESS, FUSD_DENOM } from "@qredit/qore";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import { fetchPqcStatus, type UnifiedAccount } from "@qorechain/sdk";
import { api, ApiError, parseResponse } from "@/lib/apiClient";
import { publicClient, restUrl } from "@/lib/chain";
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

/** True when the backend holds a recipient card for the address. */
export async function hasCard(qor: string): Promise<boolean> {
  try {
    const res = await api.get<unknown>(`/v1/cards/${qor}`);
    return cardResponseSchema.safeParse(res.data).success;
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
export async function readWalletStatus(acc: UnifiedAccount): Promise<WalletChainStatus> {
  const [balances, pqc, kem, card, fusd] = await Promise.all([
    bankBalances(acc.cosmos),
    fetchPqcStatus({ rest: restUrl(), address: acc.cosmos }),
    fetchKemKey({ rest: restUrl(), address: acc.cosmos }),
    hasCard(acc.cosmos),
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
    kemRegistered: kem.registered,
    cardPublished: card,
  };
}

/** Asks the faucet for test funds. A rate limit gives the time the address may ask again; any other refusal throws. */
export async function claimFaucet(address: string): Promise<{ tx: string } | { retryAt: Date }> {
  const res = await api.post<unknown>("/v1/faucet", { address }, { validateStatus: (s) => s === 200 || s === 429 });
  if (res.status === 429) return { retryAt: parseResponse(faucetLimitedSchema, res.data).retryAt };
  return { tx: parseResponse(faucetOkSchema, res.data).tx };
}
