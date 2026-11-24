import type { SealKeyPair, SealRecipient } from "@qorechain/qoreseal";
import { envelopeHash } from "@qredit/qore";
import type { ServiceModule, SupplierData, Verdict } from "../services/types.ts";
import type { SupplierRole } from "../setup/businesses.ts";
import type { Api, RelayRequest } from "./api.ts";
import type { createOperator, createVaultReader } from "./chain.ts";
import { factsOnlyProse, type Prose } from "./grounding.ts";
import type { Llm } from "./llm.ts";
import { planOrder } from "./policy.ts";
import { openRequest, sealReport, type RequestBody } from "./seal.ts";
import type { SuppliersClient } from "./suppliers-client.ts";
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
  chainId: string;
  log(line: string): void;
  /** Unix seconds; defaults to the wall clock. */
  now?: () => number;
};
export type Outcome = { status: "delivered" | "declined" | "already-closed" | "failed"; code?: DeclineCode; tx?: string; reason?: string };

type OkPlan = Extract<Plan, { ok: true }>;

const EXPIRY_MARGIN_S = 60;
const defaultNow = () => Math.floor(Date.now() / 1000);
const REASONS: Record<DeclineCode, string> = {
  1: "out of scope or bad input", 2: "would lose money", 3: "operating funds or daily cap too low",
  4: "buyer has no ML-KEM key on chain", 5: "request envelope missing or cannot be opened", 6: "a supplier failed",
};

/** A decline raised inside a step. The reason is public, so it never carries buyer text. */
class Decline extends Error {
  constructor(readonly code: DeclineCode, readonly detail?: string) {
    super(REASONS[code]);
  }
}

/** What one run learns: which suppliers were paid (and the catalog amount) and what they returned. */
type Run = {
  order: Order; biz: BusinessRuntime; deps: PipelineDeps;
  paid: Map<SupplierRole, bigint>; data: SupplierData; query: Record<string, string>;
};

const priceOf = (r: Run, role: SupplierRole) => r.deps.prices[role];
const errText = (e: unknown) => (e instanceof Error ? e.message.slice(0, 120) : "error");

/** Idempotent buy: data already served means an earlier run paid; otherwise pay through the relayer, then wait for data. */
async function buy(r: Run, role: SupplierRole): Promise<void> {
  if (r.paid.has(role)) return;
  const { order, biz, deps } = r;
  const existing = await deps.suppliers.get(role, order.vault, order.orderId, r.query);
  if (existing !== null) {
    r.data[role] = existing;
    r.paid.set(role, priceOf(r, role));
    return;
  }
  const req = await deps.signer.payRequest(order.vault, biz.supplierAddress[role], priceOf(r, role), BigInt(order.orderId));
  const res = await deps.api.relay(req);
  if (!res.success) throw new Decline(DECLINE.supplierFailed, res.code);
  r.paid.set(role, priceOf(r, role));
  r.data[role] = await deps.suppliers.waitFor(role, order.vault, order.orderId, r.query);
}

/** `buy` where any failure becomes decline 6. */
async function buyOrDecline(r: Run, role: SupplierRole): Promise<void> {
  try {
    await buy(r, role);
  } catch (e) {
    throw e instanceof Decline ? e : new Decline(DECLINE.supplierFailed, errText(e));
  }
}

function openOrder(order: Order, biz: BusinessRuntime, deps: PipelineDeps, text: string | null): RequestBody {
  if (text === null) throw new Decline(DECLINE.unreadable, "envelope missing");
  try {
    return openRequest({ text, requestRef: order.requestRef, vault: order.vault, keys: biz.sealKeys, chainId: deps.chainId });
  } catch {
    throw new Decline(DECLINE.unreadable, "envelope unreadable");
  }
}

function parseRequest(order: Order, biz: BusinessRuntime, request: RequestBody): { query: Record<string, string>; subject: string } {
  if (request.serviceId !== order.serviceId) throw new Decline(DECLINE.outOfScope, "service mismatch");
  const parsed = biz.service.parseInput(request.input);
  if (!parsed.ok) throw new Decline(DECLINE.outOfScope, "input rejected");
  return { query: parsed.query, subject: parsed.subject };
}

async function planFor(order: Order, biz: BusinessRuntime, deps: PipelineDeps): Promise<OkPlan> {
  const { required, choice } = biz.service.suppliers;
  const caps: Partial<Record<SupplierRole, bigint>> = {};
  for (const role of [...required, ...choice]) caps[role] = await deps.vaults.supplierCap(order.vault, biz.supplierAddress[role]);
  const funds = await deps.vaults.funds(order.vault);
  const plan = planOrder({ price: BigInt(order.price), supplierPlan: biz.service.suppliers, prices: deps.prices, caps, funds });
  if (!plan.ok) throw new Decline(plan.code, plan.reason);
  return plan;
}

/** A choice role paid in an earlier run (supplier already serves data), if any. */
async function adoptEarlierChoice(r: Run, plan: OkPlan): Promise<boolean> {
  for (const role of plan.affordableChoice) {
    const data = await r.deps.suppliers.get(role, r.order.vault, r.order.orderId, r.query);
    if (data !== null) {
      r.data[role] = data;
      r.paid.set(role, priceOf(r, role));
      return true;
    }
  }
  return false;
}

