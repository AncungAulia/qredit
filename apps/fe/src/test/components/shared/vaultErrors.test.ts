import { encodeErrorResult } from "viem";
import { expect, test } from "vitest";
import { LOAN_VAULT_ABI } from "@qredit/qore";
import { ERC20_ERROR_SENTENCES, ERC20_ERRORS_ABI, revertSentence, VAULT_ERROR_SENTENCES } from "@/components/shared/vaultErrors";
import live from "@/test/fixtures/live-reverts.json";

const errorNames = LOAN_VAULT_ABI.filter((i) => i.type === "error").map((i) => i.name);

test("the ABI has errors to cover", () => {
  expect(errorNames.length).toBeGreaterThan(20);
});

test.each(errorNames)("%s has a sentence", (name) => {
  const sentence = VAULT_ERROR_SENTENCES[name];
  expect(sentence).toBeTruthy();
  expect(sentence).toMatch(/\.$/);
});

test("the map holds no name that the ABI lacks", () => {
  for (const key of Object.keys(VAULT_ERROR_SENTENCES)) expect(errorNames).toContain(key);
});

test("WideningLocked reads as the spec sentence", () => {
  expect(VAULT_ERROR_SENTENCES.WideningLocked).toBe("The vault refuses to widen its rules until the loan is repaid.");
});

test("revertSentence decodes raw revert data found on the error chain", () => {
  const data = encodeErrorResult({ abi: LOAN_VAULT_ABI, errorName: "WideningLocked" } as never);
  const err = Object.assign(new Error("execution reverted"), { cause: { data } });
  expect(revertSentence(err)).toBe(VAULT_ERROR_SENTENCES.WideningLocked);
});

test("revertSentence maps ERC-20 balance and allowance failures as the last resort", () => {
  expect(revertSentence(new Error("ERC20: transfer amount exceeds balance"))).toMatch(/balance/i);
  expect(revertSentence(new Error("ERC20: insufficient allowance"))).toMatch(/allowance/i);
});

const erc20Names = ERC20_ERRORS_ABI.filter((i) => i.type === "error").map((i) => i.name);
test.each(["ERC20InsufficientBalance", "ERC20InsufficientAllowance", "ERC20InvalidSender", "ERC20InvalidReceiver", "ERC20InvalidApprover", "ERC20InvalidSpender"])(
  "%s is decoded and has a sentence",
  (name) => {
    expect(erc20Names).toContain(name);
    expect(ERC20_ERROR_SENTENCES[name]).toMatch(/\.$/);
  },
);

test("an Error(string) revert with a known text maps to its sentence, an unknown text to the generic one", () => {
  const known = encodeErrorResult({ abi: [{ type: "error", name: "Error", inputs: [{ name: "m", type: "string" }] }], errorName: "Error", args: ["ERC20: insufficient allowance"] });
  expect(revertSentence({ data: known })).toMatch(/allowance/i);
  const unknown = encodeErrorResult({ abi: [{ type: "error", name: "Error", inputs: [{ name: "m", type: "string" }] }], errorName: "Error", args: ["secret internal text"] });
  expect(revertSentence({ data: unknown })).toBe("The transaction was refused.");
});

// Raw errors captured read-only from the testnet node (publicClient.call, no transaction, no gas).
function liveError(key: "vaultDeposit" | "fusdTransfer" | "fusdTransferFrom"): Error {
  const chain = live[key].chain;
  let cause: unknown;
  for (const link of [...chain].reverse()) cause = Object.assign(new Error(link.message), link, { cause });
  return cause as Error;
}

test("live: deposit on a vault that is not raising decodes to WrongState", () => {
  expect(revertSentence(liveError("vaultDeposit"))).toBe(VAULT_ERROR_SENTENCES.WrongState);
});

test("live: fUSD transfer from an empty address decodes to ERC20InsufficientBalance", () => {
  expect(revertSentence(liveError("fusdTransfer"))).toBe(ERC20_ERROR_SENTENCES.ERC20InsufficientBalance);
});

test("live: fUSD transferFrom without allowance decodes to ERC20InsufficientAllowance", () => {
  expect(revertSentence(liveError("fusdTransferFrom"))).toBe(ERC20_ERROR_SENTENCES.ERC20InsufficientAllowance);
});

test("an unknown failure gives the generic sentence", () => {
  expect(revertSentence(new Error("boom"))).toBe("The transaction was refused.");
  expect(revertSentence("weird")).toBe("The transaction was refused.");
});
