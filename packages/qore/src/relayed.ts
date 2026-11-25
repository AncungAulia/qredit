import { base64, hex } from "@scure/base";
import { decodeFunctionData, type Hex } from "viem";
import { VAULT_ABI } from "./abi.ts";
import { EXECUTE_EVM_TYPE_URL } from "./relay-types.ts";

export type RelayedPayment = { txHash: string; height: number; supplier: string; amount: bigint; orderId: bigint };


const EXECUTION_FAILED = "abstractaccount_execution_failed";
const PAGE_SIZE = 50;
const TIMEOUT_MS = 15_000;

type TxResponse = { txhash: string; height: string; code: number; events?: { type: string }[] };
type Tx = { body: { messages: { "@type"?: string; to?: string; data?: string }[] } };
type Page = { txs?: Tx[]; tx_responses?: TxResponse[]; total?: string | number; pagination?: { total?: string | number } | null };

/** A safety net, not a limit: reaching it means the reader is not making progress, so it throws. */
const MAX_PAGES = 200;

function decodePay(data: string): { supplier: string; amount: bigint; orderId: bigint } | null {
  try {
    const d = decodeFunctionData({ abi: VAULT_ABI, data: `0x${hex.encode(base64.decode(data))}` as Hex });
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
 * Reads every page (newest first) until the reported total is read or a whole page is older than `minHeight`.
 * Any HTTP or parse error throws: a partial list would let a payment be paid twice.
 */
export async function relayedPayments(o: {
  rest: string; relayer: string; vault: string; orderId?: bigint; supplier?: string; fetch?: typeof fetch;
  /** Skip history older than this height (the vault's start block). */
  minHeight?: number; maxPages?: number;
}): Promise<RelayedPayment[]> {
  const doFetch = o.fetch ?? fetch;
  const vault = o.vault.toLowerCase();
  const query = encodeURIComponent(`message.action='${EXECUTE_EVM_TYPE_URL}' AND message.sender='${o.relayer}'`);
  const out: RelayedPayment[] = [];
  const maxPages = o.maxPages ?? MAX_PAGES;
  let seen = 0;
  for (let page = 1; ; page++) {
    if (page > maxPages) throw new Error(`tx search did not end within ${maxPages} pages`);
    // The node reads `limit` and `page` (not `pagination.limit`) and reports the total as `total`.
    const res = await doFetch(`${o.rest}/cosmos/tx/v1beta1/txs?query=${query}&limit=${PAGE_SIZE}&page=${page}&order_by=ORDER_BY_DESC`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`tx search failed: HTTP ${res.status} (page ${page})`);
    const body = (await res.json()) as Page;
    const txs = body.txs ?? [];
    const responses = body.tx_responses ?? [];
    if (responses.length !== txs.length) throw new Error("tx search returned mismatched txs and tx_responses");
    txs.forEach((tx, i) => {
      const r = responses[i]!;
      if ((o.minHeight !== undefined && Number(r.height) < o.minHeight) || r.code !== 0 || r.events?.some((e) => e.type === EXECUTION_FAILED)) return;
      const m = tx.body.messages[0];
      if (!m || m["@type"] !== EXECUTE_EVM_TYPE_URL || m.to?.toLowerCase() !== vault || !m.data) return;
      const pay = decodePay(m.data);
      if (pay) out.push({ txHash: r.txhash, height: Number(r.height), ...pay });
    });
    seen += txs.length;
    const total = Number(body.total ?? body.pagination?.total);
    const done = Number.isFinite(total) ? seen >= total : txs.length < PAGE_SIZE;
    const allOld = o.minHeight !== undefined && txs.length > 0 && responses.every((r) => Number(r.height) < o.minHeight!);
    if (txs.length === 0 || done || allOld) break;
  }
  const supplier = o.supplier?.toLowerCase();
  return out.filter((p) => (o.orderId === undefined || p.orderId === o.orderId) && (supplier === undefined || p.supplier === supplier));
}
