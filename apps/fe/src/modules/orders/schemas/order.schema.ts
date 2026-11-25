import { z } from "zod";
import { MAX_INPUT, qorToHex } from "@qredit/qore";

/** The most addresses one sanctions screen takes (the agent refuses more). */
export const MAX_ADDRESSES = 20;

export const ADDRESS_ERROR = "This is not a valid address. Enter one that starts with qor1 or 0x.";

type InputRule = {
  kind: "one" | "many" | "text";
  label: string;
  help: string;
  placeholder: string;
  /** The counterparty check pre-fills the buyer's own address ("check your own address"). */
  prefillOwn: boolean;
};

// What each hosted agent accepts as input (engine/src/services/input.ts): one address, or up to twenty for the screen.
const RULES: Record<string, InputRule> = {
  "counterparty-check": {
    kind: "one",
    label: "Address to check",
    help: "A QoreChain address that starts with qor1 or 0x. Only the agent can read it.",
    placeholder: "qor1…",
    prefillOwn: true,
  },
  "sanctions-screen": {
    kind: "many",
    label: "Addresses to screen",
    help: `Up to ${MAX_ADDRESSES} addresses, separated by commas, spaces or new lines. Only the agent can read them.`,
    placeholder: "qor1…\n0x…",
    prefillOwn: false,
  },
  "due-diligence": {
    kind: "one",
    label: "Token or contract address",
    help: "The address of the token or contract to review. Only the agent can read it.",
    placeholder: "0x…",
    prefillOwn: false,
  },
  "contract-auditor": {
    kind: "one",
    label: "Contract address",
    help: "The address of the contract to audit. Only the agent can read it.",
    placeholder: "0x…",
    prefillOwn: false,
  },
};

const FALLBACK: InputRule = {
  kind: "text",
  label: "Your request",
  help: `Up to ${MAX_INPUT.toLocaleString("en-US")} characters. Only the agent can read it.`,
  placeholder: "",
  prefillOwn: false,
};

/** The input rule of a business, by its slug. A business this app does not know takes free text. */
export const inputRuleFor = (slug: string): InputRule => RULES[slug] ?? FALLBACK;

const tokens = (text: string) => text.split(/[\s,]+/).filter(Boolean);
const isAddress = (t: string) => /^0x[0-9a-fA-F]{40}$/.test(t) || (/^qor1/.test(t) && qorToHex(t) !== null);

/** The text that is sealed: addresses trimmed and one per line; free text trimmed. */
export function orderInput(slug: string, text: string): string {
  const rule = inputRuleFor(slug);
  return rule.kind === "text" ? text.trim() : tokens(text).join("\n");
}

/** The input of one order, checked the way the agent of that business will check it, so a refusal never costs a payment. */
export const orderInputSchema = (slug: string) =>
  z.string().superRefine((text, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const rule = inputRuleFor(slug);
    if (text.length > MAX_INPUT) return issue(`Enter at most ${MAX_INPUT.toLocaleString("en-US")} characters.`);
    if (rule.kind === "text") {
      if (text.trim() === "") issue("Enter your request.");
      return;
    }
    const list = tokens(text);
    if (list.length === 0) return issue(rule.kind === "one" ? "Enter an address." : "Enter at least one address.");
    if (rule.kind === "one" && list.length > 1) return issue("Enter exactly one address.");
    if (!list.every(isAddress)) return issue(ADDRESS_ERROR);
    if (list.length > MAX_ADDRESSES) issue(`Enter at most ${MAX_ADDRESSES} addresses.`);
  });

export const orderFormSchema = (slug: string) => z.object({ input: orderInputSchema(slug) });
export type OrderValues = { input: string };
