import type { SealKeyPair, SealRecipient } from "@qorechain/qoreseal";
import { envelopeHash, ORDER_STATUS, type RelayRequest } from "@qredit/qore";
import type { ServiceModule, SupplierData, Verdict } from "../services/types.ts";
import type { SupplierRole } from "../setup/businesses.ts";
import type { Api } from "./api.ts";
import type { createOperator, createVaultReader } from "./chain.ts";
import { factsOnlyProse, type Prose } from "./grounding.ts";
import type { Llm } from "./llm.ts";
import { planOrder, spendableToday } from "./policy.ts";
import { openRequest, sealReport, type RequestBody } from "./seal.ts";
import { SupplierRefused, type SuppliersClient } from "./suppliers-client.ts";
import { DECLINE, type DeclineCode, type Order, type Plan, type Prices } from "./types.ts";

export type BusinessRuntime = {
  slug: string; vault: string; spenderQor: string; service: ServiceModule; servicePrices: bigint[];
  sealKeys: SealKeyPair; supplierAddress: Record<SupplierRole, string>;
};
export type PipelineDeps = {
  api: Pick<Api, "envelope" | "putReport" | "decision" | "relay">;
  signer: { payRequest(vault: string, supplier: string, amount: bigint, orderId: bigint): Promise<RelayRequest> };
  operator: ReturnType<typeof createOperator>;
  vaults: ReturnType<typeof createVaultReader>;
  suppliers: SuppliersClient;
  llm: Llm;
  prices: Prices;
  resolveBuyer(buyer0x: string): Promise<SealRecipient | null>;
  /** Sum of SupplierPaid amounts on chain for this order and supplier address (catches payments the supplier has not reported yet). */
  paidOnChain(vault: string, orderId: string, supplier: string): Promise<bigint>;
  chainId: string;
  log(line: string): void;
  /** Unix seconds; defaults to the wall clock. */
  now?: () => number;
};
export type Outcome = { status: "delivered" | "declined" | "already-closed" | "failed"; code?: DeclineCode; tx?: string; reason?: string };

type OkPlan = Extract<Plan, { ok: true }>;

const EXPIRY_MARGIN_S = 60;
const defaultNow = () => Math.floor(Date.now() / 1000);

/** The only texts that reach the public decision log. Error details go to deps.log. */
const REASON = {
  expired: "expired",
  unreadable: "request unreadable",
  outOfScope: "out of scope",
  noKey: "no ML-KEM key for buyer",
  supplierRefused: "supplier refused payment",
  retry: "temporary failure; will retry",
  noFunds: "operating funds or daily cap too low",
  delivered: "delivered",
} as const;
const CODE_REASON: Record<DeclineCode, string> = {
  1: REASON.outOfScope, 2: "would lose money", 3: REASON.noFunds, 4: REASON.noKey, 5: REASON.unreadable, 6: REASON.supplierRefused,
};

/** A definitive refusal: closes the order on chain with `code`. */
class Decline extends Error {
  constructor(readonly code: DeclineCode, readonly reason: string = CODE_REASON[code]) {
    super(reason);
  }
}
/** A temporary fault: the order stays open so a later run can finish it. */
class Retry extends Error {
  constructor(message: string, public step?: string) {
    super(message);
  }
}

/** What one run learns: which suppliers are paid (catalog amount) and what they returned. */
type Run = {
  order: Order; biz: BusinessRuntime; deps: PipelineDeps;
  paid: Map<SupplierRole, bigint>; data: SupplierData; query: Record<string, string>;
};

const priceOf = (r: Run, role: SupplierRole) => r.deps.prices[role];
const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));
const allRoles = (r: Run) => [...r.biz.service.suppliers.required, ...r.biz.service.suppliers.choice];

