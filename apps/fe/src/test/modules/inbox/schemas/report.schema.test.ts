import { expect, test } from "vitest";
import { parseReport } from "@/modules/inbox/schemas/report.schema";

const ADDRESS = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

const base = (business: string, verdict: { label: string; rule: string }, facts: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  v: 1,
  business,
  vault: "0x37bbb37dd96a973a22ca64bc809a8bc4d54b03d4",
  orderId: "5",
  serviceId: 1,
  subject: ADDRESS,
  verdict,
  facts,
  findings: ["First finding.", "Second finding."],
  summary: "A short summary.",
  notes: ["A note."],
  generatedBy: "facts-only",
  suppliers: [{ role: "dataIndexer", amount: "10000" }],
  createdAt: "2026-11-25T14:32:00.000Z",
  ...extra,
});

const counterpartyFacts = {
  address: { bech32: "qor1abc", hex: ADDRESS },
  listed: false,
  listEntry: null,
  list: "demo-flags",
  mldsaRegistered: true,
  possessionProven: true,
  keyType: "ml-dsa-87",
  windowLive: false,
  windowOpenToAny: false,
  exists: true,
  txSent: 1284,
  classicalKeyExposed: false,
};

test("a counterparty report shows its grade, key facts and every known fact with a readable label", () => {
  const parsed = parseReport(base("counterparty-check", { label: "A", rule: "otherwise" }, counterpartyFacts))!;
  expect(parsed.grade).toBe("A");
  expect(parsed.keyFacts.map((r) => [r.label, r.value])).toEqual([
    ["Transactions sent", "1,284"],
    ["Post-quantum key", "Registered and proven"],
    ["Flag list", "Not listed"],
  ]);
  const rows = Object.fromEntries(parsed.facts.map((r) => [r.label, r.value]));
  expect(rows["Account has on-chain history"]).toBe("Yes");
  expect(rows["Classical key exposed on chain"]).toBe("No");
  expect(rows["Live EVM window"]).toBe("No");
  expect(parsed.extras).toEqual([]);
});

test("a listed address says which entry it matches", () => {
  const parsed = parseReport(
    base("counterparty-check", { label: "F", rule: "address is on the flag list" }, { ...counterpartyFacts, listed: true, listEntry: "synthetic entry" }),
  )!;
  expect(parsed.keyFacts.find((r) => r.label === "Flag list")!.value).toBe("Listed: synthetic entry");
});

test("a sanctions report lists matches as text, never as raw data", () => {
  const parsed = parseReport(
    base("sanctions-screen", { label: "match", rule: "listed on demo" }, {
      list: "demo",
      checked: [ADDRESS],
      checkedCount: 1,
      matches: [{ address: ADDRESS, entry: "synthetic entry" }],
      matchCount: 1,
    }),
  )!;
  expect(parsed.grade).toBeNull();
  const rows = Object.fromEntries(parsed.facts.map((r) => [r.label, r.value]));
  expect(rows["Addresses checked"]).toBe("1");
  expect(rows["Matches"]).toBe(`1: ${ADDRESS} (synthetic entry)`);
  for (const r of parsed.facts) expect(r.value).not.toMatch(/[{}\[\]"]/);
});

test("a due diligence report reads the contract and flag facts", () => {
  const parsed = parseReport(
    base("due-diligence", { label: "medium", rule: "no PQC precompile use" }, {
      address: ADDRESS,
      isContract: true,
      codeSize: 4096,
      erc20Selectors: ["transfer", "approve"],
      usesPqcVerify: false,
      usesPqcKeyStatus: false,
      usesPqcPrecompile: false,
      ecrecoverHint: true,
      deep: true,
      token: { name: "Fake USD", symbol: "fUSD", decimals: 6, totalSupply: "1000" },
      owner: ADDRESS,
      ownerPresent: true,
      listed: false,
      listEntry: null,
      list: "demo-flags",
    }),
  )!;
  const rows = Object.fromEntries(parsed.facts.map((r) => [r.label, r.value]));
  expect(rows["Contract code found"]).toBe("Yes");
  expect(rows["Code size"]).toBe("4,096 bytes");
  expect(rows["Token"]).toBe("Fake USD (fUSD), 6 decimals, total supply 1000");
  expect(rows["Owner"]).toBe(ADDRESS);
  expect(rows["ERC-20 functions in code"]).toBe("transfer, approve");
});

test("a contract auditor report without token facts still reads", () => {
  const parsed = parseReport(
    base("contract-auditor", { label: "not ready", rule: "otherwise" }, {
      address: ADDRESS,
      isContract: true,
      codeSize: 10,
      erc20Selectors: [],
      usesPqcVerify: false,
      usesPqcKeyStatus: false,
      usesPqcPrecompile: false,
      ecrecoverHint: false,
      deep: false,
      ownerPresent: false,
    }),
  )!;
  const rows = Object.fromEntries(parsed.facts.map((r) => [r.label, r.value]));
  expect(rows["ERC-20 functions in code"]).toBe("None");
  expect(rows["Token"]).toBeUndefined();
});

test("unknown facts and unknown top-level fields appear as plain rows, never as a raw dump", () => {
  const parsed = parseReport(
    base("counterparty-check", { label: "A", rule: "otherwise" }, { ...counterpartyFacts, newSignal: { a: 1, b: [true, null] } }, { watermark: "w-1" }),
  )!;
  const extras = Object.fromEntries(parsed.extras.map((r) => [r.label, r.value]));
  expect(extras["New signal"]).toBe("a: 1; b: Yes, None");
  expect(extras["Watermark"]).toBe("w-1");
});

test("a business this app does not know still shows every fact as a plain row", () => {
  const parsed = parseReport(base("future-service", { label: "ok", rule: "r" }, { someFlag: true, someCount: 3 }))!;
  expect(parsed.grade).toBeNull();
  expect(parsed.facts).toEqual([]);
  expect(parsed.extras.map((r) => [r.label, r.value])).toEqual([
    ["Some flag", "Yes"],
    ["Some count", "3"],
  ]);
});

test("facts that do not fit the schema of their service fall back to plain rows", () => {
  const parsed = parseReport(base("counterparty-check", { label: "A", rule: "otherwise" }, { txSent: "many" }))!;
  expect(parsed.keyFacts).toEqual([]);
  expect(parsed.extras.map((r) => r.label)).toEqual(["Tx sent"]);
});

test("a report without a verdict or findings is not a report", () => {
  expect(parseReport({ v: 1 })).toBeNull();
  expect(parseReport("text")).toBeNull();
  expect(parseReport(null)).toBeNull();
});

test("createdAt must be an ISO date and time, so a report with another value is not read", () => {
  const ok = base("counterparty-check", { label: "A", rule: "otherwise" }, counterpartyFacts);
  expect(parseReport({ ...ok, createdAt: "yesterday" })).toBeNull();
  expect(parseReport({ ...ok, createdAt: "2026-13-45" })).toBeNull();
  expect(parseReport({ ...ok, createdAt: "2026-11-25T14:32:00+02:00" })).toBeNull();
  expect(parseReport(ok)!.report.createdAt.toISOString()).toBe("2026-11-25T14:32:00.000Z");
});

test("the report carries its model name and time only as readable values", () => {
  const parsed = parseReport(base("counterparty-check", { label: "A", rule: "otherwise" }, counterpartyFacts))!;
  expect(parsed.report.summary).toBe("A short summary.");
  expect(parsed.report.generatedBy).toBe("facts-only");
  expect(parsed.report.createdAt.toISOString()).toBe("2026-11-25T14:32:00.000Z");
});
