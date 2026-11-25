import { describe, expect, test } from "bun:test";
import { buildRegisterKemKeyMessage, generateSealKeys, recipientOf } from "@qorechain/qoreseal";
import { addressesFrom20, qorechainRegistry } from "@qorechain/sdk";
import { envelopeHash } from "@qredit/qore";
import { openRequest, RequestUnreadable, sealReport, sealRequest } from "../src/agent/seal.ts";
import { registerKemKeyMsg } from "../src/setup/seal.ts";

const chainId = "qorechain-diana";
const vault = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4";
const agent = generateSealKeys();
const buyer = generateSealKeys();

describe("request codec", () => {
  test("a sealed request opens with the agent keys and matching ref", () => {
    const text = sealRequest({ body: { v: 1, serviceId: 0, input: "qor1abc" }, vault, recipient: recipientOf(agent), chainId });
    expect(openRequest({ text, requestRef: envelopeHash(text), vault, keys: agent, chainId })).toEqual({ v: 1, serviceId: 0, input: "qor1abc" });
  });
  test("refuses a ref mismatch, another vault, wrong keys and bad bodies", () => {
    const text = sealRequest({ body: { v: 1, serviceId: 0, input: "x" }, vault, recipient: recipientOf(agent), chainId });
    const ref = envelopeHash(text);
    expect(() => openRequest({ text, requestRef: "0x" + "00".repeat(32), vault, keys: agent, chainId })).toThrow(RequestUnreadable);
    expect(() => openRequest({ text, requestRef: ref, vault: "0x" + "11".repeat(20), keys: agent, chainId })).toThrow(RequestUnreadable);
    expect(() => openRequest({ text, requestRef: ref, vault, keys: buyer, chainId })).toThrow(RequestUnreadable);
    const bad = sealRequest({ body: { v: 2, serviceId: 0, input: "x" } as never, vault, recipient: recipientOf(agent), chainId });
    expect(() => openRequest({ text: bad, requestRef: envelopeHash(bad), vault, keys: agent, chainId })).toThrow(RequestUnreadable);
  });
});

describe("report codec", () => {
  test("only the buyer opens the report, bound to vault and order", async () => {
    const { open, envelopeFromText } = await import("@qorechain/qoreseal");
    const text = sealReport({ report: { grade: "A" }, vault, orderId: "7", recipient: recipientOf(buyer), chainId });
    const opened = open({ chainId, purpose: "qredit/report/v1", envelope: envelopeFromText(text), keys: buyer, aad: new TextEncoder().encode(`${vault}:7`) });
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual({ grade: "A" });
    expect(() => open({ chainId, purpose: "qredit/report/v1", envelope: envelopeFromText(text), keys: agent, aad: new TextEncoder().encode(`${vault}:7`) })).toThrow();
  });
});

describe("KEM registration message", () => {
  test("the broadcastable message encodes to the same bytes as qoreseal's builder", () => {
    const sender = addressesFrom20(new Uint8Array(20).fill(7)).cosmos;
    const msg = registerKemKeyMsg(sender, agent.mlkemPublicKey);
    const reference = buildRegisterKemKeyMessage({ sender, mlkemPublicKey: agent.mlkemPublicKey });
    expect(msg.typeUrl).toBe(reference.typeUrl);
    expect(Buffer.from(qorechainRegistry().encodeAsAny(msg).value).toString("hex")).toBe(Buffer.from(reference.value).toString("hex"));
  });
});