/** Decline for definitive refusals, Retry for everything else. */
function classify(e: unknown): Decline | Retry {
  if (e instanceof Decline || e instanceof Retry) return e;
  if (e instanceof SupplierRefused) return new Decline(DECLINE.supplierFailed);
  return new Retry(detail(e));
}

/** Runs one pipeline step; a temporary fault is tagged with `step` (for deps.log only, never for public reasons). */
async function attempt<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = classify(e);
    if (err instanceof Retry) err.step ??= step;
    throw err;
  }
}

const where = (e: unknown) => (e instanceof Retry && e.step ? `[${e.step}] ` : "");

/**
 * Pays one supplier through the relayer and waits for its data. Only "refused" and "execution_failed" are definitive
 * declines; "not_broadcast" and "unconfirmed" leave the payment's fate unknown, so the order is retried and the next
 * run's chain probe sees whether it landed.
 */
async function buy(r: Run, role: SupplierRole): Promise<void> {
  if (r.paid.has(role)) return;
  const { order, biz, deps } = r;
  await attempt("relay", async () => {
    const req = await deps.signer.payRequest(order.vault, biz.supplierAddress[role], priceOf(r, role), BigInt(order.orderId));
    const res = await deps.api.relay(req);
    if (!res.success) {
      if (res.code === "refused" || res.code === "execution_failed") throw new Decline(DECLINE.supplierFailed, REASON.supplierRefused);
      throw new Retry(`relay ${res.code}: ${res.reason}`);
    }
    r.paid.set(role, priceOf(r, role));
  });
  r.data[role] = await attempt("supplier", () => deps.suppliers.waitFor(role, order.vault, order.orderId, r.query));
}

function openOrder(order: Order, biz: BusinessRuntime, deps: PipelineDeps, text: string | null): RequestBody {
  if (text === null) throw new Decline(DECLINE.unreadable);
  try {
    return openRequest({ text, requestRef: order.requestRef, vault: order.vault, keys: biz.sealKeys, chainId: deps.chainId });
  } catch {
    throw new Decline(DECLINE.unreadable);
  }
}

function parseRequest(order: Order, biz: BusinessRuntime, request: RequestBody): { query: Record<string, string>; subject: string } {
  if (request.serviceId !== order.serviceId) throw new Decline(DECLINE.outOfScope);
  const parsed = biz.service.parseInput(request.input);
  if (!parsed.ok) throw new Decline(DECLINE.outOfScope);
  return { query: parsed.query, subject: parsed.subject };
}

const onChain = (r: Run, role: SupplierRole) => r.deps.paidOnChain(r.order.vault, r.order.orderId, r.biz.supplierAddress[role]);

/**
 * A role is paid when its supplier serves data, or when the chain shows a payment of at least the catalog price
 * (then the supplier is only waited for, never paid again; paySupplier has no per-order uniqueness).
 */
async function probePaid(r: Run): Promise<void> {
  const { order, deps } = r;
  for (const role of allRoles(r)) {
    const data = await attempt("supplier", () => deps.suppliers.get(role, order.vault, order.orderId, r.query));
    if (data !== null) {
      r.data[role] = data;
      r.paid.set(role, priceOf(r, role));
    } else if ((await attempt("chain-probe", () => onChain(r, role))) >= priceOf(r, role)) {
      r.paid.set(role, priceOf(r, role));
      r.data[role] = await attempt("supplier", () => deps.suppliers.waitFor(role, order.vault, order.orderId, r.query));
    }
  }
}

/** Cost already on chain, for decisions posted before the request is opened. Best effort. */
async function probeChainCost(r: Run): Promise<void> {
  for (const role of allRoles(r)) {
    try {
      if ((await onChain(r, role)) >= priceOf(r, role)) r.paid.set(role, priceOf(r, role));
    } catch (e) {
      r.deps.log(`chain probe failed: ${detail(e)}`);
    }
  }
}

