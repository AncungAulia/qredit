import { decodeFunctionData, type Hex } from "viem";
import { VAULT_ABI } from "./abi.ts";

export type RelayedPayment = { txHash: string; height: number; supplier: string; amount: bigint; orderId: bigint };

const EXECUTE_EVM = "/qorechain.abstractaccount.v1.MsgExecuteEVM";
const EXECUTION_FAILED = "abstractaccount_execution_failed";
const PAGE_SIZE = 50;
const TIMEOUT_MS = 15_000;

type TxResponse = { txhash: string; height: string; code: number; events?: { type: string }[] };
type Tx = { body: { messages: { "@type"?: string; to?: string; data?: string }[] } };
type Page = { txs?: Tx[]; tx_responses?: TxResponse[] };

function decodePay(data: string): { supplier: string; amount: bigint; orderId: bigint } | null {
  try {
    const d = decodeFunctionData({ abi: VAULT_ABI, data: `0x${Buffer.from(data, "base64").toString("hex")}` as Hex });
    if (d.functionName !== "paySupplier") return null;
    const [supplier, amount, orderId] = d.args as readonly [string, bigint, bigint];
    return { supplier: supplier.toLowerCase(), amount, orderId };
  } catch {
    return null;
  }
}

/**
 * paySupplier payments the relayer forwarded for a vault, read from the chain's tx index. Executions through an abstract
 * account emit no EVM logs, so the SupplierPaid event cannot see them. Failed or refused executions are skipped.
 */
export async function relayedPayments(o: {
  rest: string; relayer: string; vault: string; orderId?: bigint; supplier?: string; fetch?: typeof fetch; maxPages?: number;
}): Promise<RelayedPayment[]> {
  const doFetch = o.fetch ?? fetch;
  const vault = o.vault.toLowerCase();
  const query = encodeURIComponent(`message.action='${EXECUTE_EVM}' AND message.sender='${o.relayer}'`);
  const out: RelayedPayment[] = [];
  for (let page = 1; page <= (o.maxPages ?? 20); page++) {
    const res = await doFetch(
      `${o.rest}/cosmos/tx/v1beta1/txs?query=${query}&pagination.limit=${PAGE_SIZE}&page=${page}&order_by=ORDER_BY_DESC`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) {
      if (page > 1) break; // the node answers an error past the last page
      throw new Error(`tx search failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as Page;
    const txs = body.txs ?? [];
    txs.forEach((tx, i) => {
      const r = body.tx_responses?.[i];
      if (!r || r.code !== 0 || r.events?.some((e) => e.type === EXECUTION_FAILED)) return;
      const m = tx.body.messages[0];
      if (!m || m["@type"] !== EXECUTE_EVM || m.to?.toLowerCase() !== vault || !m.data) return;
      const pay = decodePay(m.data);
      if (pay) out.push({ txHash: r.txhash, height: Number(r.height), ...pay });
    });
    if (txs.length < PAGE_SIZE) break;
  }
  const supplier = o.supplier?.toLowerCase();
  return out.filter((p) => (o.orderId === undefined || p.orderId === o.orderId) && (supplier === undefined || p.supplier === supplier));
}
