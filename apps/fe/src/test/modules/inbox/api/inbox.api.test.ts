// @vitest-environment node
// The seal library checks `instanceof Uint8Array`; under jsdom the global Uint8Array and the bytes of TextEncoder
// come from different realms and fail that check, so this file runs in the node environment, as a browser's bytes are consistent.
import { beforeEach, expect, test, vi } from "vitest";

const getLogs = vi.fn();
const getBlock = vi.fn();
const getBlockNumber = vi.fn();
const get = vi.fn();
const send = vi.fn();
const ensureWindowFor = vi.fn();
const signerFor = vi.fn();

vi.mock("@/lib/chain", () => ({
  publicClient: { getLogs: (a: unknown) => getLogs(a), getBlock: (a: unknown) => getBlock(a), getBlockNumber: () => getBlockNumber() },
}));
vi.mock("@/lib/env", () => ({ env: { chainId: "qorechain-diana", apiUrl: "http://api" } }));
vi.mock("@/lib/apiClient", async (orig) => ({
  ...(await orig<typeof import("@/lib/apiClient")>()),
  api: { get: (...a: unknown[]) => get(...a) },
}));
vi.mock("@/modules/wallet/signer", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/signer")>()),
  evmSignerFor: (s: unknown) => signerFor(s),
  ensureWindowFor: (...a: unknown[]) => ensureWindowFor(...a),
}));

import { envelopeFromText, envelopeToText, generateSealKeys, recipientOf, seal } from "@qorechain/qoreseal";
import { decodeFunctionData } from "viem";
import { LOAN_VAULT_ABI, REPORT_PURPOSE, ReportUnreadable, envelopeHash } from "@qredit/qore";
import { ApiError } from "@/lib/apiClient";
import type { Business } from "@/lib/schemas";
import {
  DeliveryNotFound,
  NoSealKeys,
  ReportDoesNotMatch,
  openMyReport,
  readDelivery,
  readMyOrders,
  readReportContext,
  reclaim,
} from "@/modules/inbox/api/inbox.api";
import type { WalletSession } from "@/modules/wallet/session";
import { TxFailed } from "@/modules/wallet/signer";

const VAULT = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4" as const;
const OTHER_VAULT = "0x1111111111111111111111111111111111111111" as const;
const ME = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;
const STRANGER = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as const;
const CHAIN_ID = "qorechain-diana";

const businessOf = (slug: string, vault: `0x${string}`) => ({ slug, vault, name: slug, services: [] }) as unknown as Business;

const orderRow = (vault: string, orderId: string, buyer: string, placedBlock: number) => ({
  vault,
  orderId,
  buyer,
  serviceId: 1,
  price: "250000",
  requestRef: `0x${"11".repeat(32)}`,
  deadline: 1_800_000_000,
  status: "open",
  placedTx: `0x${"22".repeat(32)}`,
  placedBlock,
  envelopeHash: null,
});

// A real sealed report, built like the engine's sealReport: aad is `${vault}:${orderId}`, purpose REPORT_PURPOSE.
function sealedReport(keys: ReturnType<typeof generateSealKeys>, report: unknown, orderId: string, vault: string = VAULT) {
  const bytes = seal({
    chainId: CHAIN_ID,
    purpose: REPORT_PURPOSE,
    recipients: [recipientOf(keys)],
    plaintext: new TextEncoder().encode(JSON.stringify(report)),
    aad: new TextEncoder().encode(`${vault.toLowerCase()}:${orderId}`),
    mode: "hybrid",
  });
  return envelopeToText(bytes);
}

const myKeys = generateSealKeys();
const REPORT = { v: 1, business: "counterparty-check", verdict: { label: "A", rule: "otherwise" } };
const TEXT = sealedReport(myKeys, REPORT, "5");
const HASH = envelopeHash(TEXT);
const TX = `0x${"ab".repeat(32)}` as const;

const sessionWith = (keys: ReturnType<typeof generateSealKeys> | null): WalletSession =>
  keys
    ? ({ kind: "test", address: "qor1x", evm: ME, sealKeys: keys } as unknown as WalletSession)
    : ({ kind: "none" } as WalletSession);

function deliveredLog(hash: string) {
  return [{ args: { orderId: 5n, envelopeHash: hash }, transactionHash: TX, blockNumber: 10_671_204n }];
}