async function supplierCaps(r: Run): Promise<Partial<Record<SupplierRole, bigint>>> {
  const caps: Partial<Record<SupplierRole, bigint>> = {};
  for (const role of allRoles(r)) caps[role] = await r.deps.vaults.supplierCap(r.order.vault, r.biz.supplierAddress[role]);
  return caps;
}

async function planFor(r: Run): Promise<OkPlan> {
  const { order, biz, deps } = r;
  const funds = await deps.vaults.funds(order.vault);
  const plan = planOrder({ price: BigInt(order.price), supplierPlan: biz.service.suppliers, prices: deps.prices, caps: await supplierCaps(r), funds });
  if (!plan.ok) {
    deps.log(`order ${order.orderId} plan declined (${plan.code}): ${plan.reason}`);
    throw new Decline(plan.code);
  }
  return plan;
}

/** The tool callbacks: serialized, only allowed roles, one distinct choice role, no payment after a decline, no decline after a payment. */
function planTools(r: Run, plan: OkPlan) {
  const bought = () => plan.affordableChoice.find((x) => r.paid.has(x));
  const state: { declined: DeclineCode | null; failure: Decline | Retry | null } = { declined: null, failure: null };
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn);
    chain = p.then(() => undefined, () => undefined);
    return p;
  };
  const inflight = new Map<SupplierRole, Promise<string>>();
  const payNow = async (role: SupplierRole): Promise<string> => {
    if (state.declined !== null) return "refused: the order was declined";
    if (state.failure) return "refused: a payment failed; stop";
    if (!plan.affordableChoice.includes(role)) return `refused: ${role} is not an allowed supplier for this order`;
    const have = bought();
    if (have && have !== role) return `refused: ${have} was already bought; only one supplier per order`;
    if (have) return `${role} is already paid; finish the order`;
    try {
      await buy(r, role);
      return `paid ${role}; finish the order`;
    } catch (e) {
      state.failure = classify(e);
      r.deps.log(`pay ${role} failed: ${where(state.failure)}${detail(e)}`);
      return "failed: payment did not complete; stop";
    }
  };
  const pay = (role: SupplierRole): Promise<string> => {
    const known = inflight.get(role);
    if (known) return known;
    const p = serial(() => payNow(role));
    inflight.set(role, p);
    return p;
  };
  const decline = (code: DeclineCode): Promise<string> =>
    serial(async () => {
      if (bought() || state.failure) return "refused: a supplier was already paid for this order; finish the order";
      state.declined = code;
      return "order declined";
    });
  return { pay, decline, state, bought, settle: () => chain };
}

/** Lets the model pick the compute tier; falls back to the cheapest affordable choice when it does not. */
async function chooseCompute(r: Run, plan: OkPlan, request: string): Promise<void> {
  const { pay, decline, state, bought, settle } = planTools(r, plan);
  const prices = Object.fromEntries(plan.affordableChoice.map((x) => [x, priceOf(r, x).toString()]));
  try {
    await r.deps.llm.plan({
      skill: r.biz.service.skill, request, required: plan.required, allowed: plan.affordableChoice, prices,
      budgetUnits: plan.budget.toString(), pay, decline,
    });
  } catch (e) {
    r.deps.log(`llm.plan failed: ${detail(e)}`);
  }
  await settle(); // a tool call may still be running if plan() gave up early
  if (state.failure) throw state.failure;
  if (state.declined !== null && !bought()) throw new Decline(state.declined);
  if (!bought()) await pay(plan.affordableChoice[0]!); // same mutex, memo and one-role rule as the model's calls
  if (state.failure) throw state.failure;
}

