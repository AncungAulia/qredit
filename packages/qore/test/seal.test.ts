import { describe, expect, test } from "bun:test";
import { envelopeToText, generateSealKeys, recipientOf, seal } from "@qorechain/qoreseal";
import { createRecipientResolver, openReport, REPORT_PURPOSE, ReportUnreadable, requestSchema, sealRequest } from "../src/seal.ts";

const chainId = "qorechain-diana";
const vault = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4";
const agent = generateSealKeys();
const buyer = generateSealKeys();
const utf8 = (s: string) => new TextEncoder().encode(s);

const sealedReport = (report: unknown, orderId: string) =>
  envelopeToText(seal({ chainId, purpose: REPORT_PURPOSE, recipients: [recipientOf(buyer)], plaintext: utf8(JSON.stringify(report)), aad: utf8(`${vault}:${orderId}`), mode: "hybrid" }));

describe("request schema and sealing", () => {
  test("accepts the strict request shape only", () => {
    expect(requestSchema.safeParse({ v: 1, serviceId: 0, input: "x" }).success).toBe(true);
    expect(requestSchema.safeParse({ v: 2, serviceId: 0, input: "x" }).success).toBe(false);
    expect(requestSchema.safeParse({ v: 1, serviceId: 0, input: "" }).success).toBe(false);
    expect(requestSchema.safeParse({ v: 1, serviceId: 0, input: "x", extra: 1 }).success).toBe(false);
  });
  test("a sealed request is an envelope text", () => {
    const text = sealRequest({ body: { v: 1, serviceId: 0, input: "qor1abc" }, vault, recipient: recipientOf(agent), chainId });
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("openReport", () => {
  test("only the buyer opens the report, bound to vault and order", () => {
    const text = sealedReport({ grade: "A" }, "7");
    expect(openReport({ text, vault, orderId: "7", keys: buyer, chainId })).toEqual({ grade: "A" });
    expect(() => openReport({ text, vault, orderId: "8", keys: buyer, chainId })).toThrow(ReportUnreadable);
    expect(() => openReport({ text, vault, orderId: "7", keys: agent, chainId })).toThrow(ReportUnreadable);
  });
});

describe("createRecipientResolver", () => {
  test("a stored card in JSON text is parsed, and a network error is rethrown (retriable), not turned into null", async () => {
    const r = createRecipientResolver({ rest: "http://127.0.0.1:1", chainId: "c", card: async () => JSON.stringify({ version: 1 }) });
    await expect(r("0x" + "11".repeat(20))).rejects.toThrow(/request to .* failed/);
  });
});