beforeEach(() => {
  vi.clearAllMocks();
  getLogs.mockResolvedValue(deliveredLog(HASH));
  getBlock.mockResolvedValue({ timestamp: 1_795_000_000n });
  getBlockNumber.mockResolvedValue(10_700_000n);
  get.mockImplementation(async (url: string) => {
    if (url === `/v1/envelopes/${HASH}`) return { data: { kind: "report", body: TEXT } };
    throw new ApiError("notFound", 404);
  });
});

test("readMyOrders keeps only the orders of the buyer (compared in lowercase), newest first, with their business", async () => {
  const a = businessOf("a", VAULT);
  const b = businessOf("b", OTHER_VAULT);
  get.mockImplementation(async (_url: string, opts: { params: { vault: string } }) => ({
    data:
      opts.params.vault === VAULT
        ? [orderRow(VAULT, "5", ME.toUpperCase().replace("0X", "0x"), 100), orderRow(VAULT, "4", STRANGER, 90)]
        : [orderRow(OTHER_VAULT, "9", ME, 120)],
  }));
  const mine = await readMyOrders(ME, [a, b]);
  expect(mine.map((o) => [o.orderId, o.business.slug])).toEqual([
    ["9", "b"],
    ["5", "a"],
  ]);
});

test("readMyOrders fails when one vault cannot be read, so a partial list is never shown as complete", async () => {
  get.mockRejectedValue(new ApiError("server", 500));
  await expect(readMyOrders(ME, [businessOf("a", VAULT)])).rejects.toBeInstanceOf(ApiError);
});

test("readMyOrders of a buyer with no orders is an empty list", async () => {
  get.mockResolvedValue({ data: [orderRow(VAULT, "4", STRANGER, 90)] });
  expect(await readMyOrders(ME, [businessOf("a", VAULT)])).toEqual([]);
});

test("readDelivery reads the Delivered log from the chain and checks the stored envelope against it", async () => {
  const d = await readDelivery(VAULT, "5", 10_000_000);
  expect(d.envelopeHash).toBe(HASH);
  expect(d.deliveredTx).toBe(TX);
  expect(d.blockNumber).toBe(10_671_204);
  expect(d.deliveredAt).toEqual(new Date(1_795_000_000_000));
  expect(d.text).toBe(TEXT);
  const query = getLogs.mock.calls[0]![0] as { address: string; args: { orderId: bigint }; fromBlock: bigint; toBlock: bigint };
  expect(query.address).toBe(VAULT);
  expect(query.args.orderId).toBe(5n);
  expect(query.fromBlock).toBe(10_000_000n);
  expect(query.toBlock).toBe(10_009_999n);
});

test("readDelivery walks forward in windows of at most 10,000 blocks, which is all the node answers", async () => {
  getLogs.mockResolvedValueOnce([]).mockResolvedValueOnce(deliveredLog(HASH));
  getBlockNumber.mockResolvedValue(10_030_000n);
  await readDelivery(VAULT, "5", 10_000_000);
  const windows = getLogs.mock.calls.map((c) => [(c[0] as { fromBlock: bigint }).fromBlock, (c[0] as { toBlock: bigint }).toBlock]);
  expect(windows).toEqual([
    [10_000_000n, 10_009_999n],
    [10_010_000n, 10_019_999n],
  ]);
});

test("readDelivery stops at the newest block and ends as not found when no window holds the log", async () => {
  getLogs.mockResolvedValue([]);
  getBlockNumber.mockResolvedValue(10_015_000n);
  await expect(readDelivery(VAULT, "5", 10_000_000)).rejects.toBeInstanceOf(DeliveryNotFound);
  expect(getLogs).toHaveBeenCalledTimes(2);
  expect((getLogs.mock.calls[1]![0] as { toBlock: bigint }).toBlock).toBe(10_015_000n);
});

test("readDelivery keeps going when the block time cannot be read", async () => {
  getBlock.mockRejectedValue(new Error("no block"));
  expect((await readDelivery(VAULT, "5")).deliveredAt).toBeNull();
});

test("readDelivery refuses an envelope whose hash is not the one delivered on chain", async () => {
  const tampered = TEXT + "x";
  get.mockResolvedValue({ data: { kind: "report", body: tampered } });
  const error = await readDelivery(VAULT, "5").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ReportDoesNotMatch);
  expect((error as ReportDoesNotMatch).expected).toBe(HASH);
  expect((error as ReportDoesNotMatch).actual).toBe(envelopeHash(tampered));
});

test("readDelivery trusts the chain, not the backend: the hash of the order list is never used", async () => {
  const forged = `0x${"cd".repeat(32)}`;
  getLogs.mockResolvedValue(deliveredLog(forged));
  get.mockResolvedValue({ data: { kind: "report", body: TEXT } });
  await expect(readDelivery(VAULT, "5")).rejects.toBeInstanceOf(ReportDoesNotMatch);
  expect(get).toHaveBeenCalledWith(`/v1/envelopes/${forged}`);
});