/** Money is already committed: finish the order without re-checking margin or funds against the post-payment balance. */
async function resume(r: Run): Promise<void> {
  const { service } = r.biz;
  for (const role of service.suppliers.required) await buy(r, role);
  if (service.suppliers.choice.length === 0 || service.suppliers.choice.some((c) => r.paid.has(c))) return;
  const [caps, funds] = [await supplierCaps(r), await r.deps.vaults.funds(r.order.vault)];
  const limit = funds.opex < spendableToday(funds) ? funds.opex : spendableToday(funds);
  const usable = service.suppliers.choice
    .filter((c) => (caps[c] ?? 0n) > 0n && priceOf(r, c) <= caps[c]! && priceOf(r, c) <= limit)
    .sort((a, b) => (priceOf(r, a) < priceOf(r, b) ? -1 : priceOf(r, a) > priceOf(r, b) ? 1 : 0));
  if (usable.length === 0) throw new Decline(DECLINE.noFunds);
  await buy(r, usable[0]!);
}

async function writeProse(r: Run, facts: Record<string, unknown>, verdict: Verdict, findings: string[]): Promise<{ prose: Prose; model: string | null }> {
  const { service } = r.biz;
  const w = await r.deps.llm.write({ skill: service.skill, facts, verdict, codeFindings: findings, deep: r.paid.has("computeDeep"), labels: service.labels });
  return w ? { prose: w.prose, model: w.model } : { prose: factsOnlyProse(verdict, findings), model: null };
}

const suppliersField = (r: Run) => [...r.paid].map(([role, amount]) => ({ role, amount: amount.toString() }));

/** Facts are only computed on data that really arrived for every paid role. */
function requireData(r: Run): void {
  for (const role of r.paid.keys()) if (r.data[role] === undefined) throw new Retry(`data missing for paid supplier ${role}`);
  for (const role of r.biz.service.suppliers.required) if (r.data[role] === undefined) throw new Retry(`data missing for ${role}`);
}

async function sealAndStore(r: Run, buyer: SealRecipient, report: Record<string, unknown>): Promise<string> {
  const { order, deps } = r;
  const text = await attempt("seal", async () => sealReport({ report, vault: order.vault, orderId: order.orderId, recipient: buyer, chainId: deps.chainId }));
  const hash = await attempt("store", () => deps.api.putReport(text));
  if (hash.toLowerCase() !== envelopeHash(text).toLowerCase()) throw new Retry("stored report hash does not match the sealed report");
  return hash;
}

async function postDecision(r: Run, decision: "delivered" | "declined" | "failed", reason: string): Promise<void> {
  const cost = [...r.paid.values()].reduce((a, b) => a + b, 0n);
  try {
    await r.deps.api.decision({ vault: r.order.vault, orderId: r.order.orderId, decision, reason, suppliers: suppliersField(r), cost });
  } catch (e) {
    r.deps.log(`decision post failed: ${detail(e)}`);
  }
}

async function declineOrder(r: Run, d: Decline): Promise<Outcome> {
  const closed = await attempt("decline", () => r.deps.operator.decline(r.order.vault, BigInt(r.order.orderId), d.code));
  // An earlier run closed the order and already posted its decision.
  if (closed.alreadyClosed) return { status: "already-closed", code: d.code };
  await postDecision(r, "declined", d.reason);
  return { status: "declined", code: d.code, tx: closed.tx ?? undefined, reason: d.reason };
}

async function failOrder(r: Run, e: unknown, reason: string = REASON.retry): Promise<Outcome> {
  r.deps.log(`order ${r.order.orderId} failed: ${where(e)}${detail(e)}`);
  await postDecision(r, "failed", reason);
  return { status: "failed", reason };
}

