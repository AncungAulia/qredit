import { encodeErrorResult } from "viem";
import { expect, test } from "vitest";
import { LOAN_VAULT_ABI } from "@qredit/qore";
import { revertSentence, VAULT_ERROR_SENTENCES } from "@/components/shared/vaultErrors";

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

test("revertSentence maps ERC-20 balance and allowance failures", () => {
  expect(revertSentence(new Error("ERC20: transfer amount exceeds balance"))).toMatch(/balance/i);
  expect(revertSentence(new Error("ERC20: insufficient allowance"))).toMatch(/allowance/i);
});

test("an unknown failure gives the generic sentence", () => {
  expect(revertSentence(new Error("boom"))).toBe("The transaction was refused.");
  expect(revertSentence("weird")).toBe("The transaction was refused.");
});