test("readDelivery says so when the chain holds no Delivered log for the order", async () => {
  getLogs.mockResolvedValue([]);
  await expect(readDelivery(VAULT, "5")).rejects.toBeInstanceOf(DeliveryNotFound);
});

test("readDelivery does not accept an envelope response of an unknown shape", async () => {
  get.mockResolvedValue({ data: { nope: 1 } });
  await expect(readDelivery(VAULT, "5")).rejects.toBeInstanceOf(ApiError);
});

test("openMyReport opens the report of the buyer: hash checked, then opened with the session keys", async () => {
  const opened = await openMyReport(sessionWith(myKeys), VAULT, "5");
  expect(opened).toEqual({ report: REPORT, envelopeHash: HASH, deliveredTx: TX });
});

test("openMyReport with the keys of another wallet is ReportUnreadable", async () => {
  await expect(openMyReport(sessionWith(generateSealKeys()), VAULT, "5")).rejects.toBeInstanceOf(ReportUnreadable);
});

test("openMyReport refuses when the aad differs: a report of another order does not open", async () => {
  await expect(openMyReport(sessionWith(myKeys), VAULT, "6")).rejects.toBeInstanceOf(ReportUnreadable);
});

test("openMyReport with a hash mismatch is ReportDoesNotMatch and never opens the envelope", async () => {
  getLogs.mockResolvedValue(deliveredLog(envelopeHash(TEXT + "x")));
  get.mockResolvedValue({ data: { kind: "report", body: TEXT } });
  await expect(openMyReport(sessionWith(myKeys), VAULT, "5")).rejects.toBeInstanceOf(ReportDoesNotMatch);
});

test("openMyReport needs a test wallet: QoreX alone holds no seal keys", async () => {
  await expect(openMyReport(sessionWith(null), VAULT, "5")).rejects.toBeInstanceOf(NoSealKeys);
});

const businessRow = (vault: string) => ({
  slug: "counterparty-check",
  vault,
  name: "Counterparty Check",
  tagline: "t",
  services: [{ id: 1, name: "Counterparty risk grade", priceUnits: "250000" }],
  operator: ME,
  spender: ME,
  startBlock: 1,
});

test("readReportContext finds the order and its business, matching the vault in lowercase", async () => {
  get.mockImplementation(async (url: string) => ({
    data: url === "/v1/businesses" ? [businessRow(VAULT)] : [orderRow(VAULT, "5", ME, 100)],
  }));
  const found = await readReportContext(VAULT.toUpperCase().replace("0X", "0x") as `0x${string}`, "5");
  expect(found.business.slug).toBe("counterparty-check");
  expect(found.order.orderId).toBe("5");
});

test("readReportContext is not found for a vault or an order the backend does not list", async () => {
  get.mockImplementation(async (url: string) => ({
    data: url === "/v1/businesses" ? [businessRow(VAULT)] : [orderRow(VAULT, "5", ME, 100)],
  }));
  await expect(readReportContext(OTHER_VAULT, "5")).rejects.toMatchObject({ kind: "notFound" });
  await expect(readReportContext(VAULT, "99")).rejects.toMatchObject({ kind: "notFound" });
});

test("the sealed fixture is a real envelope", () => {
  expect(() => envelopeFromText(TEXT)).not.toThrow();
});

test("reclaim opens the window for the vault and sends reclaim(orderId) from the test wallet", async () => {
  signerFor.mockReturnValue({ address: ME, send });
  ensureWindowFor.mockResolvedValue(null);
  send.mockResolvedValue(TX);
  const session = sessionWith(myKeys);
  expect(await reclaim(session, VAULT, "5")).toBe(TX);
  expect(ensureWindowFor).toHaveBeenCalledWith(session, [VAULT]);
  const [to, data] = send.mock.calls[0]!;
  expect(to).toBe(VAULT);
  const call = decodeFunctionData({ abi: LOAN_VAULT_ABI, data });
  expect(call.functionName).toBe("reclaim");
  expect(call.args).toEqual([5n]);
});

test("reclaim without a test wallet says so and sends nothing", async () => {
  signerFor.mockReturnValue(null);
  await expect(reclaim(sessionWith(null), VAULT, "5")).rejects.toBeInstanceOf(TxFailed);
  expect(send).not.toHaveBeenCalled();
});
