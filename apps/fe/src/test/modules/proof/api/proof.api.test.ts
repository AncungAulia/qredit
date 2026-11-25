import { beforeEach, expect, test, vi } from "vitest";
import { FACTORY_RUNTIME_CODEHASH, PAY_SUPPLIER_SELECTOR } from "@qredit/qore";

const readContract = vi.fn();
vi.mock("@/lib/chain", () => ({
  publicClient: { readContract: (a: unknown) => readContract(a), getCode: vi.fn() },
  restUrl: () => "http://test/api/chain/rest",
}));
const fetchPqcStatus = vi.fn();
const fetchAuthenticators = vi.fn();
const fetchSpendingRules = vi.fn();
vi.mock("@qorechain/sdk", () => ({
  fetchPqcStatus: (a: unknown) => fetchPqcStatus(a),
  fetchAuthenticators: (a: unknown) => fetchAuthenticators(a),
  fetchSpendingRules: (a: unknown) => fetchSpendingRules(a),
}));
const evmWindowStatus = vi.fn();
vi.mock("@qorechain/evm", () => ({ evmWindowStatus: (a: unknown) => evmWindowStatus(a) }));
import { runChecks } from "@/modules/proof/api/proof.api";

const VAULT = "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4" as const;
const ADDR = "0x1111111111111111111111111111111111111111" as const;
const business = {
  slug: "x",
  vault: VAULT,
  name: "X",
  tagline: "",
  services: [],
  operator: ADDR,
  spender: ADDR,
  startBlock: 1,
};
const reads = {
  codeHash: async () => FACTORY_RUNTIME_CODEHASH as string,
  vaults: async () => [VAULT as string],
};

beforeEach(() => {
  vi.resetAllMocks();
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === "ownerPq") return ADDR;
    if (functionName === "books") return [1n, 2n, 3n, 4n, 5n];
    if (functionName === "balanceOf") return 15n;
    if (functionName === "state") return 1;
    throw new Error(`unexpected read ${functionName}`);
  });
  fetchPqcStatus.mockResolvedValue({ registered: true, possessionProven: true });
  fetchAuthenticators.mockResolvedValue([{ pubkeyHex: "aa", revoked: false, expiryUnix: 0n }]);
  fetchSpendingRules.mockResolvedValue({
    rules: [],
    authenticatorRules: [
      {
        pubkeyHex: "aa",
        rule: { enabled: true, allowedEvmCalls: [`${VAULT}/${PAY_SUPPLIER_SELECTOR}`] },
      },
    ],
  });
  evmWindowStatus.mockResolvedValue({ found: true, live: true, allowedTargets: [VAULT] });
});

const byId = (rs: Awaited<ReturnType<typeof runChecks>>) =>
  Object.fromEntries(rs.map((r) => [r.id, r.status]));

test("every check is proven when the chain agrees", async () => {
  expect(byId(await runChecks(business, reads))).toEqual({
    factory: "proven",
    ownerKey: "proven",
    spenderRule: "proven",
    operatorWindow: "proven",
    books: "proven",
    widening: "proven",
  });
});

test("a read that throws makes only that check unknown", async () => {
  evmWindowStatus.mockRejectedValue(new Error("network down"));
  const results = await runChecks(business, reads);
  expect(byId(results)).toEqual({
    factory: "proven",
    ownerKey: "proven",
    spenderRule: "proven",
    operatorWindow: "unknown",
    books: "proven",
    widening: "proven",
  });
  expect(results.find((r) => r.id === "operatorWindow")?.detail).toBe(
    "This could not be checked right now.",
  );
});

test("a failing vault read isolates the checks that need it and never rejects", async () => {
  readContract.mockRejectedValue(new Error("rpc down"));
  expect(byId(await runChecks(business, reads))).toMatchObject({
    factory: "proven",
    ownerKey: "unknown",
    books: "unknown",
    widening: "unknown",
    spenderRule: "proven",
  });
});

test("widening is not proven when the factory check does not prove the code", async () => {
  const wrong = { ...reads, codeHash: async () => "0xdeadbeef" };
  expect(byId(await runChecks(business, wrong))).toMatchObject({ factory: "failed", widening: "unknown" });
  const none = { ...reads, vaults: async () => [] as string[] };
  expect(byId(await runChecks(business, none))).toMatchObject({ factory: "failed", widening: "unknown" });
});

test("an empty rule on the account fails the spender check", async () => {
  fetchSpendingRules.mockResolvedValue({
    rules: [{ enabled: true, allowedEvmCalls: [] }],
    authenticatorRules: [],
  });
  expect((await runChecks(business, reads)).find((r) => r.id === "spenderRule")?.status).toBe(
    "failed",
  );
});