/** The tool callbacks the model gets: one distinct choice role per order, only allowed roles, no decline after payment. */
function planTools(r: Run, plan: OkPlan) {
  const bought = () => plan.affordableChoice.find((x) => r.paid.has(x));
  const state: { declined: DeclineCode | null } = { declined: null };
  const pay = async (role: SupplierRole): Promise<string> => {
    if (!plan.affordableChoice.includes(role)) return `refused: ${role} is not an allowed supplier for this order`;
    const have = bought();
    if (have && have !== role) return `refused: ${have} was already bought; only one supplier per order`;
    if (have) return `${role} is already paid; finish the order`;
    try {
      await buy(r, role);
      return `paid ${role}; finish the order`;
    } catch (e) {
      return `failed: ${e instanceof Decline ? e.detail : "supplier error"}`;
    }
  };
  const decline = async (code: DeclineCode): Promise<string> => {
    if (bought()) return "refused: a supplier was already paid for this order; finish the order";
    state.declined = code;
    return "order declined";
  };
  return { pay, decline, state, bought };
}

/** Lets the model pick the compute tier; falls back to the cheapest affordable choice when it does not. */
async function chooseCompute(r: Run, plan: OkPlan, request: string): Promise<void> {
  if (await adoptEarlierChoice(r, plan)) return;
  const { pay, decline, state, bought } = planTools(r, plan);
  const prices = Object.fromEntries(plan.affordableChoice.map((x) => [x, priceOf(r, x).toString()]));
  try {
    await r.deps.llm.plan({
      skill: r.biz.service.skill, request, required: plan.required, allowed: plan.affordableChoice, prices,
      budgetUnits: plan.budget.toString(), pay, decline,
    });
  } catch (e) {
    r.deps.log(`llm.plan failed: ${errText(e)}`);
  }
  if (state.declined !== null && !bought()) throw new Decline(state.declined, "declined by the planner");
  if (!bought()) await buyOrDecline(r, plan.affordableChoice[0]!);
}

async function writeProse(r: Run, facts: Record<string, unknown>, verdict: Verdict, findings: string[]): Promise<{ prose: Prose; model: string | null }> {
  const { service } = r.biz;
  const w = await r.deps.llm.write({ skill: service.skill, facts, verdict, codeFindings: findings, deep: r.paid.has("computeDeep"), labels: service.labels });
  return w ? { prose: w.prose, model: w.model } : { prose: factsOnlyProse(verdict, findings), model: null };
}

const suppliersField = (r: Run) => [...r.paid].map(([role, amount]) => ({ role, amount: amount.toString() }));

async function sealAndStore(r: Run, buyer: SealRecipient, report: Record<string, unknown>): Promise<string> {
  const { order, deps } = r;
  const text = sealReport({ report, vault: order.vault, orderId: order.orderId, recipient: buyer, chainId: deps.chainId });
  const hash = await deps.api.putReport(text);
  if (hash.toLowerCase() !== envelopeHash(text).toLowerCase()) throw new Error("stored report hash does not match the sealed report");
  return hash;
}

async function postDecision(r: Run, decision: "delivered" | "declined" | "failed", reason: string): Promise<void> {
  const cost = [...r.paid.values()].reduce((a, b) => a + b, 0n);
  try {
    await r.deps.api.decision({ vault: r.order.vault, orderId: r.order.orderId, decision, reason, suppliers: suppliersField(r), cost });
  } catch (e) {
    r.deps.log(`decision post failed: ${errText(e)}`);
  }
}

async function declineOrder(r: Run, d: Decline): Promise<Outcome> {
  const closed = await r.deps.operator.decline(r.order.vault, BigInt(r.order.orderId), d.code);
  const reason = d.detail ? `${d.message}: ${d.detail}` : d.message;
  await postDecision(r, "declined", reason);
  if (closed.alreadyClosed) return { status: "already-closed", code: d.code, reason };
  return { status: "declined", code: d.code, tx: closed.tx ?? undefined, reason };
}

async function failOrder(r: Run, e: unknown): Promise<Outcome> {
  const reason = errText(e);
  r.deps.log(`order ${r.order.orderId} failed: ${reason}`);
  await postDecision(r, "failed", reason);
  return { status: "failed", reason };
}

async function serve(r: Run): Promise<Outcome> {
  const { order, biz, deps } = r;
  const request = openOrder(order, biz, deps, await deps.api.envelope(order.requestRef));
  const { query, subject } = parseRequest(order, biz, request);
  r.query = query;
  const buyer = await deps.resolveBuyer(order.buyer);
  if (!buyer) throw new Decline(DECLINE.noRecipientKey, "buyer key missing");
  const plan = await planFor(order, biz, deps);
  for (const role of plan.required) await buyOrDecline(r, role);
  if (biz.service.suppliers.choice.length > 0) await chooseCompute(r, plan, request.input);
  const facts = biz.service.facts(query, r.data);
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
  const closed = await deps.operator.deliver(order.vault, BigInt(order.orderId), hash as `0x${string}`);
  await postDecision(r, "delivered", `delivered with verdict ${verdict.label}`);
  return closed.alreadyClosed ? { status: "already-closed" } : { status: "delivered", tx: closed.tx ?? undefined };
}

export async function handleOrder(order: Order, biz: BusinessRuntime, deps: PipelineDeps): Promise<Outcome> {
  const r: Run = { order, biz, deps, paid: new Map(), data: {}, query: {} };
  if ((deps.now ?? defaultNow)() >= order.deadline - EXPIRY_MARGIN_S) {
    await postDecision(r, "failed", "expired");
    return { status: "failed", reason: "expired" };
  }
  try {
    return await serve(r);
  } catch (e) {
    if (!(e instanceof Decline)) return failOrder(r, e);
    try {
      return await declineOrder(r, e);
    } catch (inner) {
      return failOrder(r, inner);
    }
  }
}