async function deliverReport(r: Run, buyer: SealRecipient, subject: string): Promise<Outcome> {
  const { order, biz, deps } = r;
  requireData(r);
  const facts = biz.service.facts(r.query, r.data);
  const verdict = biz.service.verdict(facts);
  const codeFindings = biz.service.findings(facts);
  const { prose, model } = await writeProse(r, facts, verdict, codeFindings);
  const hash = await sealAndStore(r, buyer, {
    v: 1, business: biz.slug, vault: order.vault, orderId: order.orderId, serviceId: order.serviceId, subject, verdict, facts,
    findings: codeFindings, summary: prose.summary, notes: prose.findings,
    ...(biz.service.notice ? { notice: biz.service.notice } : {}),
    generatedBy: model ?? "facts-only", suppliers: suppliersField(r),
    createdAt: new Date((deps.now ?? defaultNow)() * 1000).toISOString(),
  });
  const closed = await attempt("deliver", () => deps.operator.deliver(order.vault, BigInt(order.orderId), hash as `0x${string}`));
  if (closed.alreadyClosed) return { status: "already-closed" };
  await postDecision(r, "delivered", REASON.delivered);
  return { status: "delivered", tx: closed.tx ?? undefined };
}

async function serve(r: Run): Promise<Outcome> {
  const { order, biz, deps } = r;
  const request = openOrder(order, biz, deps, await deps.api.envelope(order.requestRef));
  const { query, subject } = parseRequest(order, biz, request);
  r.query = query;
  const buyer = await deps.resolveBuyer(order.buyer);
  if (!buyer) throw new Decline(DECLINE.noRecipientKey);
  await probePaid(r);
  if (r.paid.size > 0) {
    await resume(r);
  } else {
    const plan = await planFor(r);
    for (const role of plan.required) await buy(r, role);
    if (biz.service.suppliers.choice.length > 0) await chooseCompute(r, plan, request.input);
  }
  return deliverReport(r, buyer, subject);
}

/**
 * The order as the vault holds it, or null when it is no longer open. The backend copy only says which order to serve;
 * buyer, service, price, request and deadline come from the chain, so a wrong copy can never redirect a report (L3).
 */
export async function readChainOrder(claimed: Order, deps: Pick<PipelineDeps, "vaults">): Promise<Order | null> {
  const c = await deps.vaults.order(claimed.vault, BigInt(claimed.orderId));
  if (c.status !== ORDER_STATUS.Open) return null;
  return {
    ...claimed, buyer: c.buyer.toLowerCase(), serviceId: c.serviceId, price: c.price.toString(),
    requestRef: c.requestRef.toLowerCase(), deadline: c.deadline,
  };
}

export const orderDiffers = (a: Order, b: Order): boolean =>
  a.buyer.toLowerCase() !== b.buyer.toLowerCase() || a.serviceId !== b.serviceId || a.price !== b.price
  || a.requestRef.toLowerCase() !== b.requestRef.toLowerCase() || a.deadline !== b.deadline;

/**
 * Serves one order. Callers must not retry a `failed` order sooner than the backend's stale-claim window (15 min),
 * so a submitted-but-unconfirmed payment has time to land; the runner relies on the backend claim queue for that.
 */
export async function handleOrder(claimed: Order, biz: BusinessRuntime, deps: PipelineDeps): Promise<Outcome> {
  let order: Order;
  try {
    const onChain = await readChainOrder(claimed, deps);
    if (onChain === null) return { status: "already-closed" };
    if (orderDiffers(claimed, onChain)) deps.log(`order ${claimed.orderId}: the backend copy differs from the vault; the vault's is used`);
    order = onChain;
  } catch (e) {
    return failOrder({ order: claimed, biz, deps, paid: new Map(), data: {}, query: {} }, new Retry(detail(e), "chain-order"));
  }
  const r: Run = { order, biz, deps, paid: new Map(), data: {}, query: {} };
  if ((deps.now ?? defaultNow)() >= order.deadline - EXPIRY_MARGIN_S) {
    await probeChainCost(r);
    return failOrder(r, "order expired", REASON.expired);
  }
  try {
    return await serve(r);
  } catch (e) {
    const err = e instanceof Decline ? e : classify(e);
    if (!(err instanceof Decline)) return failOrder(r, err);
    try {
      return await declineOrder(r, err);
    } catch (inner) {
      return failOrder(r, inner);
    }
  }
}
