import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { AgentConfig } from "../config.ts";
import type { SupplierRole } from "../setup/businesses.ts";
import type { Verdict } from "../services/types.ts";
import { checkGrounding, type Prose } from "./grounding.ts";
import * as prompts from "./prompts.ts";
import type { DeclineCode } from "./types.ts";

export type PlanInput = {
  skill: string;
  request: string;
  required: SupplierRole[];
  allowed: SupplierRole[];
  /** Catalog price per allowed role (units), shown to the model; never taken from it. */
  prices?: Partial<Record<SupplierRole, string>>;
  budgetUnits: string;
  pay: (role: SupplierRole) => Promise<string>;
  decline: (code: DeclineCode, reason: string) => Promise<string>;
};
export type WriteInput = { skill: string; facts: Record<string, unknown>; verdict: Verdict; codeFindings: string[]; deep: boolean; labels?: readonly string[] };

export interface Llm {
  /** The model can only call pay_supplier with roles in `allowed` and decline_order with the given codes. */
  plan(o: PlanInput): Promise<{ model: string | null }>;
  /** `null` = unavailable or ungrounded; the caller then uses `factsOnlyProse`. */
  write(o: WriteInput): Promise<{ prose: Prose; model: string } | null>;
}

const TIMEOUT_MS = 30_000;
const proseSchema = z.object({ summary: z.string().max(700), findings: z.array(z.string().max(240)).max(8) });

export function createOpenRouterLlm(cfg: AgentConfig): Llm {
  const openrouter = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: cfg.OPENROUTER_API_KEY.trim(),
    supportsStructuredOutputs: true,
  });
  const model = openrouter.chatModel(cfg.AGENT_MODELS[0]!);
  const providerOptions = (effort: string) => ({
    openrouter: {
      models: cfg.AGENT_MODELS,
      reasoning: { effort, exclude: true },
      provider: { require_parameters: true, data_collection: "deny" },
    },
  });
  const log = (msg: string) => console.log(`[llm] ${msg}`);

  return {
    async plan(o) {
      const t0 = performance.now();
      try {
        const tools = {
          pay_supplier: createTool({
            id: "pay_supplier",
            description: "Pay one allowed supplier from the vault for this order. Call at most once.",
            inputSchema: z.object({ supplier: z.enum(o.allowed as [SupplierRole, ...SupplierRole[]]) }),
            outputSchema: z.object({ result: z.string() }),
            execute: async ({ supplier }) => ({ result: await o.pay(supplier) }),
          }),
          decline_order: createTool({
            id: "decline_order",
            description: "Decline the order. Code 1: out of scope or bad input. 2: would lose money. 3: funds too low.",
            inputSchema: z.object({ code: z.enum(["1", "2", "3"]), reason: z.string().max(200) }),
            outputSchema: z.object({ result: z.string() }),
            execute: async ({ code, reason }) => ({ result: await o.decline(Number(code) as DeclineCode, reason) }),
          }),
        };
        const agent = new Agent({ id: "qredit-planner", name: "qredit-planner", instructions: prompts.SYSTEM_PROMPT, model, tools });
        const choice = o.allowed.map((role) => ({ role, priceUnits: o.prices?.[role] ?? "?" }));
        const res = await agent.generate(prompts.planPrompt({ skill: o.skill, request: o.request, required: o.required, choice, budgetUnits: o.budgetUnits }), {
          maxSteps: 4,
          providerOptions: providerOptions(cfg.AGENT_EFFORT),
          modelSettings: { temperature: 0 },
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const answered = res.response?.modelId ?? null;
        log(`plan model=${answered ?? "n/a"} ms=${Math.round(performance.now() - t0)}`);
        return { model: answered };
      } catch (e) {
        log(`plan failed after ${Math.round(performance.now() - t0)} ms: ${e instanceof Error ? e.name : "error"}`);
        return { model: null };
      }
    },

    async write(o) {
      const t0 = performance.now();
      try {
        const agent = new Agent({ id: "qredit-writer", name: "qredit-writer", instructions: prompts.SYSTEM_PROMPT, model });
        const res = await agent.generate(prompts.writePrompt(o), {
          structuredOutput: { schema: proseSchema },
          activeTools: [],
          providerOptions: providerOptions(o.deep ? cfg.AGENT_EFFORT_DEEP : cfg.AGENT_EFFORT),
          modelSettings: { temperature: 0 },
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const prose = proseSchema.parse(res.object);
        const answered = res.response?.modelId ?? cfg.AGENT_MODELS[0]!;
        const g = checkGrounding(prose, o.facts, o.verdict, o.labels);
        log(`write model=${answered} ms=${Math.round(performance.now() - t0)} grounding=${g.ok ? "ok" : g.reason}`);
        return g.ok ? { prose, model: answered } : null;
      } catch (e) {
        log(`write failed after ${Math.round(performance.now() - t0)} ms: ${e instanceof Error ? e.name : "error"}`);
        return null;
      }
    },
  };
}
